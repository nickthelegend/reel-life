import { Clip, trimmedKeyframes } from "./Clip";
import { PoseKeyframe } from "./PoseTypes";
import { clamp } from "./Vec";

/**
 * Tempo grid shared by the puppeteering and the score.
 *
 * The point: the tempo is derived from how the user actually puppeteered, then
 * handed to the music generator AND used to snap keyframes. So the score is
 * written to the performance instead of the performance being fought into a
 * stock loop, and every pose change lands on a beat.
 */
export interface BeatGrid {
  bpm: number;
  /** Snap resolution per beat: 1 = beat, 2 = eighths, 4 = sixteenths. */
  subdivision: number;
  /** Grid phase offset in seconds. */
  offset: number;
}

export const MIN_BPM = 60;
export const MAX_BPM = 180;
export const DEFAULT_BPM = 110;

export function createBeatGrid(
  bpm: number = DEFAULT_BPM,
  subdivision = 2,
  offset = 0
): BeatGrid {
  return {
    bpm: clamp(bpm, MIN_BPM, MAX_BPM),
    subdivision: Math.max(1, Math.round(subdivision)),
    offset,
  };
}

export function beatSeconds(grid: BeatGrid): number {
  return 60 / grid.bpm;
}

export function stepSeconds(grid: BeatGrid): number {
  return beatSeconds(grid) / grid.subdivision;
}

export function quantizeTime(grid: BeatGrid, t: number): number {
  const step = stepSeconds(grid);
  return grid.offset + Math.round((t - grid.offset) / step) * step;
}

/** Fold any tempo into the musical range by halving or doubling. */
export function foldTempo(bpm: number): number {
  let value = bpm;
  let guard = 0;
  while (value < MIN_BPM && guard < 8) {
    value *= 2;
    guard++;
  }
  while (value > MAX_BPM && guard < 16) {
    value /= 2;
    guard++;
  }
  return clamp(value, MIN_BPM, MAX_BPM);
}

function medianInterval(frames: PoseKeyframe[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i].t - frames[i - 1].t;
    if (gap > 0) {
      gaps.push(gap);
    }
  }
  if (gaps.length === 0) {
    return 0;
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/**
 * Infer a tempo from the rhythm the user posed at.
 *
 * Stop-motion captures land roughly one per pose; a 0.4s cadence reads as 150
 * BPM. Live performance samples come in far too fast to be beats, so those are
 * folded up into the musical range instead of taken literally.
 */
export function suggestBpm(clips: Clip[]): number {
  const intervals: number[] = [];
  for (const clip of clips) {
    const frames = trimmedKeyframes(clip);
    if (frames.length < 2) {
      continue;
    }
    if (clip.source === "performance") {
      // Sample interval is a recording rate, not a beat. Use the clip's own
      // length so the music matches the take rather than the sampler.
      const span = frames[frames.length - 1].t - frames[0].t;
      intervals.push(span / Math.max(1, Math.round(span * 2)));
      continue;
    }
    const median = medianInterval(frames);
    if (median > 0) {
      intervals.push(median);
    }
  }

  if (intervals.length === 0) {
    return DEFAULT_BPM;
  }
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  if (median <= 0) {
    return DEFAULT_BPM;
  }
  return Math.round(foldTempo(60 / median));
}

/**
 * Snap every keyframe onto the grid, keeping strictly increasing times and at
 * least one grid step between poses so nothing collapses into a single frame.
 */
export function quantizeClip(clip: Clip, grid: BeatGrid): Clip {
  if (clip.keyframes.length === 0) {
    return clip;
  }
  const step = stepSeconds(grid);
  const base = quantizeTime(grid, clip.keyframes[0].t);
  let previous = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < clip.keyframes.length; i++) {
    let t = quantizeTime(grid, clip.keyframes[i].t) - base;
    if (t <= previous) {
      t = previous + step;
    }
    clip.keyframes[i].t = Number(t.toFixed(6));
    previous = clip.keyframes[i].t;
  }
  return clip;
}

/** Beat times within a duration, for the timeline's tick marks. */
export function beatTimes(grid: BeatGrid, duration: number): number[] {
  const out: number[] = [];
  const beat = beatSeconds(grid);
  if (beat <= 0 || duration <= 0) {
    return out;
  }
  for (let t = grid.offset; t <= duration + 1e-6; t += beat) {
    if (t >= 0) {
      out.push(Number(t.toFixed(6)));
    }
  }
  return out;
}

/** Round a reel length up to a whole bar, so a music loop closes cleanly. */
export function barAlignedDuration(
  grid: BeatGrid,
  duration: number,
  beatsPerBar = 4
): number {
  const bar = beatSeconds(grid) * beatsPerBar;
  if (bar <= 0) {
    return duration;
  }
  return Math.max(bar, Math.ceil(duration / bar) * bar);
}
