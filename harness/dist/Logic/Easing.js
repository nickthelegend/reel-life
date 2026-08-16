import { clamp01 } from "./Vec.js";
export const linear = (t) => clamp01(t);
/** Cubic ease-in-out. The default, closest to hand-keyed puppet motion. */
export const smooth = (t) => {
    const x = clamp01(t);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** Fast out, hard stop. Good for stop-motion "clack" transitions. */
export const snap = (t) => {
    const x = clamp01(t);
    return 1 - Math.pow(1 - x, 4);
};
/** Ease-out with a single damped overshoot, so poses land and settle. */
export const settle = (t) => {
    const x = clamp01(t);
    if (x === 0 || x === 1) {
        return x;
    }
    const decay = Math.exp(-6 * x);
    return 1 - decay * Math.cos(9 * x);
};
const CURVES = {
    linear,
    smooth,
    snap,
    settle,
};
export function easeByName(name) {
    return CURVES[name] || smooth;
}
export const EASE_NAMES = ["linear", "smooth", "snap", "settle"];
