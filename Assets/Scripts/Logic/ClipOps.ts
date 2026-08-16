import { BeatGrid, beatSeconds } from "./BeatGrid";
import { Clip, cloneClip, resetTrim, trimmedKeyframes } from "./Clip";
import { cloneKeyframe, clonePose } from "./PoseTypes";
import { v3Add, v3Scale, v3Sub } from "./Vec";

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
export function splitClip(
  clip: Clip,
  atIndex: number,
  idA: string,
  idB: string
): [Clip, Clip] | null {
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
export function mergeClips(a: Clip, b: Clip, newId: string, gapSeconds = 0.4): Clip | null {
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
export function reverseClip(clip: Clip, newId: string): Clip {
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
export function pingPongClip(clip: Clip, newId: string): Clip | null {
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
export function loopBlendClip(clip: Clip, newId: string, returnSeconds = 0.4): Clip | null {
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

export function isLoopClosed(clip: Clip): boolean {
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
    if (
      Math.abs(a.p.x - b.p.x) > 1e-6 ||
      Math.abs(a.p.y - b.p.y) > 1e-6 ||
      Math.abs(a.p.z - b.p.z) > 1e-6
    ) {
      return false;
    }
  }
  return true;
}

/** Speed a take up or slow it down without touching its poses. */
export function retimeClip(clip: Clip, newId: string, factor: number): Clip | null {
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
export function holdLastPose(clip: Clip, seconds: number): Clip {
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
function rebaseToZero(clip: Clip): void {
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

export function isOverlong(clip: Clip): boolean {
  const frames = trimmedKeyframes(clip);
  if (frames.length < 2) {
    return false;
  }
  return frames[frames.length - 1].t - frames[0].t > MAX_CLIP_SECONDS;
}

// ---------------------------------------------------------------------------
// Beat-aware editing
// ---------------------------------------------------------------------------

/**
 * Split a take at every bar line.
 *
 * The reel is already locked to a tempo; this makes editing obey it too. A long
 * take becomes a sequence of bar-length takes you can reorder, and every cut
 * lands on a downbeat instead of wherever the trim handle happened to be.
 */
export function cutToBeat(
  clip: Clip,
  grid: BeatGrid,
  makeId: (index: number) => string,
  beatsPerBar = 4
): Clip[] {
  const frames = trimmedKeyframes(clip);
  const bar = beatSeconds(grid) * beatsPerBar;

  if (frames.length < 2 || bar <= 0) {
    return [cloneClip(clip, makeId(0))];
  }

  const start = frames[0].t;
  const duration = frames[frames.length - 1].t - start;
  if (duration <= bar) {
    return [cloneClip(clip, makeId(0))];
  }

  const pieces: Clip[] = [];
  const barCount = Math.ceil(duration / bar - 1e-9);

  for (let b = 0; b < barCount; b++) {
    const from = b * bar;
    const to = Math.min((b + 1) * bar, duration);

    // Every keyframe inside the bar, plus the one before it so the piece does
    // not start mid-move.
    const inside = frames.filter((f) => {
      const local = f.t - start;
      return local >= from - 1e-9 && local <= to + 1e-9;
    });
    if (inside.length === 0) {
      continue;
    }

    const piece = cloneClip(clip, makeId(pieces.length));
    piece.name = `${clip.name} bar ${b + 1}`;
    piece.caption = b === 0 ? clip.caption : null;
    piece.keyframes = inside.map((f) => ({
      t: Number((f.t - start - from).toFixed(6)),
      joints: clonePose(f.joints),
    }));

    // A single-pose bar is a held frame, not a take worth cutting to.
    if (piece.keyframes.length < 2) {
      continue;
    }
    resetTrim(piece);
    pieces.push(piece);
  }

  return pieces.length > 0 ? pieces : [cloneClip(clip, makeId(0))];
}

/**
 * Turn a held pose into a moving hold.
 *
 * A pose held perfectly still reads as the app having frozen. Real animation
 * keeps a tiny drift going so the character stays alive. This inserts a
 * midpoint that eases slightly past the held pose and back.
 *
 * @param driftCm how far the drift travels, in cm
 */
export function addMovingHold(
  clip: Clip,
  keyframeIndex: number,
  newId: string,
  driftCm = 0.4
): Clip | null {
  const out = cloneClip(clip, newId);
  const a = out.keyframes[keyframeIndex];
  const b = out.keyframes[keyframeIndex + 1];

  if (!a || !b || driftCm <= 0) {
    return null;
  }

  const gap = b.t - a.t;
  if (gap <= 0.02) {
    return null;
  }

  const joints = clonePose(a.joints);
  for (const jointId in joints) {
    const from = a.joints[jointId];
    const to = b.joints[jointId];
    if (!from || !to) {
      continue;
    }
    // Drift a fixed distance along the direction the pose is already heading,
    // so the hold breathes toward its next pose rather than wandering.
    const direction = v3Sub(to.p, from.p);
    const length = Math.sqrt(
      direction.x * direction.x + direction.y * direction.y + direction.z * direction.z
    );
    if (length < 1e-6) {
      continue;
    }
    joints[jointId].p = v3Add(from.p, v3Scale(direction, driftCm / length));
  }

  out.keyframes.splice(keyframeIndex + 1, 0, {
    t: Number((a.t + gap * 0.5).toFixed(6)),
    joints,
  });
  resetTrim(out);
  return out;
}

/** Keyframe gaps long enough that a dead hold will be visible. */
export const LONG_HOLD_SECONDS = 0.8;

export function longHolds(clip: Clip): number[] {
  const frames = trimmedKeyframes(clip);
  const out: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].t - frames[i - 1].t >= LONG_HOLD_SECONDS) {
      out.push(i - 1);
    }
  }
  return out;
}
