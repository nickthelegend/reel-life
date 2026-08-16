import { clipDuration, trimmedKeyframes } from "./Clip.js";
import { isOverlong } from "./ClipOps.js";
import { arcRatio, extremityJoints, jointArc, worldTravel } from "./Kinematics.js";
import { jitterPerFrame, shouldSuggestSmoothing } from "./PoseOps.js";
import { poseableJointIds } from "./RigPlan.js";
import { qAngle, v3Distance } from "./Vec.js";
export function reelStats(timeline, plan, bpm) {
    let poses = 0;
    let keptPoses = 0;
    let captions = 0;
    let longestTakeName = null;
    let longest = -1;
    for (const clip of timeline.clips) {
        poses += clip.keyframes.length;
        keptPoses += trimmedKeyframes(clip).length;
        if (clip.caption) {
            captions++;
        }
        const duration = clipDuration(clip);
        if (duration > longest) {
            longest = duration;
            longestTakeName = clip.name;
        }
    }
    let travelCm = 0;
    const tips = extremityJoints(plan);
    for (const clip of timeline.clips) {
        for (const jointId of tips) {
            travelCm += worldTravel(clip, plan, jointId);
        }
    }
    return {
        takes: timeline.clips.length,
        poses,
        keptPoses,
        durationSeconds: timeline.totalDuration(),
        bpm,
        longestTakeName,
        captions,
        jointsAnimated: countAnimatedJoints(timeline.clips, plan),
        travelCm: Math.round(travelCm),
    };
}
/** Joints the user actually moved, rather than every joint the rig has. */
export function countAnimatedJoints(clips, plan) {
    const moved = {};
    for (const clip of clips) {
        const frames = trimmedKeyframes(clip);
        if (frames.length < 2) {
            continue;
        }
        const first = frames[0].joints;
        for (const jointId of poseableJointIds(plan)) {
            if (moved[jointId] || !first[jointId]) {
                continue;
            }
            for (let i = 1; i < frames.length; i++) {
                const later = frames[i].joints[jointId];
                if (!later) {
                    continue;
                }
                if (v3Distance(first[jointId].p, later.p) > 0.1 ||
                    qAngle(first[jointId].r, later.r) > 0.02) {
                    moved[jointId] = true;
                    break;
                }
            }
        }
    }
    return Object.keys(moved).length;
}
/**
 * Keep a reel-global time strictly inside the segment it belongs to.
 *
 * A clip's final keyframe sits exactly on its segment's end, and segment
 * lookup treats `end` as belonging to the NEXT clip — so seeking to a poster
 * frame that happens to be a clip's last pose would land on the following
 * take's first pose instead. Nudging back by a hair keeps the time pointing at
 * the pose it names.
 */
function timeInsideSegment(segment, t) {
    const epsilon = 1e-4;
    if (t < segment.end - epsilon) {
        return t;
    }
    return Math.max(segment.start, segment.end - epsilon);
}
export function posterFrame(timeline, plan) {
    if (timeline.isEmpty()) {
        return null;
    }
    const jointIds = poseableJointIds(plan);
    const segments = timeline.segments();
    // Mean position per joint across every kept pose in the reel.
    const totals = {};
    let counted = 0;
    for (const clip of timeline.clips) {
        for (const frame of trimmedKeyframes(clip)) {
            counted++;
            for (const jointId of jointIds) {
                const jp = frame.joints[jointId];
                if (!jp) {
                    continue;
                }
                if (!totals[jointId]) {
                    totals[jointId] = { x: 0, y: 0, z: 0 };
                }
                totals[jointId].x += jp.p.x;
                totals[jointId].y += jp.p.y;
                totals[jointId].z += jp.p.z;
            }
        }
    }
    if (counted === 0) {
        return null;
    }
    const mean = {};
    for (const jointId in totals) {
        mean[jointId] = {
            p: {
                x: totals[jointId].x / counted,
                y: totals[jointId].y / counted,
                z: totals[jointId].z / counted,
            },
            r: { x: 0, y: 0, z: 0, w: 1 },
        };
    }
    let best = null;
    for (let clipIndex = 0; clipIndex < timeline.clips.length; clipIndex++) {
        const clip = timeline.clips[clipIndex];
        const frames = trimmedKeyframes(clip);
        const start = frames.length > 0 ? frames[0].t : 0;
        for (let i = 0; i < frames.length; i++) {
            let score = 0;
            for (const jointId in mean) {
                const jp = frames[i].joints[jointId];
                if (jp) {
                    score += v3Distance(mean[jointId].p, jp.p);
                }
            }
            if (!best || score > best.score) {
                best = {
                    clipId: clip.id,
                    clipIndex,
                    keyframeIndex: i,
                    globalT: timeInsideSegment(segments[clipIndex], segments[clipIndex].start + (frames[i].t - start)),
                    score,
                };
            }
        }
    }
    return best;
}
/** Straighter than this on an extremity reads as mechanical. */
const STRAIGHT_ARC_RATIO = 1.02;
/** Below this a joint has barely moved and its arc is not worth judging. */
const MIN_ARC_TRAVEL_CM = 3;
/**
 * Everything the app has to say about the current reel, most useful first.
 * An empty reel returns the "what to do next" tips rather than nothing.
 */
export function reelHealth(timeline, plan) {
    const notes = [];
    if (timeline.isEmpty()) {
        notes.push({
            id: "empty",
            severity: "tip",
            message: "No takes yet — pose a limb, tap Capture Pose a few times, then New Take.",
            clipId: null,
            fix: null,
        });
        return notes;
    }
    const jointIds = poseableJointIds(plan);
    for (const clip of timeline.clips) {
        const frames = trimmedKeyframes(clip);
        if (frames.length < 2) {
            notes.push({
                id: `single-pose:${clip.id}`,
                severity: "warning",
                message: `${clip.name} is a single pose — it will hold still. Capture another.`,
                clipId: clip.id,
                fix: null,
            });
            continue;
        }
        if (isOverlong(clip)) {
            notes.push({
                id: `overlong:${clip.id}`,
                severity: "warning",
                message: `${clip.name} runs long. Trim it so the reel stays watchable.`,
                clipId: clip.id,
                fix: "trim",
            });
        }
        if (shouldSuggestSmoothing(clip, jointIds)) {
            const jitter = jitterPerFrame(clip, jointIds).toFixed(1);
            notes.push({
                id: `shaky:${clip.id}`,
                severity: "tip",
                message: `${clip.name} is shaky (${jitter}cm/frame). Say "smooth it" to steady it.`,
                clipId: clip.id,
                fix: "smooth",
            });
        }
        for (const jointId of extremityJoints(plan)) {
            const arc = jointArc(clip, plan, jointId);
            const travel = worldTravel(clip, plan, jointId);
            if (travel < MIN_ARC_TRAVEL_CM) {
                continue;
            }
            if (arcRatio(arc) < STRAIGHT_ARC_RATIO) {
                notes.push({
                    id: `straight:${clip.id}:${jointId}`,
                    severity: "tip",
                    message: `${jointId} travels in a straight line in ${clip.name}. Real motion arcs — try curving it.`,
                    clipId: clip.id,
                    fix: null,
                });
            }
        }
    }
    if (timeline.clips.length === 1) {
        notes.push({
            id: "one-take",
            severity: "tip",
            message: "One take so far. A second take gives you something to cut against.",
            clipId: null,
            fix: null,
        });
    }
    let captions = 0;
    for (const clip of timeline.clips) {
        if (clip.caption) {
            captions++;
        }
    }
    if (captions === 0 && timeline.clips.length >= 2) {
        notes.push({
            id: "no-captions",
            severity: "tip",
            message: "No captions yet — tap a chip's tab and say one to title the take.",
            clipId: null,
            fix: "caption",
        });
    }
    // Warnings first: they are things that will look wrong on camera.
    return notes.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}
function severityRank(severity) {
    return severity === "warning" ? 1 : 0;
}
/** One-line summary for the stats card. */
export function describeStats(stats) {
    return [
        `${stats.takes} ${stats.takes === 1 ? "take" : "takes"}`,
        `${stats.keptPoses} poses`,
        `${stats.durationSeconds.toFixed(1)}s`,
        `${Math.round(stats.bpm)} BPM`,
        `${stats.jointsAnimated} joints`,
    ].join(" · ");
}
