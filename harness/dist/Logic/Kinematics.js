import { trimmedKeyframes } from "./Clip.js";
import { samplePose } from "./PoseInterpolator.js";
import { jointsInBuildOrder } from "./RigPlan.js";
import { Q_IDENTITY, V3_ZERO, qMultiply, qNormalize, qRotate, v3Add, v3Distance, } from "./Vec.js";
/**
 * Resolve every joint to world space (relative to the character root).
 * Joints missing from the pose fall back to their rest offset, so a partial
 * pose still produces a complete skeleton.
 */
export function forwardKinematics(pose, plan) {
    const world = {};
    // Parents must resolve before children, whatever order the plan stores them.
    for (const joint of jointsInBuildOrder(plan)) {
        const local = pose[joint.id];
        const localPosition = local ? local.p : joint.offset;
        const localRotation = local ? local.r : Q_IDENTITY;
        if (joint.parent === null) {
            world[joint.id] = { p: localPosition, r: qNormalize(localRotation) };
            continue;
        }
        const parent = world[joint.parent];
        if (!parent) {
            // Parent not resolved yet: the plan is out of order. Treat as a root
            // rather than silently placing the joint at the origin.
            world[joint.id] = { p: localPosition, r: qNormalize(localRotation) };
            continue;
        }
        world[joint.id] = {
            p: v3Add(parent.p, qRotate(parent.r, localPosition)),
            r: qNormalize(qMultiply(parent.r, localRotation)),
        };
    }
    return world;
}
export function worldPosition(pose, plan, jointId) {
    const world = forwardKinematics(pose, plan);
    return world[jointId] ? world[jointId].p : V3_ZERO;
}
export const DEFAULT_ARC_OPTIONS = {
    samples: 48,
    minSpacingCm: 0.4,
};
/**
 * The path a joint traces through space over a take, ready to draw as a ribbon
 * or a line of dots beside the puppet.
 */
export function jointArc(clip, plan, jointId, options = DEFAULT_ARC_OPTIONS) {
    const frames = trimmedKeyframes(clip);
    if (frames.length < 2) {
        return [];
    }
    const duration = frames[frames.length - 1].t - frames[0].t;
    const samples = Math.max(2, Math.round(options.samples));
    const path = [];
    for (let i = 0; i < samples; i++) {
        const pose = samplePose(clip, (i / (samples - 1)) * duration);
        if (!pose) {
            continue;
        }
        const world = forwardKinematics(pose, plan);
        const transform = world[jointId];
        if (!transform) {
            continue;
        }
        const previous = path[path.length - 1];
        if (previous && v3Distance(previous, transform.p) < options.minSpacingCm) {
            continue;
        }
        path.push(transform.p);
    }
    return path;
}
/** Total distance travelled along a path. */
export function pathLength(path) {
    let total = 0;
    for (let i = 1; i < path.length; i++) {
        total += v3Distance(path[i - 1], path[i]);
    }
    return total;
}
/**
 * How curved a path is: 1 means a straight line, higher means it arcs.
 *
 * Animators want arcs, not straight lines — a value close to 1 on a limb is a
 * sign the motion will read as mechanical. This is what the "check arcs"
 * readout reports.
 */
export function arcRatio(path) {
    if (path.length < 2) {
        return 1;
    }
    const direct = v3Distance(path[0], path[path.length - 1]);
    if (direct < 1e-6) {
        // Returned to where it started: report the loop's extent instead.
        return pathLength(path) > 1e-6 ? Infinity : 1;
    }
    return pathLength(path) / direct;
}
/** Joints whose arcs are worth drawing: the ends of the limbs. */
export function extremityJoints(plan) {
    const hasChildren = {};
    for (const joint of plan.joints) {
        if (joint.parent) {
            hasChildren[joint.parent] = true;
        }
    }
    return plan.joints
        .filter((joint) => joint.poseable && !hasChildren[joint.id])
        .map((joint) => joint.id);
}
/**
 * How far a joint drifts across a take, in world space.
 * Used to pick which arcs are worth showing — a joint that barely moves would
 * just be a smudge.
 */
export function worldTravel(clip, plan, jointId, options = DEFAULT_ARC_OPTIONS) {
    return pathLength(jointArc(clip, plan, jointId, options));
}
