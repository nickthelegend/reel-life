import { cloneClip } from "./Clip.js";
import { clonePose } from "./PoseTypes.js";
import { qNormalize, qSlerp, v3Lerp } from "./Vec.js";
/**
 * Operations on poses themselves: mirroring, smoothing, and copy/paste.
 *
 * These are the moves that make hand-posing survivable. Getting a symmetrical
 * pose by hand in AR is genuinely hard, and a live performance recorded by a
 * human arm always carries tremor — both are fixable in one tap.
 */
/**
 * The mirror of a joint id across the body's centre line.
 * Handles the plain `.L`/`.R` suffix and the quadruped `FL/FR/BL/BR` form.
 */
export function mirrorJointId(jointId) {
    if (jointId.length < 2) {
        return jointId;
    }
    const swapSuffix = (suffix, other) => {
        if (jointId.length > suffix.length && jointId.slice(-suffix.length) === suffix) {
            return jointId.slice(0, jointId.length - suffix.length) + other;
        }
        return null;
    };
    return (swapSuffix("FL", "FR") ||
        swapSuffix("FR", "FL") ||
        swapSuffix("BL", "BR") ||
        swapSuffix("BR", "BL") ||
        swapSuffix(".L", ".R") ||
        swapSuffix(".R", ".L") ||
        jointId);
}
/**
 * Reflect a rotation across the body's YZ plane.
 *
 * Conjugating a rotation by the improper transform diag(-1, 1, 1) negates the
 * y and z components of its quaternion. Doing this by naively negating angles
 * instead is the classic way to end up with a mirrored pose whose limbs bend
 * the wrong way.
 */
export function mirrorQuat(q) {
    return qNormalize({ x: q.x, y: -q.y, z: -q.z, w: q.w });
}
export function mirrorVec(v) {
    return { x: -v.x, y: v.y, z: v.z };
}
/** Flip a whole pose left-to-right. */
export function mirrorPose(pose) {
    const out = {};
    for (const jointId in pose) {
        const target = mirrorJointId(jointId);
        const source = pose[jointId];
        out[target] = {
            p: mirrorVec(source.p),
            r: mirrorQuat(source.r),
        };
    }
    return out;
}
export function mirrorClip(clip, newId) {
    const out = cloneClip(clip, newId);
    out.name = `${clip.name} (mirrored)`;
    for (const keyframe of out.keyframes) {
        keyframe.joints = mirrorPose(keyframe.joints);
    }
    return out;
}
/**
 * Default smoothing strength.
 *
 * These are tied to JITTER_SUGGEST_THRESHOLD by a test: applying the default
 * smoothing to a take shaky enough to be flagged must bring it under the
 * threshold. Otherwise the app would offer to smooth, smooth, and immediately
 * offer again — a loop the user cannot get out of.
 */
export const DEFAULT_SMOOTH_STRENGTH = 0.8;
export const DEFAULT_SMOOTH_PASSES = 4;
/**
 * Pull the tremor out of a recorded performance.
 *
 * A moving average on position and a slerp toward the neighbour midpoint on
 * rotation, applied over a few passes. Endpoints are pinned so the take still
 * starts and ends exactly where the user put it.
 *
 * @param strength 0..1 — how far each frame moves toward its neighbours' midpoint
 * @param passes   more passes widen the effective window
 */
export function smoothClip(clip, newId, strength = DEFAULT_SMOOTH_STRENGTH, passes = DEFAULT_SMOOTH_PASSES) {
    const out = cloneClip(clip, newId);
    if (out.keyframes.length < 3 || strength <= 0 || passes <= 0) {
        return out;
    }
    const amount = Math.min(1, Math.max(0, strength));
    for (let pass = 0; pass < passes; pass++) {
        const source = out.keyframes.map((kf) => clonePose(kf.joints));
        for (let i = 1; i < out.keyframes.length - 1; i++) {
            const previous = source[i - 1];
            const current = source[i];
            const next = source[i + 1];
            for (const jointId in current) {
                if (!previous[jointId] || !next[jointId]) {
                    continue;
                }
                const midpoint = {
                    p: v3Lerp(previous[jointId].p, next[jointId].p, 0.5),
                    r: qSlerp(previous[jointId].r, next[jointId].r, 0.5),
                };
                out.keyframes[i].joints[jointId] = {
                    p: v3Lerp(current[jointId].p, midpoint.p, amount),
                    r: qSlerp(current[jointId].r, midpoint.r, amount),
                };
            }
        }
    }
    return out;
}
/**
 * How much a joint's path deviates from a straight line through its neighbours.
 *
 * Deliberately NOT total path length: a puppet walking steadily across the
 * table covers a lot of distance and none of it is tremor. Measuring the second
 * difference isolates the shake from the travel, so a smooth fast take scores
 * near zero and a still-but-wobbly one scores high.
 */
export function jitterScore(clip, jointId) {
    let total = 0;
    for (let i = 1; i < clip.keyframes.length - 1; i++) {
        const a = clip.keyframes[i - 1].joints[jointId];
        const b = clip.keyframes[i].joints[jointId];
        const c = clip.keyframes[i + 1].joints[jointId];
        if (!a || !b || !c) {
            continue;
        }
        const dx = b.p.x - (a.p.x + c.p.x) / 2;
        const dy = b.p.y - (a.p.y + c.p.y) / 2;
        const dz = b.p.z - (a.p.z + c.p.z) / 2;
        total += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return total;
}
/**
 * Jitter per keyframe of the SHAKIEST joint, not the average across all of them.
 *
 * Averaging hides the thing you care about: a rig has a dozen joints and the
 * user is usually holding one. Nine still limbs would dilute a badly shaking
 * hand below any sensible threshold.
 */
export function jitterPerFrame(clip, jointIds) {
    const usable = Math.max(1, clip.keyframes.length - 2);
    let peak = 0;
    for (const jointId of jointIds) {
        const perFrame = jitterScore(clip, jointId) / usable;
        if (perFrame > peak) {
            peak = perFrame;
        }
    }
    return peak;
}
/** Hand tremor above this (cm per frame) is worth offering to smooth away. */
export const JITTER_SUGGEST_THRESHOLD = 0.35;
/**
 * Whether a take is shaky enough that the app should offer to smooth it.
 * Only ever applied to live performances — stop-motion poses are deliberate.
 */
export function shouldSuggestSmoothing(clip, jointIds) {
    if (clip.source !== "performance" || clip.keyframes.length < 5) {
        return false;
    }
    return jitterPerFrame(clip, jointIds) > JITTER_SUGGEST_THRESHOLD;
}
/** Overwrite one keyframe's pose — the paste half of copy/paste. */
export function replaceKeyframePose(clip, index, pose) {
    if (index < 0 || index >= clip.keyframes.length) {
        return false;
    }
    clip.keyframes[index].joints = clonePose(pose);
    return true;
}
/** Snapshot a keyframe's pose — the copy half. */
export function copyKeyframePose(clip, index) {
    if (index < 0 || index >= clip.keyframes.length) {
        return null;
    }
    return clonePose(clip.keyframes[index].joints);
}
