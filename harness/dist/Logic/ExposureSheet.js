import { beatSeconds } from "./BeatGrid.js";
import { trimmedKeyframes } from "./Clip.js";
import { holdFrames, holdSeconds, steppedTime } from "./Stepped.js";
/** Which trimmed keyframe is showing at a clip-local time. */
export function keyframeAt(clip, localT) {
    const frames = trimmedKeyframes(clip);
    if (frames.length === 0) {
        return -1;
    }
    const absolute = frames[0].t + localT;
    let index = 0;
    for (let i = 0; i < frames.length; i++) {
        if (frames[i].t <= absolute + 1e-9) {
            index = i;
        }
    }
    return index;
}
export function frameCount(clip, fps) {
    const frames = trimmedKeyframes(clip);
    if (frames.length === 0 || fps <= 0) {
        return 0;
    }
    const duration = frames[frames.length - 1].t - frames[0].t;
    // Ceil, not round: a take ending at 0.8s is 19.2 frames at 24fps, and
    // rounding down would leave the final pose off the sheet entirely.
    return Math.max(1, Math.ceil(duration * fps - 1e-9) + 1);
}
/**
 * Build the sheet. `grid` is optional — pass it to mark the beats, which is
 * what makes the sheet useful for a reel that is locked to music.
 */
export function exposureSheet(clip, rate, grid) {
    const frames = trimmedKeyframes(clip);
    const fps = rate.fps;
    const hold = holdFrames(rate);
    if (frames.length === 0 || fps <= 0) {
        return { rows: [], fps, hold, totalFrames: 0, exposures: 0 };
    }
    const total = frameCount(clip, fps);
    const beat = grid ? beatSeconds(grid) : 0;
    const rows = [];
    let previousKeyframe = -1;
    let previousExposureTime = -1;
    for (let frame = 0; frame < total; frame++) {
        const seconds = frame / fps;
        // Stepping is what decides which pose is actually on screen.
        const exposureTime = steppedTime(seconds, rate);
        const keyframeIndex = keyframeAt(clip, exposureTime);
        const isNewExposure = hold === 0
            ? keyframeIndex !== previousKeyframe
            : exposureTime !== previousExposureTime;
        rows.push({
            frame: frame + 1,
            seconds: Number(seconds.toFixed(6)),
            keyframeIndex,
            isNewExposure,
            heldFrames: 0,
            onBeat: beat > 0 ? Math.abs(seconds / beat - Math.round(seconds / beat)) < 1e-6 : false,
        });
        previousKeyframe = keyframeIndex;
        previousExposureTime = exposureTime;
    }
    // Fill in how long each exposure lasts, counting forward to the next one.
    let exposures = 0;
    for (let i = 0; i < rows.length; i++) {
        if (!rows[i].isNewExposure) {
            continue;
        }
        exposures++;
        let held = 1;
        for (let j = i + 1; j < rows.length && !rows[j].isNewExposure; j++) {
            held++;
        }
        rows[i].heldFrames = held;
    }
    return { rows, fps, hold, totalFrames: total, exposures };
}
/** Render the sheet the way an X-sheet is actually laid out. */
export function formatXSheet(sheet, clipName) {
    const header = `${clipName} — ${sheet.fps}fps` +
        (sheet.hold > 0 ? ` on ${sheet.hold === 2 ? "twos" : sheet.hold === 3 ? "threes" : "ones"}` : " smooth") +
        `\n${sheet.totalFrames} frames · ${sheet.exposures} exposures\n` +
        "frame │ pose │ hold │ beat\n" +
        "──────┼──────┼──────┼─────";
    const lines = sheet.rows.map((row) => {
        const frame = String(row.frame).padStart(5);
        const pose = row.isNewExposure ? String(row.keyframeIndex).padStart(4) : "   ·";
        const held = row.isNewExposure ? String(row.heldFrames).padStart(4) : "    ";
        const beat = row.onBeat ? "  ●" : "   ";
        return `${frame} │${pose} │${held} │${beat}`;
    });
    return [header].concat(lines).join("\n");
}
// ---------------------------------------------------------------------------
// Frame-accurate navigation
// ---------------------------------------------------------------------------
export function frameToTime(frame, fps) {
    return fps <= 0 ? 0 : Math.max(0, frame - 1) / fps;
}
export function timeToFrame(seconds, fps) {
    return fps <= 0 ? 1 : Math.max(1, Math.round(seconds * fps) + 1);
}
/**
 * Time of the next pose change after `localT`, for stepping key-to-key.
 * Returns null at the end of the clip.
 */
export function nextExposureTime(clip, localT, rate) {
    const frames = trimmedKeyframes(clip);
    if (frames.length < 2) {
        return null;
    }
    const start = frames[0].t;
    const step = holdSeconds(rate);
    if (step > 0) {
        const next = steppedTime(localT, rate) + step;
        const duration = frames[frames.length - 1].t - start;
        return next <= duration + 1e-9 ? next : null;
    }
    for (const frame of frames) {
        const local = frame.t - start;
        if (local > localT + 1e-9) {
            return local;
        }
    }
    return null;
}
export function previousExposureTime(clip, localT, rate) {
    const frames = trimmedKeyframes(clip);
    if (frames.length < 2) {
        return null;
    }
    const start = frames[0].t;
    const step = holdSeconds(rate);
    if (step > 0) {
        const current = steppedTime(localT, rate);
        // Stepping back from mid-exposure lands on the start of this one.
        const target = Math.abs(current - localT) < 1e-9 ? current - step : current;
        return target >= -1e-9 ? Math.max(0, target) : null;
    }
    let best = null;
    for (const frame of frames) {
        const local = frame.t - start;
        if (local < localT - 1e-9) {
            best = local;
        }
    }
    return best;
}
