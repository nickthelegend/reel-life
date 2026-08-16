import { Vec3, v3Distance } from "./Vec";

/**
 * The point-pause-confirm rule for dropping a character on a real surface.
 *
 * World Query's depth data refreshes at roughly 5Hz, so placement cannot chase
 * a moving hand. Instead the hit point has to hold still inside a small radius
 * for a moment before it counts as chosen. That rule is pure decision-making
 * and used to be buried inside SurfacePlacer alongside the ray-casting, where
 * it could never be tested — even though it is the part that decides whether
 * the interaction feels solid or twitchy.
 */

/** How still the hit point must be, in cm. */
export const STABLE_RADIUS_CM = 4;

/** How long it must stay that still. */
export const STABLE_HOLD_SECONDS = 0.5;

/** Seconds between ray-casts. Matches the depth refresh rate. */
export const HIT_TEST_INTERVAL = 0.2;

/** How far the reticle eases toward each new reading, per frame. */
export const RETICLE_EASE = 0.25;

export type PlacementState = "searching" | "settling" | "ready";

export interface StabilityResult {
  state: PlacementState;
  /** 0..1 — how far through the hold, for a progress ring. */
  progress: number;
  /** Message for the status line. */
  message: string;
}

/**
 * Tracks whether the user has held still long enough on a surface.
 *
 * Fed one reading per ray-cast. A reading of `null` means no surface was found,
 * which resets the hold — a character dropped into a hole in the depth map is
 * worse than asking the user to look again.
 */
export class PlacementStability {
  private lastHit: Vec3 | null = null;
  private steadySince = -1;
  private state: PlacementState = "searching";

  constructor(
    private radiusCm: number = STABLE_RADIUS_CM,
    private holdSeconds: number = STABLE_HOLD_SECONDS
  ) {}

  reset(): void {
    this.lastHit = null;
    this.steadySince = -1;
    this.state = "searching";
  }

  /** Feed one hit-test reading. `position` is null when nothing was hit. */
  offer(now: number, position: Vec3 | null): StabilityResult {
    if (!position) {
      this.lastHit = null;
      this.steadySince = -1;
      this.state = "searching";
      return {
        state: "searching",
        progress: 0,
        message: "No surface found — try a table or the floor",
      };
    }

    const moved = this.lastHit === null ? Infinity : v3Distance(this.lastHit, position);
    this.lastHit = position;

    if (moved > this.radiusCm) {
      // Jumped somewhere new: start the hold again from here.
      this.steadySince = now;
      this.state = "settling";
      return { state: "settling", progress: 0, message: "Hold still to place" };
    }

    if (this.steadySince < 0) {
      this.steadySince = now;
    }

    const held = now - this.steadySince;
    if (held >= this.holdSeconds) {
      this.state = "ready";
      return { state: "ready", progress: 1, message: "Pinch to drop your character here" };
    }

    this.state = "settling";
    return {
      state: "settling",
      progress: Math.max(0, Math.min(1, held / this.holdSeconds)),
      message: "Hold still to place",
    };
  }

  isReady(): boolean {
    return this.state === "ready";
  }

  currentState(): PlacementState {
    return this.state;
  }

  /** The confirmed point, or null if the user has not settled on one. */
  confirm(): Vec3 | null {
    return this.state === "ready" ? this.lastHit : null;
  }

  /** Whether enough time has passed to cast the next ray. */
  static shouldCast(now: number, lastCastAt: number): boolean {
    return now - lastCastAt >= HIT_TEST_INTERVAL;
  }
}

/**
 * Ease the reticle toward a new reading instead of snapping.
 * Smoothing hides the 5Hz stepping without pretending to track faster.
 */
export function easeToward(current: Vec3, target: Vec3, factor: number = RETICLE_EASE): Vec3 {
  return {
    x: current.x + (target.x - current.x) * factor,
    y: current.y + (target.y - current.y) * factor,
    z: current.z + (target.z - current.z) * factor,
  };
}
