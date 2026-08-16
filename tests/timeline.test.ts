import { strict as assert } from "node:assert";
import { test } from "node:test";

import { Clip, appendKeyframe, createClip } from "../Assets/Scripts/Logic/Clip";
import { ReelTimeline } from "../Assets/Scripts/Logic/ReelTimeline";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { Q_IDENTITY, v3 } from "../Assets/Scripts/Logic/Vec";

function pose(x: number): PoseSample {
  return { torso: { p: v3(x, 0, 0), r: { ...Q_IDENTITY } } };
}

/** A clip of exactly `seconds` duration, with two keyframes. */
function clipOf(id: string, seconds: number): Clip {
  const clip = createClip(id, id, "stopmotion");
  appendKeyframe(clip, { t: 0, joints: pose(0) });
  appendKeyframe(clip, { t: seconds, joints: pose(10) });
  return clip;
}

test("segments lay clips end to end with no gaps", () => {
  const timeline = new ReelTimeline();
  timeline.add(clipOf("a", 1));
  timeline.add(clipOf("b", 2));
  timeline.add(clipOf("c", 0.5));

  const segments = timeline.segments();
  assert.deepEqual(
    segments.map((s) => [s.start, s.end]),
    [
      [0, 1],
      [1, 3],
      [3, 3.5],
    ]
  );
  assert.equal(timeline.totalDuration(), 3.5);
});

test("reordering changes playback order and nothing else", () => {
  const timeline = new ReelTimeline();
  timeline.add(clipOf("a", 1));
  timeline.add(clipOf("b", 2));
  timeline.add(clipOf("c", 3));

  assert.ok(timeline.move(2, 0));
  assert.deepEqual(timeline.clips.map((c) => c.id), ["c", "a", "b"]);
  assert.equal(timeline.totalDuration(), 6, "reorder must not change total length");

  assert.ok(timeline.moveClipId("c", 2));
  assert.deepEqual(timeline.clips.map((c) => c.id), ["a", "b", "c"]);
});

test("a no-op or out-of-range move is rejected without corrupting order", () => {
  const timeline = new ReelTimeline();
  timeline.add(clipOf("a", 1));
  timeline.add(clipOf("b", 1));

  assert.equal(timeline.move(0, 0), false);
  assert.equal(timeline.moveClipId("nope", 0), false);
  assert.ok(timeline.move(0, 99));
  assert.deepEqual(timeline.clips.map((c) => c.id), ["b", "a"]);
});

test("resolve maps global time onto the owning clip", () => {
  const timeline = new ReelTimeline();
  timeline.add(clipOf("a", 1));
  timeline.add(clipOf("b", 2));

  assert.equal(timeline.resolve(0)!.clip.id, "a");
  assert.equal(timeline.resolve(0.5)!.clip.id, "a");

  const inB = timeline.resolve(1.5)!;
  assert.equal(inB.clip.id, "b");
  assert.ok(Math.abs(inB.localT - 0.5) < 1e-9);
});

test("looping wraps time back to the start of the reel", () => {
  const timeline = new ReelTimeline();
  timeline.add(clipOf("a", 1));
  timeline.add(clipOf("b", 2));
  timeline.loop = true;

  const wrapped = timeline.resolve(3.25)!;
  assert.equal(wrapped.clip.id, "a");
  assert.ok(Math.abs(wrapped.localT - 0.25) < 1e-9);

  const negative = timeline.resolve(-0.5)!;
  assert.equal(negative.clip.id, "b", "negative time wraps to the tail");
});

test("without looping, time past the end holds the final pose", () => {
  const timeline = new ReelTimeline();
  timeline.add(clipOf("a", 1));
  timeline.add(clipOf("b", 2));
  timeline.loop = false;

  const past = timeline.resolve(99)!;
  assert.equal(past.clip.id, "b");
  assert.ok(Math.abs(past.localT - 2) < 1e-9);
});

test("an empty timeline resolves to null rather than throwing", () => {
  const timeline = new ReelTimeline();
  assert.equal(timeline.resolve(0), null);
  assert.equal(timeline.totalDuration(), 0);
  assert.ok(timeline.isEmpty());
});

test("playback speed scales wall-clock length only", () => {
  const timeline = new ReelTimeline();
  timeline.add(clipOf("a", 4));
  timeline.playbackSpeed = 2;

  assert.equal(timeline.totalDuration(), 4);
  assert.equal(timeline.playbackDuration(), 2);

  timeline.playbackSpeed = 0.5;
  assert.equal(timeline.playbackDuration(), 8);
});

test("captions are visible only during their own clip", () => {
  const timeline = new ReelTimeline();
  const a = clipOf("a", 1);
  a.caption = "Once upon a time";
  const b = clipOf("b", 2);
  timeline.add(a);
  timeline.add(b);

  assert.equal(timeline.captionAt(0.5), "Once upon a time");
  assert.equal(timeline.captionAt(2), null);
});

test("removing a clip closes the gap in the timeline", () => {
  const timeline = new ReelTimeline();
  timeline.add(clipOf("a", 1));
  timeline.add(clipOf("b", 2));
  timeline.add(clipOf("c", 3));

  assert.ok(timeline.remove("b"));
  assert.equal(timeline.remove("b"), false);
  assert.deepEqual(timeline.segments().map((s) => [s.start, s.end]), [
    [0, 1],
    [1, 4],
  ]);
});
