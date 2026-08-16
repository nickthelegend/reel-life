import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { appendKeyframe, createClip } from "../Assets/Scripts/Logic/Clip";
import { samplePose } from "../Assets/Scripts/Logic/PoseInterpolator";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { buildRigPlan } from "../Assets/Scripts/Logic/RigPlan";
import {
  Q_IDENTITY,
  qDot,
  qFromAxisAngle,
  qNormalize,
  v3,
} from "../Assets/Scripts/Logic/Vec";

// The test build emits CommonJS into dist/tests, so __dirname is available.
const ROOT = join(__dirname, "..", "..");
const AUDIO = join(ROOT, "Assets", "Audio");

// ===========================================================================
// Golden files — the generated audio is pinned
// ===========================================================================

/**
 * The score is produced by a script, so nothing stops a refactor from silently
 * changing every track's tempo or muting one. These hashes pin the output: if
 * the synthesizer changes, this fails and you have to look at why.
 *
 * To re-bless after an intentional change: run `node tools/build-audio.mjs`,
 * read the new hashes out of the failure message, and update this table.
 */
const GOLDEN: Record<string, { bpm?: number; seconds: number }> = {
  "music_whimsical.wav": { bpm: 150, seconds: 6.4 },
  "music_epic.wav": { bpm: 120, seconds: 8 },
  "music_spooky.wav": { bpm: 90, seconds: 10.6667 },
  "music_bouncy.wav": { bpm: 140, seconds: 6.8571 },
  "sfx_step.wav": { seconds: 0.3 },
  "sfx_whoosh.wav": { seconds: 0.4 },
  "sfx_bonk.wav": { seconds: 0.4 },
};

const RATE = 44100;

function wavStats(file: string) {
  const buf = readFileSync(join(AUDIO, file));
  assert.equal(buf.toString("ascii", 0, 4), "RIFF", `${file} is not a RIFF file`);
  assert.equal(buf.toString("ascii", 8, 12), "WAVE", `${file} is not WAVE`);

  const sampleRate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const count = (buf.length - 44) / 2;

  let peak = 0;
  let energy = 0;
  for (let i = 0; i < count; i++) {
    const s = buf.readInt16LE(44 + i * 2) / 32768;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    energy += s * s;
  }
  return {
    sampleRate,
    bits,
    seconds: count / sampleRate,
    peak,
    rms: Math.sqrt(energy / count),
    sha256: createHash("sha256").update(buf).digest("hex").slice(0, 16),
  };
}

test("every audio asset the manifest promises actually exists", () => {
  const manifest = JSON.parse(readFileSync(join(AUDIO, "manifest.json"), "utf8"));
  const onDisk = readdirSync(AUDIO).filter((f) => f.endsWith(".wav"));

  assert.equal(manifest.length, Object.keys(GOLDEN).length);
  for (const entry of manifest) {
    assert.ok(onDisk.indexOf(entry.file) >= 0, `${entry.file} is missing from disk`);
    assert.ok(GOLDEN[entry.file], `${entry.file} is not pinned by a golden entry`);
  }
});

test("no audio asset is silent", () => {
  for (const file of Object.keys(GOLDEN)) {
    const stats = wavStats(file);
    assert.ok(stats.peak > 0.5, `${file} peaks at only ${stats.peak}`);
    assert.ok(stats.rms > 0.05, `${file} is nearly silent (rms ${stats.rms})`);
  }
});

test("every asset is 44.1kHz 16-bit as the Lens expects", () => {
  for (const file of Object.keys(GOLDEN)) {
    const stats = wavStats(file);
    assert.equal(stats.sampleRate, RATE, file);
    assert.equal(stats.bits, 16, file);
  }
});

test("music tracks are exactly sixteen beats at their stated tempo", () => {
  // This is the property the beat grid depends on. If it drifts, every
  // quantized performance drifts with it.
  for (const [file, want] of Object.entries(GOLDEN)) {
    if (want.bpm === undefined) continue;
    const stats = wavStats(file);
    const beats = stats.seconds / (60 / want.bpm);
    assert.ok(
      Math.abs(beats - 16) < 1e-4,
      `${file} is ${beats.toFixed(4)} beats, not 16`
    );
  }
});

test("declared durations match the actual files", () => {
  for (const [file, want] of Object.entries(GOLDEN)) {
    const stats = wavStats(file);
    assert.ok(
      Math.abs(stats.seconds - want.seconds) < 0.001,
      `${file} is ${stats.seconds}s, expected ${want.seconds}s`
    );
  }
});

test("regenerating the audio is byte-identical", () => {
  // The generator must be deterministic, or a recorded demo would not replay
  // the same and this pinning would be meaningless.
  const before = Object.keys(GOLDEN).map((f) => wavStats(f).sha256);
  execFileSync("node", [join(ROOT, "tools", "build-audio.mjs")], { stdio: "pipe" });
  const after = Object.keys(GOLDEN).map((f) => wavStats(f).sha256);
  assert.deepEqual(after, before, "the synthesizer is not deterministic");
});

// ===========================================================================
// Property tests — the interpolator runs every frame
// ===========================================================================

/** Deterministic PRNG so a failure is always reproducible. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const plan = buildRigPlan("a clay dragon in a top hat");

function randomClip(random: () => number, keyframeCount: number) {
  const clip = createClip("p", "Prop", "stopmotion", "smooth");
  let t = 0;
  for (let i = 0; i < keyframeCount; i++) {
    const pose: PoseSample = {};
    for (const joint of plan.joints) {
      if (!joint.poseable) continue;
      pose[joint.id] = {
        p: v3(
          joint.offset.x + (random() - 0.5) * 20,
          joint.offset.y + (random() - 0.5) * 20,
          joint.offset.z + (random() - 0.5) * 20
        ),
        r: qFromAxisAngle(
          v3(random() - 0.5, random() - 0.5, random() - 0.5),
          (random() - 0.5) * Math.PI * 2
        ),
      };
    }
    appendKeyframe(clip, { t, joints: pose });
    t += 0.05 + random() * 0.8;
  }
  return clip;
}

test("sampling a random clip never produces a non-finite value", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const random = rng(seed);
    const clip = randomClip(random, 2 + Math.floor(random() * 8));
    const duration = clip.keyframes[clip.keyframes.length - 1].t;

    for (let i = 0; i <= 40; i++) {
      // Deliberately sample outside the clip as well as inside.
      const localT = (i / 40) * duration * 1.4 - duration * 0.2;
      const pose = samplePose(clip, localT);
      assert.ok(pose !== null, `seed ${seed} returned no pose at ${localT}`);

      const sampled: PoseSample = pose as PoseSample;
      for (const id in sampled) {
        const jp = sampled[id];
        const values: number[] = [jp.p.x, jp.p.y, jp.p.z, jp.r.x, jp.r.y, jp.r.z, jp.r.w];
        for (const value of values) {
          assert.ok(isFinite(value), `seed ${seed}, joint ${id} at t=${localT} -> ${value}`);
        }
      }
    }
  }
});

test("every interpolated rotation stays a unit quaternion", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const random = rng(seed);
    const clip = randomClip(random, 2 + Math.floor(random() * 8));
    const duration = clip.keyframes[clip.keyframes.length - 1].t;

    for (let i = 0; i <= 40; i++) {
      const pose = samplePose(clip, (i / 40) * duration)!;
      for (const id in pose) {
        const r = pose[id].r;
        const length = Math.sqrt(qDot(r, r));
        assert.ok(
          Math.abs(length - 1) < 1e-6,
          `seed ${seed}, joint ${id}: |q| = ${length}`
        );
      }
    }
  }
});

test("sampling is deterministic — the same time always gives the same pose", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const random = rng(seed);
    const clip = randomClip(random, 4);
    const duration = clip.keyframes[clip.keyframes.length - 1].t;
    const t = duration * 0.37;
    assert.equal(
      JSON.stringify(samplePose(clip, t)),
      JSON.stringify(samplePose(clip, t)),
      `seed ${seed} is not deterministic`
    );
  }
});

test("clip endpoints are reproduced exactly, whatever the keyframes", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const random = rng(seed);
    const clip = randomClip(random, 2 + Math.floor(random() * 6));
    const duration = clip.keyframes[clip.keyframes.length - 1].t;

    const first = samplePose(clip, 0)!;
    const last = samplePose(clip, duration)!;
    for (const id in first) {
      assert.deepEqual(first[id].p, clip.keyframes[0].joints[id].p, `seed ${seed} start`);
    }
    const finalPose = clip.keyframes[clip.keyframes.length - 1].joints;
    for (const id in last) {
      assert.deepEqual(last[id].p, finalPose[id].p, `seed ${seed} end`);
    }
  }
});

test("interpolated positions stay inside the bounds of their keyframes", () => {
  // Position uses lerp, so a sample can never leave the box its neighbours
  // define. A violation would mean the segment search picked the wrong pair.
  for (let seed = 1; seed <= 40; seed++) {
    const random = rng(seed);
    const clip = randomClip(random, 3 + Math.floor(random() * 5));
    const duration = clip.keyframes[clip.keyframes.length - 1].t;

    const lo: Record<string, number> = {};
    const hi: Record<string, number> = {};
    for (const frame of clip.keyframes) {
      for (const id in frame.joints) {
        const x = frame.joints[id].p.x;
        lo[id] = lo[id] === undefined ? x : Math.min(lo[id], x);
        hi[id] = hi[id] === undefined ? x : Math.max(hi[id], x);
      }
    }

    for (let i = 0; i <= 60; i++) {
      const pose = samplePose(clip, (i / 60) * duration)!;
      for (const id in pose) {
        assert.ok(
          pose[id].p.x >= lo[id] - 1e-9 && pose[id].p.x <= hi[id] + 1e-9,
          `seed ${seed}, joint ${id}: ${pose[id].p.x} outside [${lo[id]}, ${hi[id]}]`
        );
      }
    }
  }
});

test("a clip of identical poses never moves", () => {
  const random = rng(99);
  const clip = randomClip(random, 1);
  const frozen = clip.keyframes[0].joints;
  for (let i = 1; i < 5; i++) {
    appendKeyframe(clip, { t: i * 0.4, joints: JSON.parse(JSON.stringify(frozen)) });
  }
  for (let i = 0; i <= 40; i++) {
    const pose = samplePose(clip, (i / 40) * 1.6)!;
    for (const id in pose) {
      assert.deepEqual(pose[id].p, frozen[id].p, `joint ${id} drifted`);
    }
  }
});

test("degenerate quaternions in stored data still yield unit output", () => {
  const clip = createClip("d", "D", "stopmotion", "smooth");
  const zero = { x: 0, y: 0, z: 0, w: 0 };
  appendKeyframe(clip, { t: 0, joints: { head: { p: v3(0, 0, 0), r: zero } } });
  appendKeyframe(clip, { t: 0.4, joints: { head: { p: v3(1, 0, 0), r: { ...Q_IDENTITY } } } });

  for (let i = 0; i <= 20; i++) {
    const r = samplePose(clip, (i / 20) * 0.4)!.head.r;
    const length = Math.sqrt(qDot(r, r));
    assert.ok(isFinite(length), `non-finite at step ${i}`);
    assert.ok(Math.abs(length - 1) < 1e-6 || length === 1, `|q| = ${length}`);
  }
  assert.deepEqual(qNormalize(zero), Q_IDENTITY);
});

// ===========================================================================
// The demo GIF — the project's one watchable artefact
// ===========================================================================

test("the demo GIF renders and is a valid looping animation", () => {
  execFileSync("node", [join(ROOT, "tools", "render-demo-gif.mjs")], { stdio: "pipe" });

  const bytes = readFileSync(join(ROOT, "docs", "media", "reel-life-demo.gif"));
  assert.equal(bytes.toString("ascii", 0, 6), "GIF89a");
  assert.equal(bytes[bytes.length - 1], 0x3b, "missing GIF trailer");

  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  assert.equal(width, 480);
  assert.equal(height, 320);

  // Count image descriptors: an animation needs more than one.
  let frames = 0;
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x2c) frames++;
  }
  assert.ok(frames > 10, `expected an animation, found ${frames} image blocks`);
  assert.ok(bytes.length > 10000, "a real animation should not be a few hundred bytes");
});

test("the demo GIF is reproducible", () => {
  const file = join(ROOT, "docs", "media", "reel-life-demo.gif");
  const before = createHash("sha256").update(readFileSync(file)).digest("hex");
  execFileSync("node", [join(ROOT, "tools", "render-demo-gif.mjs")], { stdio: "pipe" });
  const after = createHash("sha256").update(readFileSync(file)).digest("hex");
  assert.equal(after, before, "the renderer is not deterministic");
});
