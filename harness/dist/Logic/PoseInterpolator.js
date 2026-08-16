import { trimmedKeyframes } from "./Clip.js";
import { easeByName } from "./Easing.js";
import { clonePose } from "./PoseTypes.js";
import { clamp, qSlerp, v3Lerp } from "./Vec.js";
/**
 * Runtime tweening between recorded poses.
 *
 * Lens Studio's Animate / AnimationPlayer stack is an editor-time authoring
 * tool — it cannot be handed a keyframe array the end user just recorded in AR.
 * So playback is done here: position lerps, rotation slerps, and an ease curve
 * per clip so the result reads as intentional puppet motion rather than a
 * linear slide between transforms.
 */
function findSegment(frames, t) {
    // Binary search for the last frame whose time is <= t.
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (frames[mid].t <= t) {
            lo = mid;
        }
        else {
            hi = mid - 1;
        }
    }
    return lo;
}
/** Blend two poses, taking joints that exist in only one side verbatim. */
export function blendPoses(a, b, u) {
    const out = {};
    for (const id in a) {
        const from = a[id];
        const to = b[id];
        if (!to) {
            out[id] = { p: { ...from.p }, r: { ...from.r } };
            continue;
        }
        out[id] = {
            p: v3Lerp(from.p, to.p, u),
            r: qSlerp(from.r, to.r, u),
        };
    }
    for (const id in b) {
        if (!a[id]) {
            const to = b[id];
            out[id] = { p: { ...to.p }, r: { ...to.r } };
        }
    }
    return out;
}
/**
 * Sample a clip at `localT` seconds from the start of its trimmed range.
 * Times outside the range clamp to the first/last pose (a held pose), which is
 * what stop-motion wants at clip boundaries.
 */
export function samplePose(clip, localT, easeOverride) {
    const frames = trimmedKeyframes(clip);
    if (frames.length === 0) {
        return null;
    }
    if (frames.length === 1) {
        return clonePose(frames[0].joints);
    }
    const start = frames[0].t;
    const end = frames[frames.length - 1].t;
    const absolute = clamp(start + localT, start, end);
    const i = findSegment(frames, absolute);
    if (i >= frames.length - 1) {
        return clonePose(frames[frames.length - 1].joints);
    }
    const a = frames[i];
    const b = frames[i + 1];
    const span = b.t - a.t;
    const raw = span <= 0 ? 1 : (absolute - a.t) / span;
    const ease = easeByName(easeOverride || clip.ease);
    return blendPoses(a.joints, b.joints, ease(clamp(raw, 0, 1)));
}
/** Index of the trimmed keyframe nearest a local time. Used by onion skinning. */
export function nearestKeyframeIndex(clip, localT) {
    const frames = trimmedKeyframes(clip);
    if (frames.length === 0) {
        return -1;
    }
    const absolute = frames[0].t + localT;
    let best = 0;
    let bestDistance = Math.abs(frames[0].t - absolute);
    for (let i = 1; i < frames.length; i++) {
        const distance = Math.abs(frames[i].t - absolute);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
        }
    }
    return best;
}
