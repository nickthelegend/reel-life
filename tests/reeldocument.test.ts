import { strict as assert } from "node:assert";
import { test } from "node:test";

import { appendKeyframe, createClip, setTrimIn, setTrimOut } from "../Assets/Scripts/Logic/Clip";
import {
  REEL_SCHEMA_VERSION,
  createReelDocument,
  parseReel,
  serializeReel,
  summarize,
} from "../Assets/Scripts/Logic/ReelDocument";
import { buildRigPlan } from "../Assets/Scripts/Logic/RigPlan";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { qFromAxisAngle, v3 } from "../Assets/Scripts/Logic/Vec";

function pose(x: number, angle: number): PoseSample {
  return {
    torso: { p: v3(x, 1, 2), r: qFromAxisAngle(v3(0, 1, 0), angle) },
    "arm.L": { p: v3(-3, 6, 0), r: qFromAxisAngle(v3(1, 0, 0), angle * 0.5) },
  };
}

function sampleDocument() {
  const rig = buildRigPlan("a clay dragon in a top hat");
  const doc = createReelDocument("reel-1", rig, 1755300000000);

  const a = createClip("clip-1", "Take 1", "stopmotion");
  for (let i = 0; i < 4; i++) {
    appendKeyframe(a, { t: i * 0.4, joints: pose(i, i * 0.2) });
  }
  a.caption = "he takes a bow";
  setTrimIn(a, 1);

  const b = createClip("clip-2", "Take 2", "performance");
  for (let i = 0; i < 6; i++) {
    appendKeyframe(b, { t: i / 12, joints: pose(-i, i * 0.1) });
  }

  doc.clips.push(a, b);
  doc.bpm = 150;
  doc.mood = "bouncy";
  return doc;
}

test("a reel survives a full save and load cycle", () => {
  const original = sampleDocument();
  const restored = parseReel(serializeReel(original));

  assert.equal(restored.id, original.id);
  assert.equal(restored.bpm, 150);
  assert.equal(restored.mood, "bouncy");
  assert.equal(restored.clips.length, 2);
  assert.equal(restored.clips[0].caption, "he takes a bow");
  assert.equal(restored.clips[0].trimIn, 1);
  assert.equal(restored.clips[1].source, "performance");
  assert.deepEqual(restored.clips[0].keyframes, original.clips[0].keyframes);
  assert.equal(restored.rig.archetype, "winged_biped");
  assert.equal(restored.rig.parts.length, original.rig.parts.length);
});

test("floating point pose data round-trips exactly", () => {
  const original = sampleDocument();
  const restored = parseReel(serializeReel(original));
  const from = original.clips[1].keyframes[3].joints["arm.L"];
  const to = restored.clips[1].keyframes[3].joints["arm.L"];
  assert.deepEqual(to.r, from.r);
  assert.deepEqual(to.p, from.p);
});

test("summaries describe a reel without loading its poses", () => {
  const summary = summarize(sampleDocument());
  assert.deepEqual(summary, {
    id: "reel-1",
    title: "a clay dragon in a top hat",
    savedAtMs: 1755300000000,
    clipCount: 2,
  });
});

test("malformed storage is rejected loudly", () => {
  assert.throws(() => parseReel("not json"), /not valid JSON/);
  assert.throws(() => parseReel("[]"), /root is not an object/);
  assert.throws(() => parseReel(JSON.stringify({ version: 1 })), /id is missing/);
  assert.throws(
    () => parseReel(JSON.stringify({ version: 1, id: "x", clips: {} })),
    /clips is not an array/
  );
});

test("a reel written by a newer build is refused, not silently downgraded", () => {
  const doc = sampleDocument();
  const raw = JSON.parse(serializeReel(doc));
  raw.version = REEL_SCHEMA_VERSION + 1;
  assert.throws(() => parseReel(JSON.stringify(raw)), /newer than this build/);
});

test("non-finite pose numbers are caught", () => {
  const doc = sampleDocument();
  const raw = JSON.parse(serializeReel(doc));
  // JSON has no NaN: a corrupted write lands as null.
  raw.clips[0].keyframes[0].joints.torso.p.x = null;
  assert.throws(() => parseReel(JSON.stringify(raw)), /finite number/);
});

test("out-of-range trim handles are clamped on load", () => {
  const doc = sampleDocument();
  const raw = JSON.parse(serializeReel(doc));
  raw.clips[0].trimOut = 999;
  raw.clips[0].trimIn = -5;

  const restored = parseReel(JSON.stringify(raw));
  assert.equal(restored.clips[0].trimIn, 0);
  assert.equal(restored.clips[0].trimOut, restored.clips[0].keyframes.length - 1);
});

test("an unknown mood or ease falls back instead of breaking playback", () => {
  const doc = sampleDocument();
  const raw = JSON.parse(serializeReel(doc));
  raw.mood = "interpretive-jazz";
  raw.clips[0].ease = "nonsense";

  const restored = parseReel(JSON.stringify(raw));
  assert.equal(restored.mood, "whimsical");
  assert.equal(restored.clips[0].ease, "smooth");
});

test("a trimmed clip reloads with the same trimmed range", () => {
  const doc = sampleDocument();
  setTrimOut(doc.clips[0], 2);
  const restored = parseReel(serializeReel(doc));
  assert.equal(restored.clips[0].trimIn, 1);
  assert.equal(restored.clips[0].trimOut, 2);
});
