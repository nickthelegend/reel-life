import { JointPose } from "../Logic/PoseTypes";
import { Quat, Vec3 } from "../Logic/Vec";

/**
 * The only place engine types meet Logic types.
 *
 * Note the argument order: Lens Studio's quat constructor is (w, x, y, z) while
 * the serialized form is {x, y, z, w}. Getting this backwards produces poses
 * that look almost right and drift under interpolation, so it is converted in
 * exactly one place.
 */

export function toEngineVec(v: Vec3): vec3 {
  return new vec3(v.x, v.y, v.z);
}

export function fromEngineVec(v: vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function toEngineQuat(q: Quat): quat {
  return new quat(q.w, q.x, q.y, q.z);
}

export function fromEngineQuat(q: quat): Quat {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** Snapshot a joint's local transform into a serializable pose. */
export function readJointPose(transform: Transform): JointPose {
  return {
    p: fromEngineVec(transform.getLocalPosition()),
    r: fromEngineQuat(transform.getLocalRotation()),
  };
}

/** Drive a joint's local transform from a pose. */
export function applyJointPose(transform: Transform, pose: JointPose): void {
  transform.setLocalPosition(toEngineVec(pose.p));
  transform.setLocalRotation(toEngineQuat(pose.r));
}
