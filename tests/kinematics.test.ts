import { strict as assert } from "node:assert";
import { test } from "node:test";

import { appendKeyframe, createClip } from "../Assets/Scripts/Logic/Clip";
import {
  arcRatio,
  extremityJoints,
  forwardKinematics,
  jointArc,
  pathLength,
  worldPosition,
  worldTravel,
} from "../Assets/Scripts/Logic/Kinematics";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { RigPlan, buildRigPlan } from "../Assets/Scripts/Logic/RigPlan";
import {
  Q_IDENTITY,
  qFromAxisAngle,
  qRotate,
  v3,
  v3Distance,
} from "../Assets/Scripts/Logic/Vec";

const plan = buildRigPlan("a clay dragon in a top hat");

function restPose(source: RigPlan): PoseSample {
  const pose: PoseSample = {};
  for (const joint of source.joints) {
    pose[joint.id] = { p: { ...joint.offset }, r: { ...Q_IDENTITY } };
  }
  return pose;
}

// --- quaternion-vector rotation --------------------------------------------

test("rotating a vector by identity leaves it alone", () => {
  assert.deepEqual(qRotate(Q_IDENTITY, v3(1, 2, 3)), v3(1, 2, 3));
});

test("a quarter turn about Y sends +X to -Z", () => {
  const q = qFromAxisAngle(v3(0, 1, 0), Math.PI / 2);
  const rotated = qRotate(q, v3(1, 0, 0));
  assert.ok(Math.abs(rotated.x) < 1e-9);
  assert.ok(Math.abs(rotated.y) < 1e-9);
  assert.ok(Math.abs(rotated.z + 1) < 1e-9, `expected z=-1, got ${rotated.z}`);
});

test("rotation preserves length", () => {
  const q = qFromAxisAngle(v3(0.3, 1, -0.4), 1.2);
  const v = v3(3, -4, 5);
  const rotated = qRotate(q, v);
  const before = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const after = Math.sqrt(rotated.x ** 2 + rotated.y ** 2 + rotated.z ** 2);
  assert.ok(Math.abs(before - after) < 1e-9);
});

// --- forward kinematics -----------------------------------------------------

test("at rest, world position is the sum of the offsets up the chain", () => {
  const world = forwardKinematics(restPose(plan), plan);
  const hips = plan.joints.filter((j) => j.id === "hips")[0];
  const neck = plan.joints.filter((j) => j.id === "neck")[0];

  // root -> hips -> torso -> neck -> head, with only hips and neck offset.
  const expectedY = hips.offset.y + neck.offset.y;
  assert.ok(
    Math.abs(world.head.p.y - expectedY) < 1e-9,
    `head at y=${world.head.p.y}, expected ${expectedY}`
  );
});

test("rotating the torso swings the head around it", () => {
  const rest = restPose(plan);
  const restHead = forwardKinematics(rest, plan).head.p;

  const turned = restPose(plan);
  turned.torso.r = qFromAxisAngle(v3(0, 0, 1), Math.PI / 2);
  const turnedHead = forwardKinematics(turned, plan).head.p;

  assert.ok(
    v3Distance(restHead, turnedHead) > 1,
    "a torso rotation must move the head in world space"
  );
});

test("a joint missing from the pose falls back to its rest offset", () => {
  const partial: PoseSample = {
    torso: { p: v3(0, 0, 0), r: { ...Q_IDENTITY } },
  };
  const world = forwardKinematics(partial, plan);
  assert.ok(world.head, "the whole skeleton must still resolve");
  assert.ok(isFinite(world.head.p.y));
});

test("world position helper agrees with the full solve", () => {
  const pose = restPose(plan);
  assert.deepEqual(worldPosition(pose, plan, "head"), forwardKinematics(pose, plan).head.p);
});

test("an unknown joint reports the origin rather than throwing", () => {
  assert.deepEqual(worldPosition(restPose(plan), plan, "nope"), v3(0, 0, 0));
});

// --- arcs -------------------------------------------------------------------

/** Swing the torso through an angle so the head traces a curve. */
function swingTake(angles: number[]) {
  const clip = createClip("a", "Take 1", "stopmotion", "linear");
  angles.forEach((angle, i) => {
    const pose = restPose(plan);
    pose.torso.r = qFromAxisAngle(v3(0, 0, 1), angle);
    appendKeyframe(clip, { t: i * 0.4, joints: pose });
  });
  return clip;
}

test("a swinging joint traces a path through space", () => {
  const arc = jointArc(swingTake([0, 0.6, 1.2]), plan, "head");
  assert.ok(arc.length > 5, `expected a path, got ${arc.length} points`);
  assert.ok(pathLength(arc) > 1);
});

test("a still take produces no arc worth drawing", () => {
  const arc = jointArc(swingTake([0, 0, 0]), plan, "head");
  assert.ok(pathLength(arc) < 1e-6);
});

test("a rotating joint arcs rather than travelling straight", () => {
  const ratio = arcRatio(jointArc(swingTake([0, 1.2, 2.4]), plan, "head"));
  assert.ok(ratio > 1.02, `path should curve, ratio was ${ratio}`);
  assert.ok(isFinite(ratio));
});

test("a straight-line path reports a ratio of one", () => {
  const straight = [v3(0, 0, 0), v3(1, 0, 0), v3(2, 0, 0), v3(3, 0, 0)];
  assert.ok(Math.abs(arcRatio(straight) - 1) < 1e-9);
});

test("arc ratio handles degenerate paths", () => {
  assert.equal(arcRatio([]), 1);
  assert.equal(arcRatio([v3(0, 0, 0)]), 1);
  assert.equal(arcRatio([v3(0, 0, 0), v3(0, 0, 0)]), 1);
});

test("nearly-coincident samples are dropped so the ribbon has no stacked points", () => {
  const arc = jointArc(swingTake([0, 0.6, 1.2]), plan, "head", {
    samples: 200,
    minSpacingCm: 1,
  });
  for (let i = 1; i < arc.length; i++) {
    assert.ok(
      v3Distance(arc[i - 1], arc[i]) >= 1 - 1e-9,
      `points ${i - 1} and ${i} are too close`
    );
  }
});

test("a take too short to move has no arc", () => {
  const clip = createClip("a", "Take 1", "stopmotion");
  appendKeyframe(clip, { t: 0, joints: restPose(plan) });
  assert.deepEqual(jointArc(clip, plan, "head"), []);
});

test("extremities are the joints worth drawing arcs for", () => {
  const tips = extremityJoints(plan);
  assert.ok(tips.indexOf("head") >= 0, "the head is a tip");
  assert.ok(tips.indexOf("wing.L") >= 0);
  assert.equal(tips.indexOf("torso"), -1, "the torso has children, it is not a tip");
  assert.equal(tips.indexOf("root"), -1, "the root is not poseable");
});

test("world travel distinguishes a moving joint from a parked one", () => {
  const clip = swingTake([0, 1.2, 2.4]);
  assert.ok(worldTravel(clip, plan, "head") > 1);
  assert.ok(worldTravel(swingTake([0, 0, 0]), plan, "head") < 1e-6);
});
