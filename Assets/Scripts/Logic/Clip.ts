import { EaseName } from "./Easing";
import { PoseKeyframe, PoseSample, cloneKeyframe } from "./PoseTypes";
import { clamp, qAngle, v3Distance } from "./Vec";

export type ClipSource = "stopmotion" | "performance";

/**
 * A clip is one continuous take: either a stop-motion sequence of deliberate
 * poses, or a live performance sampled on a fixed interval.
 *
 * Trimming is non-destructive. `trimIn`/`trimOut` are keyframe indices, so
 * dragging a trim handle never throws away the recording — you can always drag
 * it back out again.
 */
export interface Clip {
  id: string;
  name: string;
  source: ClipSource;
  keyframes: PoseKeyframe[];
  trimIn: number;
  trimOut: number;
  caption: string | null;
  ease: EaseName;
}

/** A clip with a single keyframe still needs to occupy time on the timeline. */
export const MIN_CLIP_DURATION = 0.4;

/** Stop-motion cadence: the gap inserted between consecutive captured poses. */
export const STOPMOTION_STEP = 0.4;

export function createClip(
  id: string,
  name: string,
  source: ClipSource,
  ease: EaseName = "smooth"
): Clip {
  return {
    id,
    name,
    source,
    keyframes: [],
    trimIn: 0,
    trimOut: 0,
    caption: null,
    ease,
  };
}

/**
 * Append a keyframe, keeping timestamps strictly increasing.
 *
 * If the trim-out handle was sitting at the end of the clip it follows the new
 * keyframe, so recording never silently lands outside the trimmed range.
 */
export function appendKeyframe(clip: Clip, keyframe: PoseKeyframe): Clip {
  const last = clip.keyframes[clip.keyframes.length - 1];
  const wasAtEnd = clip.keyframes.length === 0 || clip.trimOut === clip.keyframes.length - 1;

  let t = keyframe.t;
  if (last && t <= last.t) {
    t = last.t + 0.001;
  }
  clip.keyframes.push({ t, joints: keyframe.joints });

  if (wasAtEnd) {
    clip.trimOut = clip.keyframes.length - 1;
  }
  clip.trimIn = clamp(clip.trimIn, 0, clip.trimOut);
  return clip;
}

/** Append a pose using the stop-motion cadence rather than a wall-clock time. */
export function captureStopMotionPose(clip: Clip, pose: PoseSample): Clip {
  const last = clip.keyframes[clip.keyframes.length - 1];
  const t = last ? last.t + STOPMOTION_STEP : 0;
  return appendKeyframe(clip, { t, joints: pose });
}

export function keyframeCount(clip: Clip): number {
  return clip.keyframes.length;
}

export function trimmedKeyframes(clip: Clip): PoseKeyframe[] {
  if (clip.keyframes.length === 0) {
    return [];
  }
  const lo = clamp(clip.trimIn, 0, clip.keyframes.length - 1);
  const hi = clamp(clip.trimOut, lo, clip.keyframes.length - 1);
  return clip.keyframes.slice(lo, hi + 1);
}

/** Duration of the trimmed range, never below MIN_CLIP_DURATION. */
export function clipDuration(clip: Clip): number {
  const frames = trimmedKeyframes(clip);
  if (frames.length < 2) {
    return MIN_CLIP_DURATION;
  }
  const span = frames[frames.length - 1].t - frames[0].t;
  return Math.max(span, MIN_CLIP_DURATION);
}

export function setTrimIn(clip: Clip, index: number): Clip {
  if (clip.keyframes.length === 0) {
    return clip;
  }
  clip.trimIn = clamp(Math.round(index), 0, clip.trimOut);
  return clip;
}

export function setTrimOut(clip: Clip, index: number): Clip {
  if (clip.keyframes.length === 0) {
    return clip;
  }
  clip.trimOut = clamp(Math.round(index), clip.trimIn, clip.keyframes.length - 1);
  return clip;
}

export function resetTrim(clip: Clip): Clip {
  clip.trimIn = 0;
  clip.trimOut = Math.max(0, clip.keyframes.length - 1);
  return clip;
}

export function cloneClip(clip: Clip, newId: string): Clip {
  return {
    id: newId,
    name: clip.name,
    source: clip.source,
    keyframes: clip.keyframes.map(cloneKeyframe),
    trimIn: clip.trimIn,
    trimOut: clip.trimOut,
    caption: clip.caption,
    ease: clip.ease,
  };
}

export interface PoseDelta {
  /** Largest positional change of any joint, in scene units. */
  maxPosition: number;
  /** Largest rotational change of any joint, in radians. */
  maxAngle: number;
  /** Joint that moved most, by position. */
  jointId: string | null;
}

/** How far the puppet travelled between two poses. Drives SFX and onion skin. */
export function poseDelta(a: PoseSample, b: PoseSample): PoseDelta {
  let maxPosition = 0;
  let maxAngle = 0;
  let jointId: string | null = null;

  for (const id in a) {
    const from = a[id];
    const to = b[id];
    if (!to) {
      continue;
    }
    const dp = v3Distance(from.p, to.p);
    if (dp > maxPosition) {
      maxPosition = dp;
      jointId = id;
    }
    const da = qAngle(from.r, to.r);
    if (da > maxAngle) {
      maxAngle = da;
    }
  }
  return { maxPosition, maxAngle, jointId };
}

/**
 * Indices of keyframe transitions big enough to deserve a sound effect.
 * Returns the index of the *destination* keyframe of each notable transition.
 */
export function accentKeyframes(
  clip: Clip,
  positionThreshold: number,
  angleThreshold: number
): number[] {
  const frames = trimmedKeyframes(clip);
  const accents: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const delta = poseDelta(frames[i - 1].joints, frames[i].joints);
    if (delta.maxPosition >= positionThreshold || delta.maxAngle >= angleThreshold) {
      accents.push(i);
    }
  }
  return accents;
}
