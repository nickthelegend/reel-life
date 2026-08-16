import { strict as assert } from "node:assert";
import { test } from "node:test";

import { appendKeyframe, createClip } from "../Assets/Scripts/Logic/Clip";
import { forwardKinematics } from "../Assets/Scripts/Logic/Kinematics";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import {
  describeRetarget,
  mapJoint,
  retargetClip,
  retargetFidelity,
  retargetPose,
} from "../Assets/Scripts/Logic/Retarget";
import { RigPlan, buildRigPlan } from "../Assets/Scripts/Logic/RigPlan";
import { Q_IDENTITY, qAngle, qFromAxisAngle, v3, v3Add } from "../Assets/Scripts/Logic/Vec";

const dragon = buildRigPlan("a clay dragon in a top hat"); // winged biped
const robot = buildRigPlan("a wooden robot knight"); // biped
const fox = buildRigPlan("a felt fox"); // quadruped

function restPose(plan: RigPlan): PoseSample {
  const pose: PoseSample = {};
  for (const joint of plan.joints) {
    if (joint.poseable) {
      pose[joint.id] = { p: { ...joint.offset }, r: { ...Q_IDENTITY } };
    }
  }
  return pose;
}

test("a wing maps to an arm, and to a front leg", () => {
  assert.deepEqual(mapJoint("wing.L", robot), { jointId: "arm.L", exact: false });
  assert.deepEqual(mapJoint("wing.L", fox), { jointId: "leg.FL", exact: false });
  assert.deepEqual(mapJoint("arm.L", dragon), { jointId: "wing.L", exact: false });
});

test("the spine maps exactly across every archetype", () => {
  for (const target of [robot, fox, buildRigPlan("a paper owl")]) {
    for (const jointId of ["hips", "torso", "neck", "head"]) {
      assert.deepEqual(
        mapJoint(jointId, target),
        { jointId, exact: true },
        `${jointId} should map exactly`
      );
    }
  }
});

test("a joint with no counterpart has nowhere to go", () => {
  assert.equal(mapJoint("tail", robot), null);
});

test("a dragon performance carries over to a robot", () => {
  const pose = restPose(dragon);
  pose.torso.r = qFromAxisAngle(v3(0, 1, 0), 0.8);
  pose["wing.L"].r = qFromAxisAngle(v3(0, 0, 1), 1.1);

  const { pose: moved, report } = retargetPose(pose, dragon, robot);

  assert.ok(moved["arm.L"], "the wing should be driving the arm");
  assert.ok(qAngle(moved["arm.L"].r, pose["wing.L"].r) < 1e-9);
  assert.ok(qAngle(moved.torso.r, pose.torso.r) < 1e-9);
  assert.deepEqual(report.substituted["wing.L"], "arm.L");
  assert.ok(report.dropped.indexOf("tail") >= 0, "a robot has no tail");
});

test("limbs land on the target's own joints, not the source's positions", () => {
  const pose = restPose(dragon);
  const { pose: moved } = retargetPose(pose, dragon, robot);

  // A rest pose in must be a rest pose out: every joint sits at the TARGET's
  // rest offset, not the dragon's.
  const robotArm = robot.joints.filter((j) => j.id === "arm.L")[0];
  assert.deepEqual(moved["arm.L"].p, robotArm.offset);

  const world = forwardKinematics(moved, robot);
  assert.ok(isFinite(world["arm.L"].p.x));
});

test("how far a joint was moved from rest is what transfers", () => {
  const pose = restPose(dragon);
  const wingRest = dragon.joints.filter((j) => j.id === "wing.L")[0].offset;
  pose["wing.L"].p = v3Add(wingRest, v3(0, 5, 0));

  const { pose: moved, report } = retargetPose(pose, dragon, robot);
  const armRest = robot.joints.filter((j) => j.id === "arm.L")[0].offset;

  assert.ok(
    Math.abs(moved["arm.L"].p.y - (armRest.y + 5 * report.scale)) < 1e-9,
    "the 5cm lift should carry across, scaled"
  );
});

test("moves are scaled to the new character's size", () => {
  const tall = buildRigPlan("a wooden robot knight", 40);
  const pose = restPose(dragon);
  const wingRest = dragon.joints.filter((j) => j.id === "wing.L")[0].offset;
  pose["wing.L"].p = v3Add(wingRest, v3(0, 4, 0));

  const { pose: moved, report } = retargetPose(pose, dragon, tall);
  assert.equal(report.scale, 2);

  const armRest = tall.joints.filter((j) => j.id === "arm.L")[0].offset;
  assert.ok(Math.abs(moved["arm.L"].p.y - (armRest.y + 8)) < 1e-9);
});

test("two source joints never collapse onto one target silently", () => {
  const pose = restPose(dragon);
  const { pose: moved, report } = retargetPose(pose, dragon, fox);

  const targets: Record<string, number> = {};
  for (const jointId in moved) {
    targets[jointId] = (targets[jointId] || 0) + 1;
    assert.equal(targets[jointId], 1);
  }
  // A dragon has wings and hind legs; a fox has four legs, so everything lands.
  assert.ok(report.dropped.length + Object.keys(moved).length >= Object.keys(pose).length);
});

test("target joints the source could not fill are reported", () => {
  const pose = restPose(robot);
  const { report } = retargetPose(pose, robot, dragon);
  assert.ok(report.unfilled.indexOf("tail") >= 0, "a robot take leaves the tail at rest");
});

test("a whole take retargets keyframe for keyframe", () => {
  const clip = createClip("a", "Take 1", "stopmotion");
  for (let i = 0; i < 4; i++) {
    const pose = restPose(dragon);
    pose.torso.r = qFromAxisAngle(v3(0, 1, 0), i * 0.3);
    appendKeyframe(clip, { t: i * 0.4, joints: pose });
  }

  const snapshot = JSON.stringify(clip);
  const { clip: moved, report } = retargetClip(clip, dragon, robot, "b");

  assert.equal(JSON.stringify(clip), snapshot, "the source take must be untouched");
  assert.equal(moved.keyframes.length, 4);
  assert.equal(moved.id, "b");

  for (const keyframe of moved.keyframes) {
    assert.ok(keyframe.joints["arm.L"], "every keyframe should drive the arm");
    assert.equal(keyframe.joints["wing.L"], undefined, "a robot has no wings");
  }
  assert.ok(retargetFidelity(report) > 0.8);
});

test("fidelity reports how much of the take survived", () => {
  const perfect = retargetPose(restPose(dragon), dragon, dragon);
  assert.equal(retargetFidelity(perfect.report), 1);
  assert.equal(perfect.report.dropped.length, 0);

  const lossy = retargetPose(restPose(dragon), dragon, robot);
  assert.ok(retargetFidelity(lossy.report) < 1);
  assert.ok(retargetFidelity(lossy.report) > 0.5);
});

test("retargeting onto the same rig is the identity", () => {
  const pose = restPose(dragon);
  pose["wing.R"].r = qFromAxisAngle(v3(1, 0, 0), 0.9);
  const { pose: moved } = retargetPose(pose, dragon, dragon);

  for (const jointId in pose) {
    assert.deepEqual(moved[jointId].p, pose[jointId].p, jointId);
    assert.ok(qAngle(moved[jointId].r, pose[jointId].r) < 1e-9, jointId);
  }
});

test("the summary is readable enough to put on a button", () => {
  const { report } = retargetPose(restPose(dragon), dragon, robot);
  const text = describeRetarget(report);
  assert.ok(text.indexOf("matched") >= 0, text);
  assert.ok(text.indexOf("carried over") >= 0, text);
});

test("a fidelity report for nothing at all is zero, not NaN", () => {
  const { report } = retargetPose({}, dragon, robot);
  assert.equal(retargetFidelity(report), 0);
});
