import { Quat, Vec3 } from "./Vec";

/** One joint's transform, in its parent joint's local space. */
export interface JointPose {
  p: Vec3;
  r: Quat;
}

/**
 * A full-body snapshot. `t` is seconds from the start of the clip that owns it.
 * `joints` is keyed by JointSpec.id, so a keyframe is portable across any rig
 * that shares joint names (which is what makes clip reuse across characters
 * possible).
 */
export interface PoseKeyframe {
  t: number;
  joints: Record<string, JointPose>;
}

export type PoseSample = Record<string, JointPose>;

export function clonePose(pose: PoseSample): PoseSample {
  const out: PoseSample = {};
  for (const id in pose) {
    const jp = pose[id];
    out[id] = {
      p: { x: jp.p.x, y: jp.p.y, z: jp.p.z },
      r: { x: jp.r.x, y: jp.r.y, z: jp.r.z, w: jp.r.w },
    };
  }
  return out;
}

export function cloneKeyframe(kf: PoseKeyframe): PoseKeyframe {
  return { t: kf.t, joints: clonePose(kf.joints) };
}
