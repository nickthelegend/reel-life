import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  appendKeyframe,
  captureStopMotionPose,
  createClip,
  setTrimIn,
  setTrimOut,
} from "../Assets/Scripts/Logic/Clip";
import {
  blendPoses,
  nearestKeyframeIndex,
  samplePose,
} from "../Assets/Scripts/Logic/PoseInterpolator";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { Q_IDENTITY, qAngle, qFromAxisAngle, v3 } from "../Assets/Scripts/Logic/Vec";

function pose(x: number, angle = 0): PoseSample {
  return {
    torso: { p: v3(x, 0, 0), r: qFromAxisAngle(v3(0, 1, 0), angle) },
  };
}

test("sampling an empty clip returns null instead of a bad pose", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  assert.equal(samplePose(clip, 0), null);
});

test("a one-pose clip holds that pose at any time", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  captureStopMotionPose(clip, pose(4));
  assert.equal(samplePose(clip, 0)!.torso.p.x, 4);
  assert.equal(samplePose(clip, 10)!.torso.p.x, 4);
});

test("endpoints are exact", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion", "smooth");
  appendKeyframe(clip, { t: 0, joints: pose(0) });
  appendKeyframe(clip, { t: 1, joints: pose(10) });

  assert.ok(Math.abs(samplePose(clip, 0)!.torso.p.x - 0) < 1e-9);
  assert.ok(Math.abs(samplePose(clip, 1)!.torso.p.x - 10) < 1e-9);
});

test("times outside the clip clamp to a held pose", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  appendKeyframe(clip, { t: 0, joints: pose(0) });
  appendKeyframe(clip, { t: 1, joints: pose(10) });

  assert.equal(samplePose(clip, -5)!.torso.p.x, 0);
  assert.equal(samplePose(clip, 99)!.torso.p.x, 10);
});

test("the default ease is symmetric around the midpoint", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion", "smooth");
  appendKeyframe(clip, { t: 0, joints: pose(0) });
  appendKeyframe(clip, { t: 1, joints: pose(10) });
  assert.ok(Math.abs(samplePose(clip, 0.5)!.torso.p.x - 5) < 1e-9);
});

test("a four-pose sequence advances monotonically with no popping", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion", "smooth");
  const positions = [0, 3, 7, 12];
  for (let i = 0; i < positions.length; i++) {
    appendKeyframe(clip, { t: i * 0.4, joints: pose(positions[i], i * 0.3) });
  }

  let previous = -Infinity;
  let previousAngle = -Infinity;
  const duration = 0.4 * (positions.length - 1);
  const steps = 240;

  for (let i = 0; i <= steps; i++) {
    const sample = samplePose(clip, (i / steps) * duration)!;
    const x = sample.torso.p.x;
    assert.ok(x >= previous - 1e-9, `x went backwards at step ${i}: ${previous} -> ${x}`);

    // No sudden jumps: with 240 samples over 1.2s nothing should move more
    // than a fraction of the total travel in one step.
    if (previous > -Infinity) {
      assert.ok(x - previous < 1.5, `pop at step ${i}: ${previous} -> ${x}`);
    }
    previous = x;

    const angle = qAngle({ ...Q_IDENTITY }, sample.torso.r);
    if (previousAngle > -Infinity) {
      assert.ok(Math.abs(angle - previousAngle) < 0.2, `rotation pop at step ${i}`);
    }
    previousAngle = angle;
  }

  assert.ok(Math.abs(previous - 12) < 1e-6, "sequence must land on the final pose");
});

test("sampling respects the trim range", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  for (let i = 0; i < 5; i++) {
    appendKeyframe(clip, { t: i * 0.4, joints: pose(i * 10) });
  }
  setTrimIn(clip, 2);
  setTrimOut(clip, 3);

  assert.equal(samplePose(clip, 0)!.torso.p.x, 20, "trimmed clip starts at its trim-in pose");
  assert.ok(Math.abs(samplePose(clip, 0.4)!.torso.p.x - 30) < 1e-9);
});

test("joints present in only one keyframe are carried through", () => {
  const a: PoseSample = { torso: { p: v3(0, 0, 0), r: { ...Q_IDENTITY } } };
  const b: PoseSample = {
    torso: { p: v3(10, 0, 0), r: { ...Q_IDENTITY } },
    tail: { p: v3(5, 5, 5), r: { ...Q_IDENTITY } },
  };
  const blended = blendPoses(a, b, 0.5);
  assert.equal(blended.torso.p.x, 5);
  assert.deepEqual(blended.tail.p, v3(5, 5, 5));
});

test("blendPoses does not alias its inputs", () => {
  const a = pose(0);
  const b = pose(10);
  const blended = blendPoses(a, b, 0.5);
  blended.torso.p.x = 999;
  assert.equal(a.torso.p.x, 0);
  assert.equal(b.torso.p.x, 10);
});

test("nearestKeyframeIndex finds the pose the onion skin should ghost", () => {
  const clip = createClip("c1", "Clip 1", "stopmotion");
  for (let i = 0; i < 4; i++) {
    appendKeyframe(clip, { t: i * 0.4, joints: pose(i) });
  }
  assert.equal(nearestKeyframeIndex(clip, 0), 0);
  assert.equal(nearestKeyframeIndex(clip, 0.39), 1);
  assert.equal(nearestKeyframeIndex(clip, 1.2), 3);
  assert.equal(nearestKeyframeIndex(createClip("x", "x", "stopmotion"), 0), -1);
});
