import { strict as assert } from "node:assert";
import { test } from "node:test";

import { appendKeyframe, createClip } from "../Assets/Scripts/Logic/Clip";
import { IdFactory, sessionSeedFromTime } from "../Assets/Scripts/Logic/Ids";
import { samplePose } from "../Assets/Scripts/Logic/PoseInterpolator";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import {
  FILM_FPS,
  createShootRate,
  describeShootRate,
  effectiveFps,
  holdSeconds,
  nextShootMode,
  steppedTime,
} from "../Assets/Scripts/Logic/Stepped";
import { Q_IDENTITY, v3 } from "../Assets/Scripts/Logic/Vec";

function pose(x: number): PoseSample {
  return { torso: { p: v3(x, 0, 0), r: { ...Q_IDENTITY } } };
}

test("shooting on twos updates twelve times a second at 24fps", () => {
  const rate = createShootRate("twos");
  assert.equal(effectiveFps(rate), 12);
  assert.ok(Math.abs(holdSeconds(rate) - 2 / 24) < 1e-12);
});

test("every shoot mode reports the rate it actually plays at", () => {
  assert.equal(effectiveFps(createShootRate("ones")), 24);
  assert.equal(effectiveFps(createShootRate("threes")), 8);
  assert.equal(effectiveFps(createShootRate("smooth")), FILM_FPS);
  assert.equal(holdSeconds(createShootRate("smooth")), 0);
});

test("stepped time floors onto the frame grid and never anticipates", () => {
  const rate = createShootRate("twos");
  const hold = holdSeconds(rate);

  assert.equal(steppedTime(0, rate), 0);
  assert.ok(Math.abs(steppedTime(hold * 0.99, rate) - 0) < 1e-9);
  assert.ok(Math.abs(steppedTime(hold, rate) - hold) < 1e-9);
  assert.ok(Math.abs(steppedTime(hold * 1.5, rate) - hold) < 1e-9);
  assert.ok(Math.abs(steppedTime(hold * 3, rate) - hold * 3) < 1e-9);
});

test("a time sitting exactly on a boundary lands on that boundary", () => {
  const rate = createShootRate("twos");
  const hold = holdSeconds(rate);
  for (let frame = 0; frame < 24; frame++) {
    const t = frame * hold;
    assert.ok(
      Math.abs(steppedTime(t, rate) - t) < 1e-9,
      `frame ${frame} at ${t} fell to the previous step`
    );
  }
});

test("smooth mode passes time through untouched", () => {
  const rate = createShootRate("smooth");
  assert.equal(steppedTime(0.1234, rate), 0.1234);
  assert.equal(steppedTime(9.9, rate), 9.9);
});

test("negative time clamps to the first exposure", () => {
  assert.equal(steppedTime(-1, createShootRate("twos")), 0);
});

test("stepped playback holds each pose for the full frame span", () => {
  const clip = createClip("c1", "Take 1", "stopmotion", "linear");
  appendKeyframe(clip, { t: 0, joints: pose(0) });
  appendKeyframe(clip, { t: 1, joints: pose(120) });

  const rate = createShootRate("twos");
  const hold = holdSeconds(rate);

  // Sample densely across one hold window: the pose must not change at all.
  const first = samplePose(clip, steppedTime(hold * 2 + 0.001, rate))!.torso.p.x;
  for (let i = 0; i < 20; i++) {
    const t = hold * 2 + (i / 20) * hold * 0.99;
    const x = samplePose(clip, steppedTime(t, rate))!.torso.p.x;
    assert.equal(x, first, `pose moved inside a held frame at t=${t}`);
  }

  // ...and must have moved by the next one.
  const next = samplePose(clip, steppedTime(hold * 3, rate))!.torso.p.x;
  assert.notEqual(next, first);
});

test("stepping produces exactly the expected number of distinct poses", () => {
  const clip = createClip("c1", "Take 1", "stopmotion", "linear");
  appendKeyframe(clip, { t: 0, joints: pose(0) });
  appendKeyframe(clip, { t: 1, joints: pose(240) });

  const rate = createShootRate("twos");
  const seen: Record<string, boolean> = {};
  for (let i = 0; i <= 480; i++) {
    const t = (i / 480) * 1;
    const x = samplePose(clip, steppedTime(t, rate))!.torso.p.x;
    seen[x.toFixed(6)] = true;
  }
  // One second on twos is 12 exposures, plus the final boundary at t=1.
  assert.equal(Object.keys(seen).length, 13);
});

test("shoot modes cycle in demo order, smooth last", () => {
  assert.equal(nextShootMode("twos"), "threes");
  assert.equal(nextShootMode("threes"), "ones");
  assert.equal(nextShootMode("ones"), "smooth");
  assert.equal(nextShootMode("smooth"), "twos");
});

test("shoot rate labels read as film terms", () => {
  assert.equal(describeShootRate(createShootRate("twos")), "On twos · 12fps");
  assert.equal(describeShootRate(createShootRate("smooth")), "Smooth");
});

test("ids are unique, ordered and reproducible", () => {
  const factory = new IdFactory(sessionSeedFromTime(1755300000000));
  const a = factory.next("clip");
  const b = factory.next("clip");
  const c = factory.next("reel");

  assert.notEqual(a, b);
  assert.ok(a.indexOf("clip-") === 0);
  assert.ok(c.indexOf("reel-") === 0);
  assert.equal(factory.count("clip"), 2);

  const replay = new IdFactory(sessionSeedFromTime(1755300000000));
  assert.equal(replay.next("clip"), a);
  assert.equal(replay.next("clip"), b);
});

test("loading a reel advances the counter so ids cannot collide", () => {
  const factory = new IdFactory("seed");
  factory.observe("clip-oldsession-7");
  assert.equal(factory.next("clip"), "clip-seed-8");
});

test("observing a malformed id is ignored rather than corrupting the counter", () => {
  const factory = new IdFactory("seed");
  factory.observe("garbage");
  factory.observe("clip-x-notanumber");
  assert.equal(factory.next("clip"), "clip-seed-1");
});
