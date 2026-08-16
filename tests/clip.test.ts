import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  MIN_CLIP_DURATION,
  STOPMOTION_STEP,
  accentKeyframes,
  appendKeyframe,
  captureStopMotionPose,
  clipDuration,
  cloneClip,
  createClip,
  poseDelta,
  resetTrim,
  setTrimIn,
  setTrimOut,
  trimmedKeyframes,
} from "../Assets/Scripts/Logic/Clip";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { Q_IDENTITY, qFromAxisAngle, v3 } from "../Assets/Scripts/Logic/Vec";

function pose(x: number, angle = 0): PoseSample {
  return {
    torso: { p: v3(x, 0, 0), r: qFromAxisAngle(v3(0, 1, 0), angle) },
    "arm.L": { p: v3(-3, 6, 0), r: { ...Q_IDENTITY } },
  };
}

test("stop-motion capture spaces poses at the stop-motion cadence", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  captureStopMotionPose(clip, pose(0));
  captureStopMotionPose(clip, pose(1));
  captureStopMotionPose(clip, pose(2));

  assert.equal(clip.keyframes.length, 3);
  assert.equal(clip.keyframes[0].t, 0);
  assert.ok(Math.abs(clip.keyframes[1].t - STOPMOTION_STEP) < 1e-9);
  assert.ok(Math.abs(clip.keyframes[2].t - STOPMOTION_STEP * 2) < 1e-9);
});

test("keyframe times are forced to strictly increase", () => {
  const clip = createClip("c1", "Clip 1", "performance");
  appendKeyframe(clip, { t: 1, joints: pose(0) });
  appendKeyframe(clip, { t: 0.5, joints: pose(1) });
  appendKeyframe(clip, { t: 1, joints: pose(2) });

  for (let i = 1; i < clip.keyframes.length; i++) {
    assert.ok(
      clip.keyframes[i].t > clip.keyframes[i - 1].t,
      `frame ${i} at ${clip.keyframes[i].t} does not advance`
    );
  }
});

test("trim-out follows new keyframes when it was already at the end", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  captureStopMotionPose(clip, pose(0));
  captureStopMotionPose(clip, pose(1));
  assert.equal(clip.trimOut, 1);

  captureStopMotionPose(clip, pose(2));
  assert.equal(clip.trimOut, 2, "recording must not land outside the trimmed range");
});

test("a pulled-in trim handle stays put while recording continues", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  for (let i = 0; i < 4; i++) {
    captureStopMotionPose(clip, pose(i));
  }
  setTrimOut(clip, 2);
  captureStopMotionPose(clip, pose(9));
  assert.equal(clip.trimOut, 2);
});

test("trimming is non-destructive and reversible", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  for (let i = 0; i < 5; i++) {
    captureStopMotionPose(clip, pose(i));
  }
  setTrimIn(clip, 1);
  setTrimOut(clip, 3);
  assert.equal(trimmedKeyframes(clip).length, 3);
  assert.equal(clip.keyframes.length, 5, "keyframes must survive trimming");

  resetTrim(clip);
  assert.equal(trimmedKeyframes(clip).length, 5);
});

test("trim handles cannot cross each other", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  for (let i = 0; i < 5; i++) {
    captureStopMotionPose(clip, pose(i));
  }
  setTrimIn(clip, 3);
  setTrimOut(clip, 1);
  assert.ok(clip.trimOut >= clip.trimIn);

  setTrimIn(clip, 99);
  assert.ok(clip.trimIn <= clip.trimOut);
  assert.ok(clip.trimIn <= clip.keyframes.length - 1);
});

test("a single-pose clip still occupies time on the timeline", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  captureStopMotionPose(clip, pose(0));
  assert.equal(clipDuration(clip), MIN_CLIP_DURATION);
});

test("clip duration reflects the trimmed range", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  for (let i = 0; i < 6; i++) {
    captureStopMotionPose(clip, pose(i));
  }
  assert.ok(Math.abs(clipDuration(clip) - STOPMOTION_STEP * 5) < 1e-9);
  setTrimOut(clip, 2);
  assert.ok(Math.abs(clipDuration(clip) - STOPMOTION_STEP * 2) < 1e-9);
});

test("poseDelta reports the joint that moved furthest", () => {
  const a = pose(0);
  const b = pose(10);
  const delta = poseDelta(a, b);
  assert.equal(delta.jointId, "torso");
  assert.equal(delta.maxPosition, 10);
});

test("poseDelta ignores joints missing from the other pose", () => {
  const a: PoseSample = { torso: { p: v3(0, 0, 0), r: { ...Q_IDENTITY } } };
  const b: PoseSample = { tail: { p: v3(50, 0, 0), r: { ...Q_IDENTITY } } };
  assert.equal(poseDelta(a, b).maxPosition, 0);
});

test("accents mark only the big transitions", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  captureStopMotionPose(clip, pose(0));
  captureStopMotionPose(clip, pose(0.1));
  captureStopMotionPose(clip, pose(8));
  captureStopMotionPose(clip, pose(8.05));

  const accents = accentKeyframes(clip, 2, Math.PI / 4);
  assert.deepEqual(accents, [2]);
});

test("cloning a clip deep-copies its keyframes", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  captureStopMotionPose(clip, pose(0));
  const copy = cloneClip(clip, "c2");
  copy.keyframes[0].joints.torso.p.x = 999;

  assert.equal(clip.keyframes[0].joints.torso.p.x, 0);
  assert.equal(copy.id, "c2");
});
