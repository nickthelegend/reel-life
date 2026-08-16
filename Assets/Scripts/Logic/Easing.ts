import { clamp01 } from "./Vec";

/**
 * Easing curves used by the playback interpolator.
 *
 * Stop-motion should not read as linear robot motion: real puppet animation has
 * settle and anticipation, so the default is a soft ease-in-out with a small
 * overshoot option for snappier "pop" transitions.
 */
export type EaseName = "linear" | "smooth" | "snap" | "settle";

export type EaseFn = (t: number) => number;

export const linear: EaseFn = (t) => clamp01(t);

/** Cubic ease-in-out. The default, closest to hand-keyed puppet motion. */
export const smooth: EaseFn = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Fast out, hard stop. Good for stop-motion "clack" transitions. */
export const snap: EaseFn = (t) => {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 4);
};

/** Ease-out with a single damped overshoot, so poses land and settle. */
export const settle: EaseFn = (t) => {
  const x = clamp01(t);
  if (x === 0 || x === 1) {
    return x;
  }
  const decay = Math.exp(-6 * x);
  return 1 - decay * Math.cos(9 * x);
};

const CURVES: Record<EaseName, EaseFn> = {
  linear,
  smooth,
  snap,
  settle,
};

export function easeByName(name: EaseName): EaseFn {
  return CURVES[name] || smooth;
}

export const EASE_NAMES: EaseName[] = ["linear", "smooth", "snap", "settle"];
