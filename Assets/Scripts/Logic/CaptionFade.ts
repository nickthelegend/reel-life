import { clamp01 } from "./Vec";

/**
 * The caption billboard's fade state machine.
 *
 * Deceptively fiddly: a caption change mid-fade has to queue behind the fade
 * out, an identical caption must not restart the animation, and clearing while
 * something is queued has to drop the queue rather than show it after. Getting
 * any of those wrong produces captions that flicker, stack, or show the
 * previous take's line — all of which are very visible on a demo recording.
 *
 * Extracted from CaptionBillboard, which also owns the SceneObject and Text
 * component and therefore could never be tested.
 */

export const FADE_SECONDS = 0.18;

export type FadePhase = "hidden" | "in" | "shown" | "out";

export interface FadeFrame {
  phase: FadePhase;
  /** Text to display, or null when nothing should be on screen. */
  text: string | null;
  /** Scale multiplier, 0..~1.1 (the pop overshoots slightly). */
  scale: number;
  visible: boolean;
}

/** Small overshoot so a caption lands with a bit of character. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export class CaptionFade {
  private phase: FadePhase = "hidden";
  private phaseStart = 0;
  private current: string | null = null;
  private pending: string | null = null;

  constructor(private fadeSeconds: number = FADE_SECONDS) {}

  /** Blank or whitespace-only captions count as "no caption". */
  private static normalize(caption: string | null): string | null {
    if (caption === null || caption === undefined) {
      return null;
    }
    const trimmed = caption.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Request a caption. Idempotent: asking for the caption already showing does
   * not restart the animation.
   */
  show(caption: string | null, now: number): void {
    const value = CaptionFade.normalize(caption);

    if (value === null) {
      this.pending = null;
      if (this.phase !== "hidden") {
        this.begin("out", now);
      }
      return;
    }

    if (value === this.current && this.phase !== "out") {
      return;
    }

    if (this.phase === "hidden") {
      this.current = value;
      this.begin("in", now);
    } else {
      // Something is on screen: queue behind the fade out.
      this.pending = value;
      if (this.phase !== "out") {
        this.begin("out", now);
      }
    }
  }

  /** Advance the machine. Call once per frame. */
  update(now: number): FadeFrame {
    const t = this.fadeSeconds <= 0 ? 1 : clamp01((now - this.phaseStart) / this.fadeSeconds);

    switch (this.phase) {
      case "in":
        if (t >= 1) {
          this.phase = "shown";
          return this.frame(1);
        }
        return this.frame(easeOutBack(t));

      case "out":
        if (t >= 1) {
          this.phase = "hidden";
          this.current = null;
          if (this.pending !== null) {
            this.current = this.pending;
            this.pending = null;
            this.begin("in", now);
            return this.frame(0);
          }
          return this.frame(0);
        }
        return this.frame(1 - t);

      case "shown":
        return this.frame(1);

      case "hidden":
      default:
        return this.frame(0);
    }
  }

  currentPhase(): FadePhase {
    return this.phase;
  }

  currentText(): string | null {
    return this.current;
  }

  pendingText(): string | null {
    return this.pending;
  }

  private begin(phase: FadePhase, now: number): void {
    this.phase = phase;
    this.phaseStart = now;
  }

  private frame(scale: number): FadeFrame {
    const visible = this.phase !== "hidden" && this.current !== null;
    return {
      phase: this.phase,
      text: visible ? this.current : null,
      scale: Math.max(0, scale),
      visible,
    };
  }
}
