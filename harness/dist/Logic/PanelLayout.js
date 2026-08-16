import { clamp } from "./Vec.js";
export function slotWidth(metrics) {
    return metrics.chipWidthCm + metrics.gapCm;
}
/** Total width the whole strip occupies. */
export function trackWidth(metrics, chipCount) {
    return Math.max(1, chipCount) * slotWidth(metrics);
}
/** Local X of slot `index`, with the strip centred on the panel origin. */
export function slotX(metrics, index, chipCount) {
    const count = Math.max(1, chipCount);
    return (index - (count - 1) / 2) * slotWidth(metrics);
}
/** Which slot a chip dragged to local X belongs in. Inverse of slotX. */
export function indexForX(metrics, x, chipCount) {
    const count = Math.max(1, chipCount);
    const raw = x / slotWidth(metrics) + (count - 1) / 2;
    return clamp(Math.round(raw), 0, count - 1);
}
/**
 * Which keyframe a trim handle at local X is over.
 * X runs from -half (first keyframe) to +half (last).
 */
export function keyframeIndexForX(metrics, x, keyframeCount) {
    if (keyframeCount <= 1) {
        return 0;
    }
    const half = metrics.chipWidthCm / 2;
    const u = clamp((x + half) / metrics.chipWidthCm, 0, 1);
    return Math.round(u * (keyframeCount - 1));
}
/** Where a trim handle sits for a given keyframe index. Inverse of the above. */
export function xForKeyframeIndex(metrics, index, keyframeCount) {
    const last = Math.max(1, keyframeCount - 1);
    const half = metrics.chipWidthCm / 2;
    return -half + (clamp(index, 0, last) / last) * metrics.chipWidthCm;
}
/** Playhead X for a reel-global time, across the whole strip. */
export function playheadX(metrics, globalT, totalDuration, chipCount) {
    if (totalDuration <= 0) {
        return 0;
    }
    const span = trackWidth(metrics, chipCount);
    return -span / 2 + (clamp(globalT, 0, totalDuration) / totalDuration) * span;
}
/** "Take 2 · 1.60s · 5/8 poses ✂" */
export function chipLabel(name, durationSeconds, keptPoses, totalPoses, caption) {
    const trimmed = keptPoses < totalPoses ? " ✂" : "";
    const captionPart = caption ? ` · "${caption}"` : "";
    return `${name} · ${durationSeconds.toFixed(2)}s · ${keptPoses}/${totalPoses} poses${trimmed}${captionPart}`;
}
