/**
 * "Shooting on twos" — the thing that actually makes animation read as
 * stop-motion.
 *
 * Real stop-motion is shot on 2s: one photograph held for two film frames, so
 * the image updates 12 times a second against a 24fps projection. That slight
 * stutter is the entire visual signature of the medium. Smooth interpolation,
 * however nice, reads as CG.
 *
 * So playback quantizes its sample time to a film-frame grid before asking the
 * interpolator for a pose. Same keyframes, same tweens — the puppet just holds
 * each computed pose for N frames, exactly like a camera would.
 */

export type ShootMode = "smooth" | "ones" | "twos" | "threes";

export interface ShootRate {
  mode: ShootMode;
  /** Projection rate the steps are measured against. */
  fps: number;
}

/** Film frames each computed pose is held for. 0 means don't step at all. */
const HOLD_FRAMES: Record<ShootMode, number> = {
  smooth: 0,
  ones: 1,
  twos: 2,
  threes: 3,
};

export const SHOOT_MODES: ShootMode[] = ["twos", "threes", "ones", "smooth"];

/** 24fps is the cinema standard stop-motion is shot and judged against. */
export const FILM_FPS = 24;

export function createShootRate(mode: ShootMode = "twos", fps = FILM_FPS): ShootRate {
  return { mode, fps: fps > 0 ? fps : FILM_FPS };
}

export function holdFrames(rate: ShootRate): number {
  return HOLD_FRAMES[rate.mode];
}

/** Seconds each pose is held. 0 for smooth playback. */
export function holdSeconds(rate: ShootRate): number {
  const frames = holdFrames(rate);
  return frames === 0 ? 0 : frames / rate.fps;
}

/** Effective updates per second — 12 for twos at 24fps. */
export function effectiveFps(rate: ShootRate): number {
  const frames = holdFrames(rate);
  return frames === 0 ? rate.fps : rate.fps / frames;
}

/**
 * Quantize a clip-local time down to the frame it would have been photographed
 * on. Always floors: a pose is held until the next exposure, never anticipated.
 */
export function steppedTime(localT: number, rate: ShootRate): number {
  const hold = holdSeconds(rate);
  if (hold <= 0) {
    return localT;
  }
  if (localT <= 0) {
    return 0;
  }
  // Nudge before flooring so a time sitting exactly on a boundary (which float
  // maths reaches from just below) lands on that boundary rather than the
  // previous one.
  return Math.floor(localT / hold + 1e-9) * hold;
}

export function describeShootRate(rate: ShootRate): string {
  if (rate.mode === "smooth") {
    return "Smooth";
  }
  return `On ${rate.mode} · ${Math.round(effectiveFps(rate))}fps`;
}

export function nextShootMode(mode: ShootMode): ShootMode {
  const index = SHOOT_MODES.indexOf(mode);
  return SHOOT_MODES[(index + 1) % SHOOT_MODES.length];
}
