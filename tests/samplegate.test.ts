import { strict as assert } from "node:assert";
import { test } from "node:test";

import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import {
  MAX_SAMPLE_GAP_SECONDS,
  PERFORMANCE_SAMPLE_HZ,
  SampleGate,
} from "../Assets/Scripts/Logic/SampleGate";
import { qFromAxisAngle, v3 } from "../Assets/Scripts/Logic/Vec";

function pose(x: number, angle = 0): PoseSample {
  return { head: { p: v3(x, 0, 0), r: qFromAxisAngle(v3(0, 1, 0), angle) } };
}

test("a moving take samples at ~12Hz off a 120fps clock, never faster", () => {
  const gate = new SampleGate();
  gate.start(0);

  const stamps: number[] = [];
  for (let frame = 0; frame <= 120; frame++) {
    const now = frame / 120;
    if (gate.offer(now, pose(frame)).record) {
      stamps.push(now);
    }
  }

  // The invariant that actually matters: the gate never records faster than
  // its interval. Exact counts drift because a 120Hz clock cannot land
  // precisely on a 12Hz boundary.
  const interval = new SampleGate().intervalSeconds();
  for (let i = 1; i < stamps.length; i++) {
    assert.ok(
      stamps[i] - stamps[i - 1] >= interval - 1e-9,
      `samples ${i - 1}->${i} were ${(stamps[i] - stamps[i - 1]).toFixed(4)}s apart, faster than 12Hz`
    );
  }
  assert.ok(stamps.length >= 12 && stamps.length <= 13, `got ${stamps.length} samples in 1s`);
  assert.equal(stamps[0], 0, "the opening pose is always recorded");
});

test("an irregular, slow host clock still produces correctly stamped samples", () => {
  // A stuttering clock: 40ms, 300ms, 90ms… The gate is time-based, so every
  // tick past the interval records, and timestamps stay true to wall time.
  const gate = new SampleGate();
  gate.start(10);

  const ticks = [10, 10.04, 10.34, 10.43, 10.5, 11.9, 11.95];
  const stamps: number[] = [];
  const reasons: string[] = [];
  ticks.forEach((now, i) => {
    const decision = gate.offer(now, pose(i * 5));
    reasons.push(decision.reason);
    if (decision.record) {
      stamps.push(Number(decision.elapsed.toFixed(3)));
    }
  });

  // 10.5 is only 0.07s after 10.43 — inside the 1/12s interval, so it is
  // correctly refused even though the clock ticked.
  assert.deepEqual(stamps, [0, 0.34, 0.43, 1.9]);
  assert.deepEqual(reasons, [
    "recorded", "too-soon", "recorded", "recorded", "too-soon", "recorded", "too-soon",
  ]);
  for (let i = 1; i < stamps.length; i++) {
    assert.ok(stamps[i] > stamps[i - 1], "timestamps must strictly increase");
  }
});

test("samples closer together than the interval are refused", () => {
  const gate = new SampleGate();
  gate.start(0);

  assert.equal(gate.offer(0, pose(0)).record, true);
  const tooSoon = gate.offer(0.01, pose(50));
  assert.equal(tooSoon.record, false);
  assert.equal(tooSoon.reason, "too-soon");
});

test("a pose that has not moved is dropped rather than duplicated", () => {
  const gate = new SampleGate();
  gate.start(0);
  gate.offer(0, pose(0));

  const still = gate.offer(0.5, pose(0));
  assert.equal(still.record, false);
  assert.equal(still.reason, "unchanged");
});

test("a held pose is still recorded once the max gap elapses", () => {
  const gate = new SampleGate();
  gate.start(0);
  gate.offer(0, pose(0));

  assert.equal(gate.offer(0.9, pose(0)).record, false);
  const forced = gate.offer(MAX_SAMPLE_GAP_SECONDS + 0.01, pose(0));
  assert.equal(forced.record, true, "a long hold must not leave an interpolation gap");
});

test("a tiny movement below the epsilon counts as still", () => {
  const gate = new SampleGate();
  gate.start(0);
  gate.offer(0, pose(0));
  assert.equal(gate.offer(0.5, pose(0.1)).record, false, "0.1cm is tremor, not motion");
  assert.equal(gate.offer(0.5, pose(5)).record, true, "5cm is real motion");
});

test("rotation alone counts as movement", () => {
  const gate = new SampleGate();
  gate.start(0);
  gate.offer(0, pose(0, 0));
  assert.equal(gate.offer(0.5, pose(0, 0.5)).record, true);
});

test("elapsed is measured from the start of the take, not the epoch", () => {
  const gate = new SampleGate();
  gate.start(1000);
  assert.equal(gate.offer(1000.5, pose(9)).elapsed, 0.5);
});

test("restarting resets the gate completely", () => {
  const gate = new SampleGate();
  gate.start(0);
  gate.offer(0, pose(0));

  gate.start(100);
  const first = gate.offer(100, pose(0));
  assert.equal(first.record, true, "a fresh take always records its opening pose");
  assert.equal(first.elapsed, 0);
});

test("the default rate is the documented 12Hz", () => {
  assert.equal(PERFORMANCE_SAMPLE_HZ, 12);
  assert.ok(Math.abs(new SampleGate().intervalSeconds() - 1 / 12) < 1e-12);
});

test("an invalid rate falls back to the default rather than dividing by zero", () => {
  assert.ok(Math.abs(new SampleGate(0).intervalSeconds() - 1 / 12) < 1e-12);
  assert.ok(Math.abs(new SampleGate(-5).intervalSeconds() - 1 / 12) < 1e-12);
});
