import { cloneClip, resetTrim, trimmedKeyframes } from "./Clip.js";
import { cloneKeyframe } from "./PoseTypes.js";
/**
 * Clip surgery: split, merge, reverse, ping-pong, loop.
 *
 * A take is rarely right first time. These are the edits that turn "record it
 * again" into "fix the one you have" — the difference between a toy and an
 * editor. All of them are pure and operate on the trimmed range, so what you
 * see on the timeline is what you cut.
 */
/**
 * Split a take in two at a keyframe. The keyframe is duplicated into both
 * halves so neither side starts or ends mid-air.
 */
export function splitClip(clip, atIndex, idA, idB) {
    const frames = trimmedKeyframes(clip);
    if (frames.length < 3 || atIndex <= 0 || atIndex >= frames.length - 1) {
        // Splitting at an endpoint would leave an empty half.
        return null;
    }
    const first = cloneClip(clip, idA);
    first.name = `${clip.name}a`;
    first.keyframes = frames.slice(0, atIndex + 1).map(cloneKeyframe);
    rebaseToZero(first);
    resetTrim(first);
    const second = cloneClip(clip, idB);
    second.name = `${clip.name}b`;
    second.keyframes = frames.slice(atIndex).map(cloneKeyframe);
    rebaseToZero(second);
    resetTrim(second);
    // A caption belongs to the moment it was written against, not to both halves.
    second.caption = null;
    return [first, second];
}
/**
 * Join two takes into one, preserving the gap between them as a held pose.
 * The second take's timing is rebased onto the end of the first.
 */
export function mergeClips(a, b, newId, gapSeconds = 0.4) {
    const framesA = trimmedKeyframes(a);
    const framesB = trimmedKeyframes(b);
    if (framesA.length === 0 || framesB.length === 0) {
        return null;
    }
    const merged = cloneClip(a, newId);
    merged.name = `${a.name}+${b.name}`;
    merged.keyframes = framesA.map(cloneKeyframe);
    rebaseToZero(merged);
    const offset = merged.keyframes[merged.keyframes.length - 1].t + Math.max(0.001, gapSeconds);
    const startB = framesB[0].t;
    for (const frame of framesB) {
        merged.keyframes.push({
            t: offset + (frame.t - startB),
            joints: cloneKeyframe(frame).joints,
        });
    }
    merged.caption = a.caption || b.caption;
    // Mixing a live take into a stop-motion one makes it a performance overall,
    // which keeps beat quantization from being applied to sampled data.
    merged.source = a.source === b.source ? a.source : "performance";
    resetTrim(merged);
    return merged;
}
/** Play a take backwards. Timing is preserved, order is flipped. */
export function reverseClip(clip, newId) {
    const frames = trimmedKeyframes(clip);
    const out = cloneClip(clip, newId);
    out.name = `${clip.name} (reverse)`;
    if (frames.length < 2) {
        return out;
    }
    const start = frames[0].t;
    const end = frames[frames.length - 1].t;
    out.keyframes = [];
    for (let i = frames.length - 1; i >= 0; i--) {
        out.keyframes.push({
            t: start + (end - frames[i].t),
            joints: cloneKeyframe(frames[i]).joints,
        });
    }
    resetTrim(out);
    return out;
}
/**
 * Forward then backward in one take. The turnaround keyframe is not repeated,
 * so the puppet does not pause at the end of the swing.
 */
export function pingPongClip(clip, newId) {
    const frames = trimmedKeyframes(clip);
    if (frames.length < 2) {
        return null;
    }
    const out = cloneClip(clip, newId);
    out.name = `${clip.name} (ping-pong)`;
    out.keyframes = frames.map(cloneKeyframe);
    rebaseToZero(out);
    const last = out.keyframes[out.keyframes.length - 1].t;
    const end = frames[frames.length - 1].t;
    for (let i = frames.length - 2; i >= 0; i--) {
        out.keyframes.push({
            t: last + (end - frames[i].t),
            joints: cloneKeyframe(frames[i]).joints,
        });
    }
    resetTrim(out);
    return out;
}
/**
 * Close a take into a seamless loop by returning to the opening pose.
 *
 * This is what makes a walk cycle usable: without it a looping clip snaps from
 * its last pose back to its first, which reads as a glitch.
 */
export function loopBlendClip(clip, newId, returnSeconds = 0.4) {
    const frames = trimmedKeyframes(clip);
    if (frames.length < 2) {
        return null;
    }
    const out = cloneClip(clip, newId);
    out.name = `${clip.name} (loop)`;
    out.keyframes = frames.map(cloneKeyframe);
    rebaseToZero(out);
    const last = out.keyframes[out.keyframes.length - 1];
    out.keyframes.push({
        t: last.t + Math.max(0.001, returnSeconds),
        joints: cloneKeyframe(out.keyframes[0]).joints,
    });
    resetTrim(out);
    return out;
}
export function isLoopClosed(clip) {
    const frames = trimmedKeyframes(clip);
    if (frames.length < 2) {
        return false;
    }
    const first = frames[0].joints;
    const last = frames[frames.length - 1].joints;
    for (const jointId in first) {
        const a = first[jointId];
        const b = last[jointId];
        if (!b) {
            return false;
        }
        if (Math.abs(a.p.x - b.p.x) > 1e-6 ||
            Math.abs(a.p.y - b.p.y) > 1e-6 ||
            Math.abs(a.p.z - b.p.z) > 1e-6) {
            return false;
        }
    }
    return true;
}
/** Speed a take up or slow it down without touching its poses. */
export function retimeClip(clip, newId, factor) {
    if (!isFinite(factor) || factor <= 0) {
        return null;
    }
    const out = cloneClip(clip, newId);
    const frames = out.keyframes;
    if (frames.length === 0) {
        return out;
    }
    const start = frames[0].t;
    for (const frame of frames) {
        frame.t = start + (frame.t - start) / factor;
    }
    return out;
}
/** Hold the closing pose, so a take lands instead of cutting away instantly. */
export function holdLastPose(clip, seconds) {
    if (seconds <= 0 || clip.keyframes.length === 0) {
        return clip;
    }
    const last = clip.keyframes[clip.keyframes.length - 1];
    const wasAtEnd = clip.trimOut === clip.keyframes.length - 1;
    clip.keyframes.push({ t: last.t + seconds, joints: cloneKeyframe(last).joints });
    if (wasAtEnd) {
        clip.trimOut = clip.keyframes.length - 1;
    }
    return clip;
}
/** Shift keyframe times so the take starts at zero. */
function rebaseToZero(clip) {
    if (clip.keyframes.length === 0) {
        return;
    }
    const start = clip.keyframes[0].t;
    if (start === 0) {
        return;
    }
    for (const frame of clip.keyframes) {
        frame.t = frame.t - start;
    }
}
/** Longest a single take is allowed to run, to keep a reel demo-length. */
export const MAX_CLIP_SECONDS = 30;
export function isOverlong(clip) {
    const frames = trimmedKeyframes(clip);
    if (frames.length < 2) {
        return false;
    }
    return frames[frames.length - 1].t - frames[0].t > MAX_CLIP_SECONDS;
}
