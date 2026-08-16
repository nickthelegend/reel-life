import { cloneKeyframe } from "./PoseTypes.js";
import { clamp, qAngle, v3Distance } from "./Vec.js";
/** A clip with a single keyframe still needs to occupy time on the timeline. */
export const MIN_CLIP_DURATION = 0.4;
/** Stop-motion cadence: the gap inserted between consecutive captured poses. */
export const STOPMOTION_STEP = 0.4;
export function createClip(id, name, source, ease = "smooth") {
    return {
        id,
        name,
        source,
        keyframes: [],
        trimIn: 0,
        trimOut: 0,
        caption: null,
        ease,
    };
}
/**
 * Append a keyframe, keeping timestamps strictly increasing.
 *
 * If the trim-out handle was sitting at the end of the clip it follows the new
 * keyframe, so recording never silently lands outside the trimmed range.
 */
export function appendKeyframe(clip, keyframe) {
    const last = clip.keyframes[clip.keyframes.length - 1];
    const wasAtEnd = clip.keyframes.length === 0 || clip.trimOut === clip.keyframes.length - 1;
    let t = keyframe.t;
    if (last && t <= last.t) {
        t = last.t + 0.001;
    }
    clip.keyframes.push({ t, joints: keyframe.joints });
    if (wasAtEnd) {
        clip.trimOut = clip.keyframes.length - 1;
    }
    clip.trimIn = clamp(clip.trimIn, 0, clip.trimOut);
    return clip;
}
/** Append a pose using the stop-motion cadence rather than a wall-clock time. */
export function captureStopMotionPose(clip, pose) {
    const last = clip.keyframes[clip.keyframes.length - 1];
    const t = last ? last.t + STOPMOTION_STEP : 0;
    return appendKeyframe(clip, { t, joints: pose });
}
export function keyframeCount(clip) {
    return clip.keyframes.length;
}
export function trimmedKeyframes(clip) {
    if (clip.keyframes.length === 0) {
        return [];
    }
    const lo = clamp(clip.trimIn, 0, clip.keyframes.length - 1);
    const hi = clamp(clip.trimOut, lo, clip.keyframes.length - 1);
    return clip.keyframes.slice(lo, hi + 1);
}
/** Duration of the trimmed range, never below MIN_CLIP_DURATION. */
export function clipDuration(clip) {
    const frames = trimmedKeyframes(clip);
    if (frames.length < 2) {
        return MIN_CLIP_DURATION;
    }
    const span = frames[frames.length - 1].t - frames[0].t;
    return Math.max(span, MIN_CLIP_DURATION);
}
export function setTrimIn(clip, index) {
    if (clip.keyframes.length === 0) {
        return clip;
    }
    clip.trimIn = clamp(Math.round(index), 0, clip.trimOut);
    return clip;
}
export function setTrimOut(clip, index) {
    if (clip.keyframes.length === 0) {
        return clip;
    }
    clip.trimOut = clamp(Math.round(index), clip.trimIn, clip.keyframes.length - 1);
    return clip;
}
export function resetTrim(clip) {
    clip.trimIn = 0;
    clip.trimOut = Math.max(0, clip.keyframes.length - 1);
    return clip;
}
export function cloneClip(clip, newId) {
    return {
        id: newId,
        name: clip.name,
        source: clip.source,
        keyframes: clip.keyframes.map(cloneKeyframe),
        trimIn: clip.trimIn,
        trimOut: clip.trimOut,
        caption: clip.caption,
        ease: clip.ease,
    };
}
/** How far the puppet travelled between two poses. Drives SFX and onion skin. */
export function poseDelta(a, b) {
    let maxPosition = 0;
    let maxAngle = 0;
    let jointId = null;
    for (const id in a) {
        const from = a[id];
        const to = b[id];
        if (!to) {
            continue;
        }
        const dp = v3Distance(from.p, to.p);
        if (dp > maxPosition) {
            maxPosition = dp;
            jointId = id;
        }
        const da = qAngle(from.r, to.r);
        if (da > maxAngle) {
            maxAngle = da;
        }
    }
    return { maxPosition, maxAngle, jointId };
}
/**
 * Indices of keyframe transitions big enough to deserve a sound effect.
 * Returns the index of the *destination* keyframe of each notable transition.
 */
export function accentKeyframes(clip, positionThreshold, angleThreshold) {
    const frames = trimmedKeyframes(clip);
    const accents = [];
    for (let i = 1; i < frames.length; i++) {
        const delta = poseDelta(frames[i - 1].joints, frames[i].joints);
        if (delta.maxPosition >= positionThreshold || delta.maxAngle >= angleThreshold) {
            accents.push(i);
        }
    }
    return accents;
}
