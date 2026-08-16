import { Clip, trimmedKeyframes } from "./Clip";
import { samplePose } from "./PoseInterpolator";
import { PoseSample } from "./PoseTypes";
import { RigPlan, jointsInBuildOrder } from "./RigPlan";
import {
  Q_IDENTITY,
  Quat,
  V3_ZERO,
  Vec3,
  qMultiply,
  qNormalize,
  qRotate,
  v3Add,
  v3Distance,
} from "./Vec";

/**
 * Forward kinematics, and the motion arcs it makes possible.
 *
 * A pose stores every joint in its parent's local space, which is what you need
 * to drive a rig but tells you nothing about where a hand actually is in the
 * room. Composing the chain gives world positions, and world positions give the
 * arc a joint traces through space.
 *
 * Arcs are the third pillar of animation craft, after onion skins and
 * follow-through: animators check that a hand travels a smooth curve rather
 * than a series of straight jabs. Drawing that curve in the air next to the
 * puppet is something only an AR tool can do — on a screen it's a projection,
 * here it's the actual path, at actual size, that you can walk around.
 */

export interface WorldTransform {
  p: Vec3;
  r: Quat;
}

export type WorldPose = Record<string, WorldTransform>;

/**
 * Resolve every joint to world space (relative to the character root).
 * Joints missing from the pose fall back to their rest offset, so a partial
 * pose still produces a complete skeleton.
 */
export function forwardKinematics(pose: PoseSample, plan: RigPlan): WorldPose {
  const world: WorldPose = {};

  // Parents must resolve before children, whatever order the plan stores them.
  for (const joint of jointsInBuildOrder(plan)) {
    const local = pose[joint.id];
    const localPosition = local ? local.p : joint.offset;
    const localRotation = local ? local.r : Q_IDENTITY;

    if (joint.parent === null) {
      world[joint.id] = { p: localPosition, r: qNormalize(localRotation) };
      continue;
    }

    const parent = world[joint.parent];
    if (!parent) {
      // Parent not resolved yet: the plan is out of order. Treat as a root
      // rather than silently placing the joint at the origin.
      world[joint.id] = { p: localPosition, r: qNormalize(localRotation) };
      continue;
    }

    world[joint.id] = {
      p: v3Add(parent.p, qRotate(parent.r, localPosition)),
      r: qNormalize(qMultiply(parent.r, localRotation)),
    };
  }
  return world;
}

export function worldPosition(
  pose: PoseSample,
  plan: RigPlan,
  jointId: string
): Vec3 {
  const world = forwardKinematics(pose, plan);
  return world[jointId] ? world[jointId].p : V3_ZERO;
}

export interface ArcOptions {
  /** Points sampled along the clip. More is smoother and costs more. */
  samples: number;
  /** Points closer together than this are dropped. */
  minSpacingCm: number;
}

export const DEFAULT_ARC_OPTIONS: ArcOptions = {
  samples: 48,
  minSpacingCm: 0.4,
};

/**
 * The path a joint traces through space over a take, ready to draw as a ribbon
 * or a line of dots beside the puppet.
 */
export function jointArc(
  clip: Clip,
  plan: RigPlan,
  jointId: string,
  options: ArcOptions = DEFAULT_ARC_OPTIONS
): Vec3[] {
  const frames = trimmedKeyframes(clip);
  if (frames.length < 2) {
    return [];
  }

  const duration = frames[frames.length - 1].t - frames[0].t;
  const samples = Math.max(2, Math.round(options.samples));
  const path: Vec3[] = [];

  for (let i = 0; i < samples; i++) {
    const pose = samplePose(clip, (i / (samples - 1)) * duration);
    if (!pose) {
      continue;
    }
    const world = forwardKinematics(pose, plan);
    const transform = world[jointId];
    if (!transform) {
      continue;
    }
    const previous = path[path.length - 1];
    if (previous && v3Distance(previous, transform.p) < options.minSpacingCm) {
      continue;
    }
    path.push(transform.p);
  }
  return path;
}

/** Total distance travelled along a path. */
export function pathLength(path: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += v3Distance(path[i - 1], path[i]);
  }
  return total;
}

/**
 * How curved a path is: 1 means a straight line, higher means it arcs.
 *
 * Animators want arcs, not straight lines — a value close to 1 on a limb is a
 * sign the motion will read as mechanical. This is what the "check arcs"
 * readout reports.
 */
export function arcRatio(path: Vec3[]): number {
  if (path.length < 2) {
    return 1;
  }
  const direct = v3Distance(path[0], path[path.length - 1]);
  if (direct < 1e-6) {
    // Returned to where it started: report the loop's extent instead.
    return pathLength(path) > 1e-6 ? Infinity : 1;
  }
  return pathLength(path) / direct;
}

/** Joints whose arcs are worth drawing: the ends of the limbs. */
export function extremityJoints(plan: RigPlan): string[] {
  const hasChildren: Record<string, boolean> = {};
  for (const joint of plan.joints) {
    if (joint.parent) {
      hasChildren[joint.parent] = true;
    }
  }
  return plan.joints
    .filter((joint) => joint.poseable && !hasChildren[joint.id])
    .map((joint) => joint.id);
}

/**
 * How far a joint drifts across a take, in world space.
 * Used to pick which arcs are worth showing — a joint that barely moves would
 * just be a smudge.
 */
export function worldTravel(
  clip: Clip,
  plan: RigPlan,
  jointId: string,
  options: ArcOptions = DEFAULT_ARC_OPTIONS
): number {
  return pathLength(jointArc(clip, plan, jointId, options));
}
