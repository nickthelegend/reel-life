import { strict as assert } from "node:assert";
import { test } from "node:test";

import { appendKeyframe, createClip } from "../Assets/Scripts/Logic/Clip";
import {
  DEFAULT_SMOOTH_PASSES,
  DEFAULT_SMOOTH_STRENGTH,
  copyKeyframePose,
  jitterPerFrame,
  jitterScore,
  shouldSuggestSmoothing,
  mirrorClip,
  mirrorJointId,
  mirrorPose,
  mirrorQuat,
  replaceKeyframePose,
  smoothClip,
} from "../Assets/Scripts/Logic/PoseOps";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import {
  Q_IDENTITY,
  qAngle,
  qDot,
  qFromAxisAngle,
  v3,
} from "../Assets/Scripts/Logic/Vec";

// --- mirroring --------------------------------------------------------------

test("joint ids mirror across both naming conventions", () => {
  assert.equal(mirrorJointId("arm.L"), "arm.R");
  assert.equal(mirrorJointId("arm.R"), "arm.L");
  assert.equal(mirrorJointId("wing.L"), "wing.R");
  assert.equal(mirrorJointId("leg.FL"), "leg.FR");
  assert.equal(mirrorJointId("leg.BR"), "leg.BL");
});

test("centre-line joints have no mirror", () => {
  for (const id of ["head", "torso", "hips", "neck", "tail", "root"]) {
    assert.equal(mirrorJointId(id), id);
  }
});

test("mirroring a rotation about Y reverses it", () => {
  const q = qFromAxisAngle(v3(0, 1, 0), 0.7);
  const mirrored = mirrorQuat(q);
  const expected = qFromAxisAngle(v3(0, 1, 0), -0.7);
  assert.ok(qAngle(mirrored, expected) < 1e-9);
});

test("mirroring a rotation about X leaves it alone", () => {
  const q = qFromAxisAngle(v3(1, 0, 0), 0.7);
  assert.ok(qAngle(mirrorQuat(q), q) < 1e-9);
});

test("mirroring twice is the identity", () => {
  const q = qFromAxisAngle(v3(0.3, 0.7, -0.2), 1.1);
  assert.ok(qAngle(mirrorQuat(mirrorQuat(q)), q) < 1e-9);
});

test("mirrored rotations stay unit length", () => {
  const q = qFromAxisAngle(v3(0.3, 0.7, -0.2), 1.1);
  const mirrored = mirrorQuat(q);
  assert.ok(Math.abs(Math.sqrt(qDot(mirrored, mirrored)) - 1) < 1e-9);
});

test("a mirrored pose swaps limbs and flips them across the centre line", () => {
  const pose: PoseSample = {
    "arm.L": { p: v3(-3, 6, 1), r: qFromAxisAngle(v3(0, 1, 0), 0.5) },
    "arm.R": { p: v3(3, 6, 1), r: { ...Q_IDENTITY } },
    head: { p: v3(0, 10, 0), r: qFromAxisAngle(v3(0, 1, 0), 0.2) },
  };
  const mirrored = mirrorPose(pose);

  assert.deepEqual(mirrored["arm.R"].p, v3(3, 6, 1));
  assert.deepEqual(mirrored["arm.L"].p, v3(-3, 6, 1));
  assert.ok(qAngle(mirrored["arm.R"].r, qFromAxisAngle(v3(0, 1, 0), -0.5)) < 1e-9);
  assert.ok(qAngle(mirrored.head.r, qFromAxisAngle(v3(0, 1, 0), -0.2)) < 1e-9);
});

test("mirroring a pose twice returns the original", () => {
  const pose: PoseSample = {
    "arm.L": { p: v3(-3, 6, 1), r: qFromAxisAngle(v3(0.2, 1, 0), 0.5) },
    "arm.R": { p: v3(4, 6, 1), r: qFromAxisAngle(v3(0, 1, 0.3), 0.9) },
  };
  const back = mirrorPose(mirrorPose(pose));

  for (const id in pose) {
    assert.deepEqual(back[id].p, pose[id].p);
    assert.ok(qAngle(back[id].r, pose[id].r) < 1e-9);
  }
});

test("mirroring a clip mirrors every keyframe and leaves the source alone", () => {
  const clip = createClip("a", "Take 1", "stopmotion");
  for (let i = 0; i < 3; i++) {
    appendKeyframe(clip, {
      t: i * 0.4,
      joints: {
        "arm.L": { p: v3(-3, i, 0), r: qFromAxisAngle(v3(0, 1, 0), i * 0.3) },
        "arm.R": { p: v3(3, i, 0), r: { ...Q_IDENTITY } },
      },
    });
  }
  const snapshot = JSON.stringify(clip);
  const mirrored = mirrorClip(clip, "b");

  assert.equal(JSON.stringify(clip), snapshot);
  assert.equal(mirrored.keyframes.length, 3);
  // The left arm at x=-3 becomes the right arm at x=+3.
  assert.deepEqual(mirrored.keyframes[1].joints["arm.R"].p, v3(3, 1, 0));
  assert.deepEqual(mirrored.keyframes[1].joints["arm.L"].p, v3(-3, 1, 0));
});

// --- smoothing --------------------------------------------------------------

/** A straight travel with a repeatable tremor laid over it. */
function jitteryTake() {
  const clip = createClip("a", "Take 1", "performance");
  const wobble = [0, 1.4, -1.2, 1.1, -1.5, 1.3, -1.1, 0.9, -1.4, 0];
  for (let i = 0; i < wobble.length; i++) {
    appendKeyframe(clip, {
      t: i / 12,
      joints: {
        head: {
          p: v3(i * 2 + wobble[i], 0, 0),
          r: qFromAxisAngle(v3(0, 1, 0), i * 0.05 + wobble[i] * 0.05),
        },
      },
    });
  }
  return clip;
}

test("smoothing removes tremor from a live take", () => {
  const clip = jitteryTake();
  const before = jitterScore(clip, "head");
  const smoothed = smoothClip(clip, "b", 0.8, 3);
  const after = jitterScore(smoothed, "head");

  assert.ok(after < before * 0.25, `jitter ${before.toFixed(2)} -> ${after.toFixed(2)}`);
});

test("smoothing pins the first and last pose the user recorded", () => {
  const clip = jitteryTake();
  const smoothed = smoothClip(clip, "b", 0.8, 3);
  const last = clip.keyframes.length - 1;

  assert.deepEqual(smoothed.keyframes[0].joints.head.p, clip.keyframes[0].joints.head.p);
  assert.deepEqual(smoothed.keyframes[last].joints.head.p, clip.keyframes[last].joints.head.p);
});

test("smoothing keeps the overall travel, it does not flatten the take", () => {
  const clip = jitteryTake();
  const smoothed = smoothClip(clip, "b", 0.8, 3);
  const last = smoothed.keyframes.length - 1;

  const travel = smoothed.keyframes[last].joints.head.p.x - smoothed.keyframes[0].joints.head.p.x;
  assert.ok(travel > 15, `travel collapsed to ${travel}`);
});

test("smoothing keeps timing and rotations valid", () => {
  const smoothed = smoothClip(jitteryTake(), "b", 0.8, 3);
  for (let i = 0; i < smoothed.keyframes.length; i++) {
    const r = smoothed.keyframes[i].joints.head.r;
    assert.ok(Math.abs(Math.sqrt(qDot(r, r)) - 1) < 1e-9, `frame ${i} rotation is not unit`);
    if (i > 0) {
      assert.ok(smoothed.keyframes[i].t > smoothed.keyframes[i - 1].t);
    }
  }
});

test("zero strength or zero passes is a no-op", () => {
  const clip = jitteryTake();
  assert.equal(
    JSON.stringify(smoothClip(clip, "b", 0, 3).keyframes),
    JSON.stringify(clip.keyframes)
  );
  assert.equal(
    JSON.stringify(smoothClip(clip, "b", 0.8, 0).keyframes),
    JSON.stringify(clip.keyframes)
  );
});

test("a take too short to smooth passes through untouched", () => {
  const clip = createClip("a", "Take 1", "stopmotion");
  appendKeyframe(clip, { t: 0, joints: { head: { p: v3(0, 0, 0), r: { ...Q_IDENTITY } } } });
  appendKeyframe(clip, { t: 0.4, joints: { head: { p: v3(5, 0, 0), r: { ...Q_IDENTITY } } } });
  assert.equal(
    JSON.stringify(smoothClip(clip, "b").keyframes),
    JSON.stringify(clip.keyframes)
  );
});

test("smoothing never mutates the recorded take", () => {
  const clip = jitteryTake();
  const snapshot = JSON.stringify(clip);
  smoothClip(clip, "b", 0.9, 4);
  assert.equal(JSON.stringify(clip), snapshot);
});

// --- copy / paste -----------------------------------------------------------

test("a pose copies out of one keyframe and pastes into another", () => {
  const clip = createClip("a", "Take 1", "stopmotion");
  for (let i = 0; i < 3; i++) {
    appendKeyframe(clip, {
      t: i * 0.4,
      joints: { head: { p: v3(i * 10, 0, 0), r: { ...Q_IDENTITY } } },
    });
  }

  const copied = copyKeyframePose(clip, 0)!;
  assert.ok(replaceKeyframePose(clip, 2, copied));
  assert.equal(clip.keyframes[2].joints.head.p.x, 0);

  // The paste is a copy: editing the source afterwards must not reach through.
  copied.head.p.x = 999;
  assert.equal(clip.keyframes[2].joints.head.p.x, 0);
});

test("copy and paste refuse out-of-range keyframes", () => {
  const clip = createClip("a", "Take 1", "stopmotion");
  appendKeyframe(clip, { t: 0, joints: { head: { p: v3(0, 0, 0), r: { ...Q_IDENTITY } } } });

  assert.equal(copyKeyframePose(clip, 5), null);
  assert.equal(copyKeyframePose(clip, -1), null);
  assert.equal(replaceKeyframePose(clip, 5, {}), false);
});

// --- smoothing suggestion ---------------------------------------------------

test("a shaky live take is flagged for smoothing", () => {
  assert.equal(shouldSuggestSmoothing(jitteryTake(), ["head"]), true);
});

test("the smooth/suggest loop converges — smoothing clears the flag", () => {
  const clip = jitteryTake();
  assert.equal(shouldSuggestSmoothing(clip, ["head"]), true);

  const smoothed = smoothClip(
    clip,
    "b",
    DEFAULT_SMOOTH_STRENGTH,
    DEFAULT_SMOOTH_PASSES
  );
  smoothed.source = "performance";
  assert.equal(
    shouldSuggestSmoothing(smoothed, ["head"]),
    false,
    "default smoothing must clear the flag or the app re-offers it forever"
  );
});

test("the default smoothing is what smoothClip applies with no arguments", () => {
  const explicit = smoothClip(
    jitteryTake(),
    "b",
    DEFAULT_SMOOTH_STRENGTH,
    DEFAULT_SMOOTH_PASSES
  );
  assert.equal(
    JSON.stringify(smoothClip(jitteryTake(), "b").keyframes),
    JSON.stringify(explicit.keyframes)
  );
});

test("deliberate stop-motion poses are never flagged as tremor", () => {
  const clip = jitteryTake();
  clip.source = "stopmotion";
  assert.equal(shouldSuggestSmoothing(clip, ["head"]), false);
});

test("a take too short to judge is not flagged", () => {
  const clip = createClip("a", "Take 1", "performance");
  for (let i = 0; i < 3; i++) {
    appendKeyframe(clip, {
      t: i / 12,
      joints: { head: { p: v3(i * 40, 0, 0), r: { ...Q_IDENTITY } } },
    });
  }
  assert.equal(shouldSuggestSmoothing(clip, ["head"]), false);
});

test("steady fast travel is not mistaken for tremor", () => {
  const clip = createClip("a", "Take 1", "performance");
  for (let i = 0; i < 12; i++) {
    appendKeyframe(clip, {
      t: i / 12,
      joints: { head: { p: v3(i * 40, 0, 0), r: { ...Q_IDENTITY } } },
    });
  }
  assert.equal(jitterPerFrame(clip, ["head"]), 0);
  assert.equal(shouldSuggestSmoothing(clip, ["head"]), false);
});
