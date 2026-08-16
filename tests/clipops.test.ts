import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  Clip,
  appendKeyframe,
  clipDuration,
  createClip,
  setTrimIn,
  setTrimOut,
  trimmedKeyframes,
} from "../Assets/Scripts/Logic/Clip";
import {
  MAX_CLIP_SECONDS,
  holdLastPose,
  isLoopClosed,
  isOverlong,
  loopBlendClip,
  mergeClips,
  pingPongClip,
  retimeClip,
  reverseClip,
  splitClip,
} from "../Assets/Scripts/Logic/ClipOps";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { Q_IDENTITY, qFromAxisAngle, v3 } from "../Assets/Scripts/Logic/Vec";

function pose(x: number, angle = 0): PoseSample {
  return {
    torso: { p: v3(x, 0, 0), r: qFromAxisAngle(v3(0, 1, 0), angle) },
    "arm.L": { p: v3(-3, 6, 0), r: { ...Q_IDENTITY } },
  };
}

function takeOf(id: string, positions: number[], step = 0.4): Clip {
  const clip = createClip(id, id, "stopmotion");
  positions.forEach((x, i) => appendKeyframe(clip, { t: i * step, joints: pose(x) }));
  return clip;
}

function assertOrdered(clip: Clip, label: string): void {
  for (let i = 1; i < clip.keyframes.length; i++) {
    assert.ok(
      clip.keyframes[i].t > clip.keyframes[i - 1].t,
      `${label}: frame ${i} at ${clip.keyframes[i].t} does not advance`
    );
  }
}

// --- split ------------------------------------------------------------------

test("splitting a take gives two playable halves sharing the cut pose", () => {
  const clip = takeOf("a", [0, 10, 20, 30, 40]);
  const halves = splitClip(clip, 2, "a1", "a2");
  assert.ok(halves);

  const [first, second] = halves!;
  assert.equal(first.keyframes.length, 3);
  assert.equal(second.keyframes.length, 3);
  assert.equal(first.keyframes[2].joints.torso.p.x, 20);
  assert.equal(second.keyframes[0].joints.torso.p.x, 20);

  assert.equal(first.keyframes[0].t, 0, "each half starts at zero");
  assert.equal(second.keyframes[0].t, 0);
  assertOrdered(first, "first half");
  assertOrdered(second, "second half");
});

test("splitting at an endpoint is refused rather than making an empty take", () => {
  const clip = takeOf("a", [0, 10, 20]);
  assert.equal(splitClip(clip, 0, "x", "y"), null);
  assert.equal(splitClip(clip, 2, "x", "y"), null);
  assert.equal(splitClip(takeOf("b", [0, 10]), 1, "x", "y"), null);
});

test("splitting respects the trim, not the raw recording", () => {
  const clip = takeOf("a", [0, 10, 20, 30, 40, 50]);
  setTrimIn(clip, 1);
  setTrimOut(clip, 4);

  const [first, second] = splitClip(clip, 1, "a1", "a2")!;
  assert.equal(first.keyframes[0].joints.torso.p.x, 10);
  assert.equal(second.keyframes[second.keyframes.length - 1].joints.torso.p.x, 40);
});

// --- merge ------------------------------------------------------------------

test("merging joins two takes end to end with a gap", () => {
  const a = takeOf("a", [0, 10]);
  const b = takeOf("b", [100, 110]);
  const merged = mergeClips(a, b, "m", 0.5)!;

  assert.equal(merged.keyframes.length, 4);
  assert.equal(merged.keyframes[0].t, 0);
  assert.ok(Math.abs(merged.keyframes[2].t - (0.4 + 0.5)) < 1e-9);
  assert.equal(merged.keyframes[2].joints.torso.p.x, 100);
  assertOrdered(merged, "merged");
});

test("merging a live take into a posed one keeps it out of beat quantization", () => {
  const a = takeOf("a", [0, 10]);
  const b = takeOf("b", [100, 110]);
  b.source = "performance";
  assert.equal(mergeClips(a, b, "m")!.source, "performance");
  assert.equal(mergeClips(a, takeOf("c", [1, 2]), "m")!.source, "stopmotion");
});

test("merging keeps whichever caption exists", () => {
  const a = takeOf("a", [0, 10]);
  const b = takeOf("b", [100, 110]);
  b.caption = "and then";
  assert.equal(mergeClips(a, b, "m")!.caption, "and then");
});

// --- reverse / ping-pong ----------------------------------------------------

test("reversing plays the poses backwards over the same span", () => {
  const clip = takeOf("a", [0, 10, 30]);
  const reversed = reverseClip(clip, "r");

  assert.deepEqual(
    reversed.keyframes.map((k) => k.joints.torso.p.x),
    [30, 10, 0]
  );
  assert.ok(Math.abs(clipDuration(reversed) - clipDuration(clip)) < 1e-9);
  assertOrdered(reversed, "reversed");
});

test("reversing twice returns the original poses", () => {
  const clip = takeOf("a", [0, 10, 30, 45]);
  const back = reverseClip(reverseClip(clip, "r1"), "r2");
  assert.deepEqual(
    back.keyframes.map((k) => k.joints.torso.p.x),
    clip.keyframes.map((k) => k.joints.torso.p.x)
  );
});

test("ping-pong runs out and back without pausing at the turnaround", () => {
  const clip = takeOf("a", [0, 10, 30]);
  const pp = pingPongClip(clip, "p")!;

  assert.deepEqual(
    pp.keyframes.map((k) => k.joints.torso.p.x),
    [0, 10, 30, 10, 0]
  );
  assertOrdered(pp, "ping-pong");
  assert.ok(Math.abs(clipDuration(pp) - clipDuration(clip) * 2) < 1e-9);
});

test("ping-pong needs something to bounce", () => {
  assert.equal(pingPongClip(takeOf("a", [0]), "p"), null);
});

// --- loop -------------------------------------------------------------------

test("loop blending returns to the opening pose so a cycle closes", () => {
  const clip = takeOf("a", [0, 10, 30]);
  assert.equal(isLoopClosed(clip), false);

  const looped = loopBlendClip(clip, "l")!;
  assert.equal(isLoopClosed(looped), true);
  assert.equal(looped.keyframes.length, 4);
  assert.equal(looped.keyframes[3].joints.torso.p.x, 0);
  assertOrdered(looped, "looped");
});

test("loop blending an already-closed cycle stays closed", () => {
  const clip = takeOf("a", [0, 10, 0]);
  assert.equal(isLoopClosed(clip), true);
  assert.equal(isLoopClosed(loopBlendClip(clip, "l")!), true);
});

// --- retime / hold ----------------------------------------------------------

test("retiming scales duration without touching poses", () => {
  const clip = takeOf("a", [0, 10, 30]);
  const fast = retimeClip(clip, "f", 2)!;

  assert.ok(Math.abs(clipDuration(fast) - clipDuration(clip) / 2) < 1e-9);
  assert.deepEqual(
    fast.keyframes.map((k) => k.joints.torso.p.x),
    [0, 10, 30]
  );
  assertOrdered(fast, "retimed");
});

test("a nonsense retime factor is refused", () => {
  const clip = takeOf("a", [0, 10]);
  assert.equal(retimeClip(clip, "f", 0), null);
  assert.equal(retimeClip(clip, "f", -1), null);
  assert.equal(retimeClip(clip, "f", NaN), null);
});

test("holding the last pose extends the take and carries the trim", () => {
  const clip = takeOf("a", [0, 10]);
  const before = clip.keyframes.length;
  holdLastPose(clip, 0.6);

  assert.equal(clip.keyframes.length, before + 1);
  assert.equal(clip.trimOut, clip.keyframes.length - 1);
  assert.equal(clip.keyframes[before].joints.torso.p.x, 10);
  assertOrdered(clip, "held");
});

test("a zero hold changes nothing", () => {
  const clip = takeOf("a", [0, 10]);
  holdLastPose(clip, 0);
  assert.equal(clip.keyframes.length, 2);
});

// --- guards -----------------------------------------------------------------

test("overlong takes are flagged so a reel stays demo length", () => {
  assert.equal(isOverlong(takeOf("a", [0, 10, 20])), false);

  const long = createClip("b", "b", "performance");
  appendKeyframe(long, { t: 0, joints: pose(0) });
  appendKeyframe(long, { t: MAX_CLIP_SECONDS + 1, joints: pose(10) });
  assert.equal(isOverlong(long), true);
});

test("every operation leaves the source take untouched", () => {
  const clip = takeOf("a", [0, 10, 30, 45]);
  const snapshot = JSON.stringify(clip);

  splitClip(clip, 1, "x", "y");
  mergeClips(clip, takeOf("b", [1, 2]), "m");
  reverseClip(clip, "r");
  pingPongClip(clip, "p");
  loopBlendClip(clip, "l");
  retimeClip(clip, "t", 2);

  assert.equal(JSON.stringify(clip), snapshot);
});

test("operations preserve the full pose, not just the joints that moved", () => {
  const clip = takeOf("a", [0, 10, 30]);
  const ops: Clip[] = [
    reverseClip(clip, "r"),
    pingPongClip(clip, "p")!,
    loopBlendClip(clip, "l")!,
    retimeClip(clip, "t", 2)!,
  ];
  for (const result of ops) {
    for (const keyframe of trimmedKeyframes(result)) {
      assert.ok(keyframe.joints["arm.L"], `${result.name} dropped a joint`);
    }
  }
});
