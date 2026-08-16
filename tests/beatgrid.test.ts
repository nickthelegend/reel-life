import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  DEFAULT_BPM,
  MAX_BPM,
  MIN_BPM,
  barAlignedDuration,
  beatSeconds,
  beatTimes,
  createBeatGrid,
  foldTempo,
  quantizeClip,
  quantizeTime,
  stepSeconds,
  suggestBpm,
} from "../Assets/Scripts/Logic/BeatGrid";
import { appendKeyframe, createClip } from "../Assets/Scripts/Logic/Clip";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { Q_IDENTITY, v3 } from "../Assets/Scripts/Logic/Vec";

function pose(x: number): PoseSample {
  return { torso: { p: v3(x, 0, 0), r: { ...Q_IDENTITY } } };
}

function clipAt(id: string, times: number[], source: "stopmotion" | "performance" = "stopmotion") {
  const clip = createClip(id, id, source);
  times.forEach((t, i) => appendKeyframe(clip, { t, joints: pose(i) }));
  return clip;
}

test("grid maths", () => {
  const grid = createBeatGrid(120, 2);
  assert.equal(beatSeconds(grid), 0.5);
  assert.equal(stepSeconds(grid), 0.25);
});

test("bpm is clamped into the musical range on construction", () => {
  assert.equal(createBeatGrid(10).bpm, MIN_BPM);
  assert.equal(createBeatGrid(9000).bpm, MAX_BPM);
});

test("quantizeTime snaps to the nearest subdivision", () => {
  const grid = createBeatGrid(120, 2);
  assert.equal(quantizeTime(grid, 0.4), 0.5);
  assert.equal(quantizeTime(grid, 0.1), 0);
  assert.equal(quantizeTime(grid, 0.6), 0.5);
  assert.equal(quantizeTime(grid, 0.63), 0.75);
});

test("foldTempo brings any tempo into the musical range", () => {
  assert.equal(foldTempo(30), 60);
  assert.equal(foldTempo(400), 100);
  assert.equal(foldTempo(120), 120);
});

test("tempo is inferred from the stop-motion cadence the user posed at", () => {
  // 0.4s between poses is 150 BPM.
  const clip = clipAt("a", [0, 0.4, 0.8, 1.2]);
  assert.equal(suggestBpm([clip]), 150);
});

test("a live performance sample rate is not mistaken for a tempo", () => {
  // 12 samples/second would naively read as 720 BPM.
  const times: number[] = [];
  for (let i = 0; i < 36; i++) {
    times.push(i / 12);
  }
  const bpm = suggestBpm([clipAt("perf", times, "performance")]);
  assert.ok(bpm >= MIN_BPM && bpm <= MAX_BPM, `bpm out of range: ${bpm}`);
});

test("tempo falls back to the default with nothing to measure", () => {
  assert.equal(suggestBpm([]), DEFAULT_BPM);
  assert.equal(suggestBpm([clipAt("a", [0])]), DEFAULT_BPM);
});

test("quantized keyframes land on the grid and stay in order", () => {
  const grid = createBeatGrid(120, 2);
  const clip = clipAt("a", [0.1, 0.4, 0.8, 1.21]);
  quantizeClip(clip, grid);

  const step = stepSeconds(grid);
  for (let i = 0; i < clip.keyframes.length; i++) {
    const t = clip.keyframes[i].t;
    const offGrid = Math.abs(t / step - Math.round(t / step));
    assert.ok(offGrid < 1e-6, `frame ${i} at ${t} is off the grid`);
    if (i > 0) {
      assert.ok(t > clip.keyframes[i - 1].t, `frame ${i} does not advance`);
    }
  }
  assert.equal(clip.keyframes[0].t, 0, "quantized clip starts at zero");
});

test("poses too close together are spread across the grid, not collapsed", () => {
  const grid = createBeatGrid(120, 2);
  const clip = clipAt("a", [0, 0.02, 0.05]);
  quantizeClip(clip, grid);
  assert.deepEqual(clip.keyframes.map((k) => k.t), [0, 0.25, 0.5]);
});

test("quantizing an empty clip is a no-op", () => {
  const clip = createClip("a", "a", "stopmotion");
  quantizeClip(clip, createBeatGrid(120, 2));
  assert.equal(clip.keyframes.length, 0);
});

test("beatTimes covers the whole reel", () => {
  const grid = createBeatGrid(120, 2);
  assert.deepEqual(beatTimes(grid, 1.5), [0, 0.5, 1, 1.5]);
  assert.deepEqual(beatTimes(grid, 0), []);
});

test("reel length rounds up to a whole bar so music loops cleanly", () => {
  const grid = createBeatGrid(120, 2);
  assert.equal(barAlignedDuration(grid, 3.2), 4);
  assert.equal(barAlignedDuration(grid, 0.1), 2);
  assert.equal(barAlignedDuration(grid, 4), 4);
});
