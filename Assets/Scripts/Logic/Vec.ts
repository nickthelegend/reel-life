/**
 * Plain-struct vector/quaternion math.
 *
 * The Logic layer deliberately does NOT use Lens Studio's `vec3`/`quat`, so that
 * every interpolation and timeline rule can be executed and unit-tested outside
 * the engine. Engine components convert at the boundary (see Core/Convert.ts).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function quat(x: number, y: number, z: number, w: number): Quat {
  return { x, y, z, w };
}

export const V3_ZERO: Vec3 = { x: 0, y: 0, z: 0 };
export const Q_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function v3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function v3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function v3Scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function v3Length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function v3Distance(a: Vec3, b: Vec3): number {
  return v3Length(v3Sub(a, b));
}

export function v3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function v3Equals(a: Vec3, b: Vec3, eps = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.z - b.z) <= eps
  );
}

export function qDot(a: Quat, b: Quat): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

export function qNormalize(a: Quat): Quat {
  const len = Math.sqrt(qDot(a, a));
  if (len === 0) {
    return { ...Q_IDENTITY };
  }
  return { x: a.x / len, y: a.y / len, z: a.z / len, w: a.w / len };
}

export function qNegate(a: Quat): Quat {
  return { x: -a.x, y: -a.y, z: -a.z, w: -a.w };
}

/**
 * Shortest-arc spherical interpolation. Falls back to normalized lerp when the
 * two rotations are nearly parallel, where slerp is numerically unstable.
 */
export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  let dot = qDot(a, b);
  let end = b;

  // A quaternion and its negation encode the same rotation; pick the one that
  // travels the short way round so limbs never spin 350 degrees to reach 10.
  if (dot < 0) {
    end = qNegate(b);
    dot = -dot;
  }

  if (dot > 0.9995) {
    return qNormalize({
      x: a.x + (end.x - a.x) * t,
      y: a.y + (end.y - a.y) * t,
      z: a.z + (end.z - a.z) * t,
      w: a.w + (end.w - a.w) * t,
    });
  }

  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;

  return qNormalize({
    x: a.x * wa + end.x * wb,
    y: a.y * wa + end.y * wb,
    z: a.z * wa + end.z * wb,
    w: a.w * wa + end.w * wb,
  });
}

/**
 * Hamilton product. `qMultiply(a, b)` is the rotation "apply b, then a" — the
 * standard convention, and the one the follow-through solver assumes.
 */
export function qMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Rotate a vector by a quaternion: v' = q · v · q⁻¹, expanded. */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  // t = 2 * (q.xyz × v);  v' = v + q.w * t + q.xyz × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);

  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export function qConjugate(a: Quat): Quat {
  return { x: -a.x, y: -a.y, z: -a.z, w: a.w };
}

/** Inverse of a rotation. Normalizes first, so drift cannot accumulate. */
export function qInverse(a: Quat): Quat {
  return qConjugate(qNormalize(a));
}

/** Angle between two rotations in radians, 0..PI. */
export function qAngle(a: Quat, b: Quat): number {
  const dot = Math.abs(qDot(qNormalize(a), qNormalize(b)));
  return 2 * Math.acos(Math.min(1, dot));
}

export function qFromAxisAngle(axis: Vec3, radians: number): Quat {
  const len = v3Length(axis);
  if (len === 0) {
    return { ...Q_IDENTITY };
  }
  const half = radians / 2;
  const s = Math.sin(half) / len;
  return {
    x: axis.x * s,
    y: axis.y * s,
    z: axis.z * s,
    w: Math.cos(half),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
