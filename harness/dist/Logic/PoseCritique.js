import { trimmedKeyframes } from "./Clip.js";
import { forwardKinematics } from "./Kinematics.js";
import { mirrorJointId, mirrorQuat } from "./PoseOps.js";
import { qAngle, v3Distance } from "./Vec.js";
/**
 * Critique of the poses themselves, in the vocabulary animators actually use.
 *
 * The app already coaches on arcs and tremor. These are the next two things
 * anyone teaching character animation would say:
 *
 *  - Twinning: both limbs doing the identical mirrored thing. The single most
 *    recognisable tell of inexperienced animation, and hand-posing in AR makes
 *    it very easy to do by accident.
 *  - Pose contrast: consecutive keys too similar to read as separate poses, so
 *    the performance turns to mush.
 *
 * Both are geometry over the existing rig, so they run and are testable. A
 * third check — line of action — was built and then cut; see the note below.
 */
// ---------------------------------------------------------------------------
// Twinning
// ---------------------------------------------------------------------------
/** Left/right joint pairs in the rig, each listed once. */
export function mirroredPairs(plan) {
    const pairs = [];
    const seen = {};
    for (const joint of plan.joints) {
        if (!joint.poseable || seen[joint.id]) {
            continue;
        }
        const partner = mirrorJointId(joint.id);
        if (partner === joint.id) {
            continue;
        }
        for (const other of plan.joints) {
            if (other.id === partner) {
                pairs.push([joint.id, partner]);
                seen[joint.id] = true;
                seen[partner] = true;
                break;
            }
        }
    }
    return pairs;
}
/** A joint this close to rest has not been posed. */
const AT_REST_RAD = 0.05;
function isAtRest(q) {
    return qAngle(q, IDENTITY) <= AT_REST_RAD;
}
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
/**
 * Perfectly twinned = 1, completely independent = 0.
 *
 * Only pairs where at least one side has actually been posed are counted. A
 * limb pair sitting at rest is two identical identity rotations, which scores
 * as perfectly twinned and would drag the average up — a character whose legs
 * were never touched would be reported as twinned no matter what its arms did.
 */
export function twinningScore(pose, plan) {
    let total = 0;
    let counted = 0;
    for (const [left, right] of mirroredPairs(plan)) {
        const a = pose[left];
        const b = pose[right];
        if (!a || !b) {
            continue;
        }
        if (isAtRest(a.r) && isAtRest(b.r)) {
            continue;
        }
        // A twinned pair is one where the right joint is the mirror of the left.
        const angle = qAngle(mirrorQuat(a.r), b.r);
        // 0 radians apart -> fully twinned; a quarter turn or more -> not at all.
        total += Math.max(0, 1 - angle / (Math.PI / 2));
        counted++;
    }
    return counted === 0 ? 0 : total / counted;
}
/** Above this, a pose reads as twinned. */
export const TWINNING_THRESHOLD = 0.9;
/**
 * Keyframes where the limbs are mirroring each other too closely.
 *
 * A rest pose is trivially twinned and is not a mistake, so poses where the
 * limbs have not moved at all are excluded — only *animated* twinning counts.
 */
export function detectTwinning(clip, plan, threshold = TWINNING_THRESHOLD) {
    const frames = trimmedKeyframes(clip);
    const pairs = mirroredPairs(plan);
    const out = [];
    for (let i = 0; i < frames.length; i++) {
        let anyMoved = false;
        for (const [left, right] of pairs) {
            const a = frames[i].joints[left];
            const b = frames[i].joints[right];
            if (a && !isAtRest(a.r)) {
                anyMoved = true;
            }
            if (b && !isAtRest(b.r)) {
                anyMoved = true;
            }
        }
        if (!anyMoved) {
            continue;
        }
        const score = twinningScore(frames[i].joints, plan);
        if (score >= threshold) {
            out.push({ keyframeIndex: i, score: Number(score.toFixed(4)) });
        }
    }
    return out;
}
// ---------------------------------------------------------------------------
// Pose contrast
// ---------------------------------------------------------------------------
/**
 * How different two poses read, in world-space cm averaged over the joints.
 * Measured after forward kinematics, because that is what the eye sees — two
 * poses can differ a lot in local rotations and still look identical.
 */
export function poseContrast(a, b, plan) {
    const worldA = forwardKinematics(a, plan);
    const worldB = forwardKinematics(b, plan);
    let total = 0;
    let counted = 0;
    for (const joint of plan.joints) {
        if (!joint.poseable) {
            continue;
        }
        const pa = worldA[joint.id];
        const pb = worldB[joint.id];
        if (!pa || !pb) {
            continue;
        }
        total += v3Distance(pa.p, pb.p);
        counted++;
    }
    return counted === 0 ? 0 : total / counted;
}
/** Below this average movement (cm), consecutive keys read as the same pose. */
export const LOW_CONTRAST_CM = 0.6;
export function lowContrastPairs(clip, plan, threshold = LOW_CONTRAST_CM) {
    const frames = trimmedKeyframes(clip);
    const out = [];
    for (let i = 1; i < frames.length; i++) {
        const contrast = poseContrast(frames[i - 1].joints, frames[i].joints, plan);
        if (contrast < threshold) {
            out.push({
                fromIndex: i - 1,
                toIndex: i,
                contrastCm: Number(contrast.toFixed(4)),
            });
        }
    }
    return out;
}
export function critiqueClip(clip, plan) {
    return {
        twinnedKeyframes: detectTwinning(clip, plan).map((r) => r.keyframeIndex),
        lowContrastPairs: lowContrastPairs(clip, plan),
    };
}
