import { Clip, cloneClip, trimmedKeyframes } from "./Clip";
import { samplePose } from "./PoseInterpolator";
import { PoseSample } from "./PoseTypes";
import { RigPlan } from "./RigPlan";
import {
  Q_IDENTITY,
  Quat,
  qAngle,
  qInverse,
  qMultiply,
  qNormalize,
  qSlerp,
} from "./Vec";

/**
 * Follow-through and drag — the second thing that separates animation from
 * moving an object around.
 *
 * When you swing a puppet's shoulder, its hand does not arrive at the same
 * instant: it trails, then whips past the target and settles. Hand-posing in AR
 * cannot produce that, because you place every joint at its final position at
 * the same moment.
 *
 * So it is computed. For each joint, the parent's rotation change over a short
 * lag window is measured and partially cancelled in the child's local frame —
 * the child appears to stay behind, then catch up. When the parent stops, the
 * motion it had built up is released as an overshoot. Strength grows with depth
 * in the hierarchy, so a tail tip whips more than a hip.
 *
 * The user poses five keyframes; the puppet moves like it has weight.
 */

export interface SecondaryMotionConfig {
  /** Lag window in seconds at depth 1, scaled by depth. */
  lagSeconds: number;
  /** How much of the parent's rotation is cancelled, 0..1, at depth 1. */
  drag: number;
  /** How far past the target a joint swings when the parent stops, 0..1. */
  overshoot: number;
  /** Joints that stay exactly as posed — the ones the user placed on purpose. */
  anchors: string[];
  /** Depth beyond which strength stops growing. */
  maxDepth: number;
}

export const DEFAULT_SECONDARY_MOTION: SecondaryMotionConfig = {
  lagSeconds: 0.08,
  drag: 0.45,
  overshoot: 0.35,
  // The spine is what the user deliberately poses; limbs and tails are what
  // should feel like they are being dragged along.
  anchors: ["root", "hips", "torso"],
  maxDepth: 4,
};

/** Distance from the rig root, root itself being 0. */
export function jointDepths(plan: RigPlan): Record<string, number> {
  const parents: Record<string, string | null> = {};
  for (const joint of plan.joints) {
    parents[joint.id] = joint.parent;
  }

  const depths: Record<string, number> = {};
  for (const joint of plan.joints) {
    let depth = 0;
    let cursor: string | null = joint.id;
    // Guard against a malformed rig rather than spinning forever.
    while (cursor !== null && depth <= plan.joints.length) {
      const parent: string | null = parents[cursor] === undefined ? null : parents[cursor];
      if (parent === null) {
        break;
      }
      depth++;
      cursor = parent;
    }
    depths[joint.id] = depth;
  }
  return depths;
}

/** Nearest ancestor that carries pose data, skipping joints that do not. */
function poseableParent(
  parents: Record<string, string | null>,
  plan: RigPlan,
  jointId: string,
  pose: PoseSample
): string | null {
  let cursor = parents[jointId];
  let guard = 0;
  while (cursor && guard++ <= plan.joints.length) {
    if (pose[cursor]) {
      return cursor;
    }
    cursor = parents[cursor];
  }
  return null;
}

/**
 * Returns a new clip with follow-through baked into its keyframes. Pure: the
 * input clip is untouched, so the effect can be toggled off and the original
 * performance is still there.
 */
export function applySecondaryMotion(
  clip: Clip,
  plan: RigPlan,
  config: SecondaryMotionConfig = DEFAULT_SECONDARY_MOTION
): Clip {
  const frames = trimmedKeyframes(clip);
  if (frames.length < 2) {
    return cloneClip(clip, clip.id);
  }

  const depths = jointDepths(plan);
  const result = cloneClip(clip, clip.id);
  const start = frames[0].t;

  const parents: Record<string, string | null> = {};
  for (const joint of plan.joints) {
    parents[joint.id] = joint.parent;
  }

  // Resolve each joint's parent once against the first keyframe's joint set.
  const parentOf: Record<string, string | null> = {};
  for (const jointId in frames[0].joints) {
    parentOf[jointId] = poseableParent(parents, plan, jointId, frames[0].joints);
  }

  for (let i = 0; i < result.keyframes.length; i++) {
    const keyframe = result.keyframes[i];
    const localT = keyframe.t - start;
    if (localT <= 0) {
      // The opening pose is exactly as the user left it.
      continue;
    }

    // Joints at the same depth share a lag window; sample each window once.
    const samples: Record<string, PoseSample | null> = {};
    const sampleAt = (t: number): PoseSample | null => {
      const key = t.toFixed(5);
      if (!(key in samples)) {
        samples[key] = samplePose(clip, Math.max(0, t));
      }
      return samples[key];
    };

    for (const jointId in keyframe.joints) {
      if (config.anchors.indexOf(jointId) >= 0) {
        continue;
      }
      const parentId = parentOf[jointId];
      if (!parentId) {
        continue;
      }

      const depth = Math.min(depths[jointId] || 1, config.maxDepth);
      const scale = depth / config.maxDepth;
      const lag = config.lagSeconds * depth;
      if (lag <= 0) {
        continue;
      }

      const now = sampleAt(localT);
      const lagged = sampleAt(localT - lag);
      const earlier = sampleAt(localT - lag * 2);
      if (!now || !lagged || !earlier) {
        continue;
      }

      if (!now[parentId] || !lagged[parentId] || !earlier[parentId]) {
        continue;
      }

      // World rotation, not local: a wing hangs off the torso, so what drags it
      // is everything the whole chain above it did — and a joint whose own
      // parent was never posed still inherits the swing from further up.
      keyframe.joints[jointId].r = dragRotation(
        keyframe.joints[jointId].r,
        worldRotation(lagged, parents, parentId),
        worldRotation(now, parents, parentId),
        worldRotation(earlier, parents, parentId),
        config.drag * scale,
        config.overshoot * scale
      );
    }
  }
  return result;
}

/** Accumulated rotation from the rig root down to and including `jointId`. */
function worldRotation(
  pose: PoseSample,
  parents: Record<string, string | null>,
  jointId: string
): Quat {
  let out: Quat = Q_IDENTITY;
  let cursor: string | null = jointId;
  let guard = 0;

  while (cursor && guard++ < 32) {
    const jp = pose[cursor];
    if (jp) {
      out = qMultiply(jp.r, out);
    }
    cursor = parents[cursor] === undefined ? null : parents[cursor];
  }
  return out;
}

/**
 * Cancel part of the parent's recent rotation, then release stored motion as
 * overshoot once the parent settles.
 *
 * The parent's motion is measured in world space but has to be applied to a
 * local rotation, so each delta is conjugated into the parent's frame
 * (`P⁻¹ · Δ · P`) before use. Skipping that conjugation makes limbs drag along
 * the wrong axis — subtly wrong in a way that reads as "broken puppet".
 */
function dragRotation(
  local: Quat,
  parentLagged: Quat,
  parentNow: Quat,
  parentEarlier: Quat,
  drag: number,
  overshoot: number
): Quat {
  const intoLocal = (delta: Quat): Quat =>
    qMultiply(qInverse(parentNow), qMultiply(delta, parentNow));

  // What the parent did across the lag window, and what it did before that.
  const recent = intoLocal(qMultiply(parentNow, qInverse(parentLagged)));
  const previous = intoLocal(qMultiply(parentLagged, qInverse(parentEarlier)));

  const recentAngle = qAngle(Q_IDENTITY, recent);
  const previousAngle = qAngle(Q_IDENTITY, previous);

  // Trail behind the parent's current swing.
  const cancel = qSlerp(Q_IDENTITY, qInverse(recent), drag);
  let out = qMultiply(cancel, local);

  // The parent has slowed but was moving: release what was stored as a whip in
  // the direction it had been travelling.
  if (previousAngle > 1e-4 && recentAngle < previousAngle) {
    const decel = 1 - recentAngle / previousAngle;
    const whip = qSlerp(Q_IDENTITY, previous, overshoot * decel);
    out = qMultiply(whip, out);
  }
  return qNormalize(out);
}
