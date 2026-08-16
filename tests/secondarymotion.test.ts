import { strict as assert } from "node:assert";
import { test } from "node:test";

import { appendKeyframe, createClip } from "../Assets/Scripts/Logic/Clip";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { buildRigPlan } from "../Assets/Scripts/Logic/RigPlan";
import {
  DEFAULT_SECONDARY_MOTION,
  applySecondaryMotion,
  jointDepths,
} from "../Assets/Scripts/Logic/SecondaryMotion";
import {
  Q_IDENTITY,
  qAngle,
  qDot,
  qFromAxisAngle,
  v3,
} from "../Assets/Scripts/Logic/Vec";

const plan = buildRigPlan("a clay dragon in a top hat");

/**
 * A take where ONLY the torso is rotated — every limb is left exactly at rest,
 * which is what hand-posing in AR actually produces.
 */
function torsoSwingClip(): ReturnType<typeof createClip> {
  const clip = createClip("c1", "Take 1", "stopmotion", "smooth");
  const angles = [0, 0.9, 0.9, 0.9];

  angles.forEach((angle, i) => {
    const joints: PoseSample = {};
    for (const joint of plan.joints) {
      if (!joint.poseable) {
        continue;
      }
      joints[joint.id] = {
        p: { ...joint.offset },
        r:
          joint.id === "torso"
            ? qFromAxisAngle(v3(0, 1, 0), angle)
            : { ...Q_IDENTITY },
      };
    }
    appendKeyframe(clip, { t: i * 0.4, joints });
  });
  return clip;
}

test("joint depth is measured from the rig root", () => {
  const depths = jointDepths(plan);
  assert.equal(depths.root, 0);
  assert.equal(depths.hips, 1);
  assert.equal(depths.torso, 2);
  assert.equal(depths.neck, 3);
  assert.equal(depths.head, 4);
  assert.ok(depths["wing.L"] > depths.torso);
});

test("limbs pick up motion the user never posed into them", () => {
  const clip = torsoSwingClip();
  const dragged = applySecondaryMotion(clip, plan, DEFAULT_SECONDARY_MOTION);

  // In the original take, the wing is at rest in every single keyframe.
  for (const keyframe of clip.keyframes) {
    assert.ok(qAngle(Q_IDENTITY, keyframe.joints["wing.L"].r) < 1e-9);
  }

  // After follow-through, it moves.
  let moved = 0;
  for (const keyframe of dragged.keyframes) {
    if (qAngle(Q_IDENTITY, keyframe.joints["wing.L"].r) > 1e-4) {
      moved++;
    }
  }
  assert.ok(moved >= 2, `wing should trail the torso, moved in ${moved} keyframes`);
});

test("the opening pose is left exactly as the user placed it", () => {
  const clip = torsoSwingClip();
  const dragged = applySecondaryMotion(clip, plan, DEFAULT_SECONDARY_MOTION);
  assert.deepEqual(dragged.keyframes[0].joints, clip.keyframes[0].joints);
});

test("anchored joints are never touched", () => {
  const clip = torsoSwingClip();
  const dragged = applySecondaryMotion(clip, plan, DEFAULT_SECONDARY_MOTION);

  for (let i = 0; i < clip.keyframes.length; i++) {
    for (const anchor of DEFAULT_SECONDARY_MOTION.anchors) {
      const before = clip.keyframes[i].joints[anchor];
      const after = dragged.keyframes[i].joints[anchor];
      if (before && after) {
        assert.deepEqual(after.r, before.r, `${anchor} was modified at keyframe ${i}`);
      }
    }
  }
});

test("deeper joints trail further than shallow ones", () => {
  const clip = torsoSwingClip();
  const dragged = applySecondaryMotion(clip, plan, DEFAULT_SECONDARY_MOTION);

  const deviation = (jointId: string) => {
    let total = 0;
    for (const keyframe of dragged.keyframes) {
      total += qAngle(Q_IDENTITY, keyframe.joints[jointId].r);
    }
    return total;
  };

  // head sits at depth 4, neck at 3.
  assert.ok(
    deviation("head") >= deviation("neck"),
    "the head should lag more than the neck it hangs from"
  );
});

test("the effect is pure — the recorded take is never mutated", () => {
  const clip = torsoSwingClip();
  const snapshot = JSON.stringify(clip);
  applySecondaryMotion(clip, plan, DEFAULT_SECONDARY_MOTION);
  assert.equal(JSON.stringify(clip), snapshot);
});

test("every produced rotation is a unit quaternion", () => {
  const clip = torsoSwingClip();
  const dragged = applySecondaryMotion(clip, plan, DEFAULT_SECONDARY_MOTION);

  for (const keyframe of dragged.keyframes) {
    for (const jointId in keyframe.joints) {
      const r = keyframe.joints[jointId].r;
      const length = Math.sqrt(qDot(r, r));
      assert.ok(Math.abs(length - 1) < 1e-9, `${jointId} rotation is not unit: ${length}`);
    }
  }
});

test("zero drag and zero overshoot is a no-op", () => {
  const clip = torsoSwingClip();
  const dragged = applySecondaryMotion(clip, plan, {
    ...DEFAULT_SECONDARY_MOTION,
    drag: 0,
    overshoot: 0,
  });

  for (let i = 0; i < clip.keyframes.length; i++) {
    for (const jointId in clip.keyframes[i].joints) {
      assert.ok(
        qAngle(clip.keyframes[i].joints[jointId].r, dragged.keyframes[i].joints[jointId].r) <
          1e-6,
        `${jointId} changed at keyframe ${i} with the effect disabled`
      );
    }
  }
});

test("a clip too short to have motion passes straight through", () => {
  const clip = createClip("c1", "Take 1", "stopmotion");
  appendKeyframe(clip, { t: 0, joints: { torso: { p: v3(0, 0, 0), r: { ...Q_IDENTITY } } } });
  const dragged = applySecondaryMotion(clip, plan, DEFAULT_SECONDARY_MOTION);
  assert.deepEqual(dragged.keyframes, clip.keyframes);
});

test("a still take stays still", () => {
  const clip = createClip("c1", "Take 1", "stopmotion");
  for (let i = 0; i < 4; i++) {
    const joints: PoseSample = {};
    for (const joint of plan.joints) {
      if (joint.poseable) {
        joints[joint.id] = { p: { ...joint.offset }, r: { ...Q_IDENTITY } };
      }
    }
    appendKeyframe(clip, { t: i * 0.4, joints });
  }

  const dragged = applySecondaryMotion(clip, plan, DEFAULT_SECONDARY_MOTION);
  for (const keyframe of dragged.keyframes) {
    for (const jointId in keyframe.joints) {
      assert.ok(
        qAngle(Q_IDENTITY, keyframe.joints[jointId].r) < 1e-6,
        `${jointId} invented motion in a still take`
      );
    }
  }
});
