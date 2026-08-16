import { accentKeyframes, poseDelta, trimmedKeyframes } from "./Clip.js";
import { sfxForAccent } from "./MusicPrompt.js";
/**
 * Works out which pose changes deserve a sound, once, up front.
 *
 * Doing this at play time rather than per frame keeps the update loop free of
 * pose comparisons, and keeps the decision deterministic: the same reel always
 * sounds the same, which matters when you are re-recording a demo take.
 */
/** A transition must move a joint this far (cm) or turn it this far (rad). */
export const ACCENT_POSITION_CM = 2.5;
export const ACCENT_ANGLE_RAD = Math.PI / 6;
/** Position delta that counts as a full-strength hit. */
const FULL_STRENGTH_CM = 10;
export function buildAccentIndex(clips) {
    const index = {};
    for (const clip of clips) {
        index[clip.id] = buildClipAccents(clip);
    }
    return index;
}
export function buildClipAccents(clip) {
    const frames = trimmedKeyframes(clip);
    const marks = [];
    for (const keyframeIndex of accentKeyframes(clip, ACCENT_POSITION_CM, ACCENT_ANGLE_RAD)) {
        const delta = poseDelta(frames[keyframeIndex - 1].joints, frames[keyframeIndex].joints);
        marks.push({
            keyframeIndex,
            sfxId: sfxForAccent(delta.jointId, delta.maxPosition),
            jointId: delta.jointId,
            strength: Math.min(1, delta.maxPosition / FULL_STRENGTH_CM),
        });
    }
    return marks;
}
export function accentAtKeyframe(marks, keyframeIndex) {
    if (!marks) {
        return null;
    }
    for (const mark of marks) {
        if (mark.keyframeIndex === keyframeIndex) {
            return mark;
        }
    }
    return null;
}
