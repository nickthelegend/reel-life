import { trimmedKeyframes } from "./Clip.js";
import { clamp } from "./Vec.js";
export const MIN_BPM = 60;
export const MAX_BPM = 180;
export const DEFAULT_BPM = 110;
export function createBeatGrid(bpm = DEFAULT_BPM, subdivision = 2, offset = 0) {
    return {
        bpm: clamp(bpm, MIN_BPM, MAX_BPM),
        subdivision: Math.max(1, Math.round(subdivision)),
        offset,
    };
}
export function beatSeconds(grid) {
    return 60 / grid.bpm;
}
export function stepSeconds(grid) {
    return beatSeconds(grid) / grid.subdivision;
}
export function quantizeTime(grid, t) {
    const step = stepSeconds(grid);
    return grid.offset + Math.round((t - grid.offset) / step) * step;
}
/** Fold any tempo into the musical range by halving or doubling. */
export function foldTempo(bpm) {
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
function medianInterval(frames) {
    const gaps = [];
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
export function suggestBpm(clips) {
    const intervals = [];
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
export function quantizeClip(clip, grid) {
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
export function beatTimes(grid, duration) {
    const out = [];
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
export function barAlignedDuration(grid, duration, beatsPerBar = 4) {
    const bar = beatSeconds(grid) * beatsPerBar;
    if (bar <= 0) {
        return duration;
    }
    return Math.max(bar, Math.ceil(duration / bar) * bar);
}
