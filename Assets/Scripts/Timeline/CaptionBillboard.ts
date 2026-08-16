import { clamp01 } from "../Logic/Vec";

/**
 * Floating caption text pinned above the character.
 *
 * Shows only while the clip that owns it is playing, turns to face the viewer,
 * and fades in and out on a scale pop so a caption change is legible on a
 * screen recording rather than snapping between words.
 */

const FADE_SECONDS = 0.18;

export class CaptionBillboard {
  private current: string | null = null;
  private pending: string | null = null;
  private phase: "hidden" | "in" | "shown" | "out" = "hidden";
  private phaseStart = 0;

  constructor(
    private root: SceneObject,
    private text: Text,
    private cameraObject: SceneObject,
    private baseScale: number = 1
  ) {
    this.root.enabled = false;
  }

  /** Idempotent: setting the same caption twice does not re-trigger the fade. */
  show(caption: string | null, now: number): void {
    const value = caption && caption.trim().length > 0 ? caption : null;
    if (value === this.current && this.phase !== "out") {
      return;
    }
    if (value === null) {
      if (this.phase !== "hidden") {
        this.pending = null;
        this.beginPhase("out", now);
      }
      return;
    }
    if (this.phase === "hidden") {
      this.current = value;
      this.text.text = value;
      this.root.enabled = true;
      this.beginPhase("in", now);
    } else {
      this.pending = value;
      this.beginPhase("out", now);
    }
  }

  hide(now: number): void {
    this.show(null, now);
  }

  /** Call every frame. */
  update(now: number): void {
    this.faceViewer();

    const elapsed = now - this.phaseStart;
    const t = clamp01(elapsed / FADE_SECONDS);

    switch (this.phase) {
      case "in":
        this.setScale(easeOutBack(t));
        if (t >= 1) {
          this.phase = "shown";
        }
        break;
      case "out":
        this.setScale(1 - t);
        if (t >= 1) {
          this.phase = "hidden";
          this.root.enabled = false;
          this.current = null;
          if (this.pending) {
            this.show(this.pending, now);
            this.pending = null;
          }
        }
        break;
      case "shown":
      case "hidden":
        break;
    }
  }

  private beginPhase(phase: "in" | "out", now: number): void {
    this.phase = phase;
    this.phaseStart = now;
  }

  private setScale(factor: number): void {
    const s = this.baseScale * Math.max(0.001, factor);
    this.root.getTransform().setLocalScale(new vec3(s, s, s));
  }

  private faceViewer(): void {
    if (!this.root.enabled) {
      return;
    }
    const transform = this.root.getTransform();
    const toCamera = this.cameraObject
      .getTransform()
      .getWorldPosition()
      .sub(transform.getWorldPosition());
    if (toCamera.length < 0.001) {
      return;
    }
    transform.setWorldRotation(quat.lookAt(toCamera.uniformScale(-1), vec3.up()));
  }
}

/** Small overshoot so a caption lands with a bit of character. */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
