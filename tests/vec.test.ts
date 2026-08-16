import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  Q_IDENTITY,
  qAngle,
  qDot,
  qFromAxisAngle,
  qNormalize,
  qSlerp,
  v3,
  v3Distance,
  v3Lerp,
  clamp,
} from "../Assets/Scripts/Logic/Vec";

test("v3Lerp hits both endpoints and the midpoint", () => {
  const a = v3(0, 0, 0);
  const b = v3(10, -4, 2);
  assert.deepEqual(v3Lerp(a, b, 0), a);
  assert.deepEqual(v3Lerp(a, b, 1), b);
  assert.deepEqual(v3Lerp(a, b, 0.5), v3(5, -2, 1));
});

test("v3Distance is euclidean", () => {
  assert.equal(v3Distance(v3(0, 0, 0), v3(3, 4, 0)), 5);
});

test("qSlerp returns unit quaternions across the whole range", () => {
  const a = qFromAxisAngle(v3(0, 1, 0), 0.2);
  const b = qFromAxisAngle(v3(1, 0, 0), 2.4);
  for (let i = 0; i <= 10; i++) {
    const q = qSlerp(a, b, i / 10);
    const length = Math.sqrt(qDot(q, q));
    assert.ok(Math.abs(length - 1) < 1e-9, `t=${i / 10} length=${length}`);
  }
});

test("qSlerp endpoints match the inputs", () => {
  const a = qFromAxisAngle(v3(0, 1, 0), 0.5);
  const b = qFromAxisAngle(v3(0, 1, 0), 1.5);
  const start = qSlerp(a, b, 0);
  const end = qSlerp(a, b, 1);
  assert.ok(qAngle(start, a) < 1e-6);
  assert.ok(qAngle(end, b) < 1e-6);
});

test("qSlerp takes the short way around", () => {
  const a = qFromAxisAngle(v3(0, 1, 0), 0.1);
  // Same rotation as a small positive angle, but expressed with a negated
  // quaternion. Naive lerp would swing nearly all the way round.
  const bRaw = qFromAxisAngle(v3(0, 1, 0), 0.3);
  const b = { x: -bRaw.x, y: -bRaw.y, z: -bRaw.z, w: -bRaw.w };
  const mid = qSlerp(a, b, 0.5);
  const expected = qFromAxisAngle(v3(0, 1, 0), 0.2);
  assert.ok(qAngle(mid, expected) < 1e-6, "slerp should travel 0.1 -> 0.3, not the long arc");
});

test("qSlerp is stable for nearly identical rotations", () => {
  const a = qFromAxisAngle(v3(0, 1, 0), 1.0);
  const b = qFromAxisAngle(v3(0, 1, 0), 1.0 + 1e-9);
  const mid = qSlerp(a, b, 0.5);
  assert.ok(isFinite(mid.x) && isFinite(mid.w), "must not divide by zero");
  assert.ok(qAngle(mid, a) < 1e-6);
});

test("qNormalize of a zero quaternion falls back to identity", () => {
  assert.deepEqual(qNormalize({ x: 0, y: 0, z: 0, w: 0 }), Q_IDENTITY);
});

test("clamp bounds both ends", () => {
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
  assert.equal(clamp(5, 0, 10), 5);
});
