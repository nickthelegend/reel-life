import { CaptionFade } from "../Logic/CaptionFade";

/**
 * Floating caption text pinned above the character.
 *
 * Shows only while the clip that owns it is playing, turns to face the viewer,
 * and fades in and out on a scale pop so a caption change is legible on a
 * screen recording rather than snapping between words.
 */

export class CaptionBillboard {
  private fade = new CaptionFade();

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
    this.fade.show(caption, now);
  }

  hide(now: number): void {
    this.fade.show(null, now);
  }

  /** Call every frame. */
  update(now: number): void {
    const frame = this.fade.update(now);

    this.root.enabled = frame.visible;
    if (!frame.visible) {
      return;
    }
    if (frame.text !== null && this.text.text !== frame.text) {
      this.text.text = frame.text;
    }

    const s = this.baseScale * Math.max(0.001, frame.scale);
    this.root.getTransform().setLocalScale(new vec3(s, s, s));
    this.faceViewer();
  }

  private faceViewer(): void {
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
