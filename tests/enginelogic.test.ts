import { strict as assert } from "node:assert";
import { test } from "node:test";

import { CaptionFade, easeOutBack } from "../Assets/Scripts/Logic/CaptionFade";
import {
  PanelMetrics,
  chipLabel,
  indexForX,
  keyframeIndexForX,
  playheadX,
  slotX,
  trackWidth,
  xForKeyframeIndex,
} from "../Assets/Scripts/Logic/PanelLayout";
import {
  PART_RETRY_LIMIT,
  overallProgress,
  progressForStage,
  scaleForPart,
  shouldRetry,
  summarizeGeneration,
} from "../Assets/Scripts/Logic/PartScaling";
import {
  PlacementStability,
  STABLE_HOLD_SECONDS,
  STABLE_RADIUS_CM,
  easeToward,
} from "../Assets/Scripts/Logic/PlacementStability";
import { v3 } from "../Assets/Scripts/Logic/Vec";

// ===========================================================================
// Placement stability
// ===========================================================================

test("holding still on a surface eventually confirms", () => {
  const p = new PlacementStability();
  assert.equal(p.offer(0, v3(0, 0, 0)).state, "settling");
  assert.equal(p.offer(0.2, v3(0, 0, 0)).state, "settling");
  assert.equal(p.offer(STABLE_HOLD_SECONDS + 0.01, v3(0, 0, 0)).state, "ready");
  assert.ok(p.isReady());
  assert.deepEqual(p.confirm(), v3(0, 0, 0));
});

test("moving further than the radius restarts the hold", () => {
  const p = new PlacementStability();
  p.offer(0, v3(0, 0, 0));
  p.offer(0.4, v3(0, 0, 0));
  // Jump away just before it would have confirmed.
  const jumped = p.offer(0.45, v3(STABLE_RADIUS_CM + 1, 0, 0));
  assert.equal(jumped.state, "settling");
  assert.equal(jumped.progress, 0);

  // The old elapsed time must not carry over.
  assert.equal(p.offer(0.6, v3(STABLE_RADIUS_CM + 1, 0, 0)).state, "settling");
  assert.equal(p.offer(0.96, v3(STABLE_RADIUS_CM + 1, 0, 0)).state, "ready");
});

test("small jitter inside the radius does not restart the hold", () => {
  const p = new PlacementStability();
  p.offer(0, v3(0, 0, 0));
  p.offer(0.2, v3(STABLE_RADIUS_CM - 1, 0, 0));
  p.offer(0.4, v3(0, 1, 0));
  assert.equal(p.offer(STABLE_HOLD_SECONDS + 0.01, v3(1, 0, 0)).state, "ready");
});

test("losing the surface resets everything and says so", () => {
  const p = new PlacementStability();
  p.offer(0, v3(0, 0, 0));
  const lost = p.offer(0.3, null);
  assert.equal(lost.state, "searching");
  assert.ok(lost.message.includes("No surface"));
  assert.equal(p.confirm(), null);

  // And the hold starts from scratch when it comes back.
  p.offer(0.4, v3(0, 0, 0));
  assert.equal(p.offer(0.6, v3(0, 0, 0)).state, "settling");
});

test("confirm refuses until the hold completes", () => {
  const p = new PlacementStability();
  p.offer(0, v3(0, 0, 0));
  assert.equal(p.confirm(), null, "confirming early must not place the character");
});

test("hold progress runs 0 to 1 for a progress ring", () => {
  const p = new PlacementStability();
  p.offer(0, v3(0, 0, 0));
  const half = p.offer(STABLE_HOLD_SECONDS / 2, v3(0, 0, 0));
  assert.ok(Math.abs(half.progress - 0.5) < 1e-9);
  assert.equal(p.offer(STABLE_HOLD_SECONDS, v3(0, 0, 0)).progress, 1);
});

test("ray-casts are throttled to the depth refresh rate", () => {
  assert.equal(PlacementStability.shouldCast(0.1, 0), false);
  assert.equal(PlacementStability.shouldCast(0.2, 0), true);
});

test("reset returns to searching", () => {
  const p = new PlacementStability();
  p.offer(0, v3(0, 0, 0));
  p.offer(1, v3(0, 0, 0));
  assert.ok(p.isReady());
  p.reset();
  assert.equal(p.currentState(), "searching");
  assert.equal(p.confirm(), null);
});

test("the reticle eases toward a reading instead of snapping", () => {
  const eased = easeToward(v3(0, 0, 0), v3(100, 0, 0), 0.25);
  assert.equal(eased.x, 25);
  // Repeated easing converges without overshooting.
  let cur = v3(0, 0, 0);
  for (let i = 0; i < 200; i++) cur = easeToward(cur, v3(10, 0, 0));
  assert.ok(Math.abs(cur.x - 10) < 1e-6);
});

// ===========================================================================
// Panel layout
// ===========================================================================

const M: PanelMetrics = { chipWidthCm: 8, chipHeightCm: 4.5, gapCm: 1 };

test("chips are centred on the panel origin", () => {
  assert.equal(slotX(M, 0, 1), 0);
  assert.equal(slotX(M, 0, 2), -4.5);
  assert.equal(slotX(M, 1, 2), 4.5);
  assert.equal(slotX(M, 1, 3), 0, "the middle of three sits at the origin");
});

test("dragging a chip to a slot's centre selects that slot", () => {
  for (let count = 1; count <= 6; count++) {
    for (let i = 0; i < count; i++) {
      assert.equal(indexForX(M, slotX(M, i, count), count), i, `count=${count} index=${i}`);
    }
  }
});

test("a drag between two slots rounds to the nearer one", () => {
  const a = slotX(M, 0, 3);
  const b = slotX(M, 1, 3);
  assert.equal(indexForX(M, a + (b - a) * 0.4, 3), 0);
  assert.equal(indexForX(M, a + (b - a) * 0.6, 3), 1);
});

test("dragging past either end clamps instead of losing the chip", () => {
  assert.equal(indexForX(M, -9999, 3), 0);
  assert.equal(indexForX(M, 9999, 3), 2);
});

test("the strip widens by one slot per chip", () => {
  assert.equal(trackWidth(M, 1), 9);
  assert.equal(trackWidth(M, 4), 36);
});

test("trim handle position and keyframe index are exact inverses", () => {
  for (const count of [2, 4, 5, 9]) {
    for (let i = 0; i < count; i++) {
      assert.equal(
        keyframeIndexForX(M, xForKeyframeIndex(M, i, count), count),
        i,
        `count=${count} index=${i}`
      );
    }
  }
});

test("trim handles map the chip's full width across the keyframes", () => {
  assert.equal(keyframeIndexForX(M, -M.chipWidthCm / 2, 5), 0);
  assert.equal(keyframeIndexForX(M, M.chipWidthCm / 2, 5), 4);
  assert.equal(keyframeIndexForX(M, 0, 5), 2);
});

test("a handle dragged off the chip clamps to a real keyframe", () => {
  assert.equal(keyframeIndexForX(M, -500, 5), 0);
  assert.equal(keyframeIndexForX(M, 500, 5), 4);
});

test("a single-keyframe clip has no trim range to divide by", () => {
  assert.equal(keyframeIndexForX(M, 0, 1), 0);
  assert.equal(keyframeIndexForX(M, 99, 1), 0);
  assert.ok(isFinite(xForKeyframeIndex(M, 0, 1)));
});

test("the playhead sweeps the strip from left edge to right", () => {
  const span = trackWidth(M, 3);
  assert.equal(playheadX(M, 0, 10, 3), -span / 2);
  assert.equal(playheadX(M, 10, 10, 3), span / 2);
  assert.equal(playheadX(M, 5, 10, 3), 0);
});

test("the playhead does not divide by zero on an empty reel", () => {
  assert.equal(playheadX(M, 0, 0, 0), 0);
});

test("chip labels show trim state and caption", () => {
  assert.equal(chipLabel("Take 2", 1.6, 5, 5, null), "Take 2 · 1.60s · 5/5 poses");
  assert.ok(chipLabel("Take 2", 1.6, 3, 5, null).includes("✂"));
  assert.ok(chipLabel("Take 2", 1.6, 5, 5, "he bows").includes('"he bows"'));
});

// ===========================================================================
// Caption fade
// ===========================================================================

test("a caption fades in and settles", () => {
  const f = new CaptionFade(0.2);
  f.show("hello", 0);
  assert.equal(f.update(0).phase, "in");
  assert.equal(f.update(0.1).visible, true);
  const settled = f.update(0.25);
  assert.equal(settled.phase, "shown");
  assert.equal(settled.text, "hello");
  assert.equal(settled.scale, 1);
});

test("setting the same caption again does not restart the animation", () => {
  const f = new CaptionFade(0.2);
  f.show("hello", 0);
  f.update(0.25);
  f.show("hello", 0.3);
  assert.equal(f.update(0.3).phase, "shown", "an identical caption must not re-fade");
});

test("a new caption queues behind the fade out, then plays", () => {
  const f = new CaptionFade(0.2);
  f.show("first", 0);
  f.update(0.25);

  f.show("second", 0.3);
  assert.equal(f.currentPhase(), "out");
  assert.equal(f.pendingText(), "second");
  assert.equal(f.update(0.4).text, "first", "the old caption is still fading");

  const swapped = f.update(0.55);
  assert.equal(swapped.phase, "in");
  assert.equal(f.currentText(), "second");
  assert.equal(f.pendingText(), null);
});

test("clearing while a caption is queued drops the queue", () => {
  const f = new CaptionFade(0.2);
  f.show("first", 0);
  f.update(0.25);
  f.show("second", 0.3);
  f.show(null, 0.35);
  assert.equal(f.pendingText(), null, "the queued caption must not appear after clearing");

  f.update(0.6);
  assert.equal(f.currentPhase(), "hidden");
  assert.equal(f.update(0.7).visible, false);
});

test("blank and whitespace captions count as no caption", () => {
  const f = new CaptionFade(0.2);
  f.show("   ", 0);
  assert.equal(f.update(0).visible, false);
  f.show("", 0);
  assert.equal(f.update(0).visible, false);
});

test("captions are trimmed before display", () => {
  const f = new CaptionFade(0.2);
  f.show("  he bows  ", 0);
  assert.equal(f.update(0.25).text, "he bows");
});

test("clearing an already-hidden caption is a no-op", () => {
  const f = new CaptionFade(0.2);
  f.show(null, 0);
  assert.equal(f.currentPhase(), "hidden");
  assert.equal(f.update(1).visible, false);
});

test("nothing is ever shown while hidden", () => {
  const f = new CaptionFade(0.2);
  const frame = f.update(0);
  assert.equal(frame.text, null);
  assert.equal(frame.visible, false);
  assert.equal(frame.scale, 0);
});

test("the pop overshoots then settles at exactly 1", () => {
  // 1 - c3 + c1 is algebraically 0 but lands a float epsilon away; that is
  // harmless for a scale multiplier, which CaptionFade floors anyway.
  assert.ok(Math.abs(easeOutBack(0)) < 1e-12, `start ${easeOutBack(0)}`);
  assert.equal(easeOutBack(1), 1);
  let peak = 0;
  for (let i = 0; i <= 100; i++) peak = Math.max(peak, easeOutBack(i / 100));
  assert.ok(peak > 1, "an overshoot is what gives the caption its pop");
  assert.ok(peak < 1.2, "but not so much that it looks broken");
});

// ===========================================================================
// Part scaling and generation progress
// ===========================================================================

test("a part is scaled to its share of the character's height", () => {
  // A 4-unit-tall mesh that should occupy 30% of a 20cm character -> 6cm.
  const r = scaleForPart(4, 0.3, 20);
  assert.ok(r.measured);
  assert.ok(Math.abs(r.scale - 1.5) < 1e-9);
  assert.ok(Math.abs(4 * r.scale - 6) < 1e-9);
});

test("an unmeasurable mesh is left alone rather than guessed at", () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    const r = scaleForPart(bad, 0.3, 20);
    assert.equal(r.measured, false);
    assert.equal(r.scale, 1, "an unmeasurable part must not be resized");
  }
});

test("a malformed rig cannot produce a zero or infinite scale", () => {
  assert.equal(scaleForPart(4, 0, 20).measured, false);
  assert.equal(scaleForPart(4, 0.3, 0).measured, false);
  assert.equal(scaleForPart(4, NaN, 20).measured, false);
});

test("generation progress advances through the stages", () => {
  assert.ok(progressForStage("queued") < progressForStage("preview"));
  assert.ok(progressForStage("preview") < progressForStage("base_mesh"));
  assert.ok(progressForStage("base_mesh") < progressForStage("done"));
  assert.equal(progressForStage("done"), 1);
  assert.equal(progressForStage("failed"), 0);
});

test("overall progress averages the parts", () => {
  assert.equal(overallProgress(["done", "done"]), 1);
  assert.equal(overallProgress([]), 0);
  assert.ok(overallProgress(["done", "queued"]) < 1);
});

test("generation is settled only once every part has landed or failed", () => {
  assert.equal(summarizeGeneration(["done", "done", "queued"]).settled, false);
  const s = summarizeGeneration(["done", "done", "failed"]);
  assert.equal(s.settled, true);
  assert.equal(s.done, 2);
  assert.equal(s.failed, 1);
  assert.equal(s.total, 3);
  assert.equal(summarizeGeneration([]).settled, false);
});

test("a part gets exactly one retry before the generation fails", () => {
  assert.equal(shouldRetry(0), true);
  assert.equal(shouldRetry(PART_RETRY_LIMIT), false);
  assert.equal(shouldRetry(5), false);
});
