import { Clip, clipDuration, trimmedKeyframes } from "./Clip";
import { isOverlong } from "./ClipOps";
import { arcRatio, extremityJoints, jointArc, worldTravel } from "./Kinematics";
import { jitterPerFrame, shouldSuggestSmoothing } from "./PoseOps";
import { PoseSample } from "./PoseTypes";
import { ReelTimeline } from "./ReelTimeline";
import { RigPlan, poseableJointIds } from "./RigPlan";
import { qAngle, v3Distance } from "./Vec";

/**
 * What the reel actually contains, and what is wrong with it.
 *
 * Two jobs. The stats card is the end-of-reel readout — the numbers a creator
 * wants and a judge can read off the screen. The health checks are the app
 * looking over your shoulder: an empty timeline explains what to do next, a
 * shaky take offers to smooth itself, a limb travelling in a dead straight line
 * gets flagged because animators care about arcs.
 *
 * It replaces the usual dead empty state with something that teaches.
 */

export interface ReelStats {
  takes: number;
  poses: number;
  /** Poses actually kept after trimming. */
  keptPoses: number;
  durationSeconds: number;
  bpm: number;
  longestTakeName: string | null;
  captions: number;
  jointsAnimated: number;
  /** Total distance every extremity travelled, in cm. */
  travelCm: number;
}

export function reelStats(
  timeline: ReelTimeline,
  plan: RigPlan,
  bpm: number
): ReelStats {
  let poses = 0;
  let keptPoses = 0;
  let captions = 0;
  let longestTakeName: string | null = null;
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
export function countAnimatedJoints(clips: Clip[], plan: RigPlan): number {
  const moved: Record<string, boolean> = {};

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
        if (
          v3Distance(first[jointId].p, later.p) > 0.1 ||
          qAngle(first[jointId].r, later.r) > 0.02
        ) {
          moved[jointId] = true;
          break;
        }
      }
    }
  }
  return Object.keys(moved).length;
}

/**
 * The single most extreme pose in the reel — the one furthest from the average.
 * That is almost always the frame a person would pick as the poster, and it is
 * what the end card holds on.
 */
export interface PosterFrame {
  clipId: string;
  clipIndex: number;
  keyframeIndex: number;
  /** Reel-global time, for seeking straight to it. */
  globalT: number;
  score: number;
}

export function posterFrame(timeline: ReelTimeline, plan: RigPlan): PosterFrame | null {
  if (timeline.isEmpty()) {
    return null;
  }

  const jointIds = poseableJointIds(plan);
  const segments = timeline.segments();

  // Mean position per joint across every kept pose in the reel.
  const totals: Record<string, { x: number; y: number; z: number }> = {};
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

  const mean: PoseSample = {};
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

  let best: PosterFrame | null = null;
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
          globalT: segments[clipIndex].start + (frames[i].t - start),
          score,
        };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Health checks — the app coaching the user
// ---------------------------------------------------------------------------

export type HealthSeverity = "tip" | "warning";

export interface HealthNote {
  id: string;
  severity: HealthSeverity;
  message: string;
  /** Clip the note is about, if any. */
  clipId: string | null;
  /** The command that would fix it, for a one-tap action. */
  fix: string | null;
}

/** Straighter than this on an extremity reads as mechanical. */
const STRAIGHT_ARC_RATIO = 1.02;

/** Below this a joint has barely moved and its arc is not worth judging. */
const MIN_ARC_TRAVEL_CM = 3;

/**
 * Everything the app has to say about the current reel, most useful first.
 * An empty reel returns the "what to do next" tips rather than nothing.
 */
export function reelHealth(timeline: ReelTimeline, plan: RigPlan): HealthNote[] {
  const notes: HealthNote[] = [];

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

function severityRank(severity: HealthSeverity): number {
  return severity === "warning" ? 1 : 0;
}

/** One-line summary for the stats card. */
export function describeStats(stats: ReelStats): string {
  return [
    `${stats.takes} ${stats.takes === 1 ? "take" : "takes"}`,
    `${stats.keptPoses} poses`,
    `${stats.durationSeconds.toFixed(1)}s`,
    `${Math.round(stats.bpm)} BPM`,
    `${stats.jointsAnimated} joints`,
  ].join(" · ");
}
