import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";

/**
 * A world-space button built on SIK's Interactable.
 *
 * Wraps an existing SceneObject (a quad with a label) rather than generating
 * one, so button art stays authored in the editor. Supports both tap and
 * hold — "Record Performance" is a hold, everything else is a tap.
 */

export interface PanelButtonOptions {
  onPress?: () => void;
  onRelease?: () => void;
  /** Fires on release only if the press was shorter than the hold threshold. */
  onTap?: () => void;
  onHoverChanged?: (hovering: boolean) => void;
}

const HOLD_THRESHOLD_SECONDS = 0.35;

export class PanelButton {
  private interactable: Interactable;
  private label: Text | null;
  private pressedAt = 0;
  private pressed = false;

  constructor(private object: SceneObject, options: PanelButtonOptions) {
    const existing = object.getComponent(Interactable.getTypeName()) as Interactable | null;
    this.interactable = existing
      ? existing
      : (object.createComponent(Interactable.getTypeName()) as Interactable);

    this.label = findLabel(object);

    this.interactable.onTriggerStart.add(() => {
      this.pressed = true;
      this.pressedAt = getTime();
      if (options.onPress) {
        options.onPress();
      }
    });

    const release = () => {
      if (!this.pressed) {
        return;
      }
      this.pressed = false;
      const held = getTime() - this.pressedAt;
      if (options.onRelease) {
        options.onRelease();
      }
      if (options.onTap && held < HOLD_THRESHOLD_SECONDS) {
        options.onTap();
      }
    };
    this.interactable.onTriggerEnd.add(release);
    this.interactable.onTriggerCanceled.add(release);

    if (options.onHoverChanged) {
      const onHover = options.onHoverChanged;
      this.interactable.onHoverEnter.add(() => onHover(true));
      this.interactable.onHoverExit.add(() => onHover(false));
    }
  }

  setText(text: string): void {
    if (this.label) {
      this.label.text = text;
    }
  }

  setEnabled(enabled: boolean): void {
    this.object.enabled = enabled;
    this.interactable.enabled = enabled;
  }

  setVisible(visible: boolean): void {
    this.object.enabled = visible;
  }

  isPressed(): boolean {
    return this.pressed;
  }

  getSceneObject(): SceneObject {
    return this.object;
  }
}

/** First Text component on the object or any descendant. */
export function findLabel(object: SceneObject): Text | null {
  const own = object.getComponent("Component.Text") as Text | null;
  if (own) {
    return own;
  }
  const count = object.getChildrenCount();
  for (let i = 0; i < count; i++) {
    const found = findLabel(object.getChild(i));
    if (found) {
      return found;
    }
  }
  return null;
}
