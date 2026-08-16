import { cloneClip } from "./Clip.js";
import { findJoint } from "./RigPlan.js";
import { V3_ZERO, v3Add, v3Scale, v3Sub } from "./Vec.js";
/**
 * Limbs that play the same structural role across archetypes, most-preferred
 * first. A wing is an arm is a front leg.
 */
const EQUIVALENCE_GROUPS = [
    ["arm.L", "wing.L", "leg.FL"],
    ["arm.R", "wing.R", "leg.FR"],
    ["leg.L", "leg.BL"],
    ["leg.R", "leg.BR"],
    ["tail"],
    ["head"],
    ["neck"],
    ["torso"],
    ["hips"],
];
function equivalentsOf(jointId) {
    for (const group of EQUIVALENCE_GROUPS) {
        if (group.indexOf(jointId) >= 0) {
            return group;
        }
    }
    return [jointId];
}
/** The best joint on `target` to receive `sourceJointId`, or null. */
export function mapJoint(sourceJointId, target) {
    if (findJoint(target, sourceJointId)) {
        return { jointId: sourceJointId, exact: true };
    }
    for (const candidate of equivalentsOf(sourceJointId)) {
        if (candidate !== sourceJointId && findJoint(target, candidate)) {
            return { jointId: candidate, exact: false };
        }
    }
    return null;
}
function restOffset(plan, jointId) {
    const joint = findJoint(plan, jointId);
    return joint ? joint.offset : V3_ZERO;
}
export function retargetPose(pose, from, to) {
    const scale = from.targetHeightCm > 0 ? to.targetHeightCm / from.targetHeightCm : 1;
    const report = {
        exact: [],
        substituted: {},
        dropped: [],
        unfilled: [],
        scale,
    };
    const out = {};
    for (const sourceJointId in pose) {
        const mapping = mapJoint(sourceJointId, to);
        if (!mapping) {
            report.dropped.push(sourceJointId);
            continue;
        }
        if (out[mapping.jointId]) {
            // Two source joints competing for one target: first mapping wins, and
            // the loser is reported rather than silently overwriting.
            report.dropped.push(sourceJointId);
            continue;
        }
        const source = pose[sourceJointId];
        const sourceRest = restOffset(from, sourceJointId);
        const targetRest = restOffset(to, mapping.jointId);
        out[mapping.jointId] = {
            // Rest offset of the target, plus however far the user moved it from
            // rest on the source, scaled to the new character's size.
            p: v3Add(targetRest, v3Scale(v3Sub(source.p, sourceRest), scale)),
            r: { ...source.r },
        };
        if (mapping.exact) {
            report.exact.push(sourceJointId);
        }
        else {
            report.substituted[sourceJointId] = mapping.jointId;
        }
    }
    for (const joint of to.joints) {
        if (joint.poseable && !out[joint.id]) {
            report.unfilled.push(joint.id);
        }
    }
    return { pose: out, report };
}
export function retargetClip(clip, from, to, newId) {
    const out = cloneClip(clip, newId);
    out.name = `${clip.name} → ${to.subject}`;
    let report = {
        exact: [],
        substituted: {},
        dropped: [],
        unfilled: [],
        scale: 1,
    };
    for (const keyframe of out.keyframes) {
        const result = retargetPose(keyframe.joints, from, to);
        keyframe.joints = result.pose;
        report = result.report;
    }
    return { clip: out, report };
}
/** How much of a take survives the move, 0..1. Shown before committing to it. */
export function retargetFidelity(report) {
    const mapped = report.exact.length + Object.keys(report.substituted).length;
    const total = mapped + report.dropped.length;
    return total === 0 ? 0 : mapped / total;
}
export function describeRetarget(report) {
    const substituted = Object.keys(report.substituted).length;
    const parts = [`${report.exact.length} matched`];
    if (substituted > 0) {
        parts.push(`${substituted} adapted`);
    }
    if (report.dropped.length > 0) {
        parts.push(`${report.dropped.length} dropped`);
    }
    return `${parts.join(", ")} · ${Math.round(retargetFidelity(report) * 100)}% carried over`;
}
