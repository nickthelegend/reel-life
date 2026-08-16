import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";

import { Log } from "../Core/Log";
import { Clip, clipDuration, setTrimIn, setTrimOut, trimmedKeyframes } from "../Logic/Clip";
import { ReelTimeline } from "../Logic/ReelTimeline";
import { clamp } from "../Logic/Vec";

/**
 * The in-AR reel editor: one chip per take, laid out left to right.
 *
 * Pinch-drag a chip sideways to reorder it. Pinch-drag the handles on a chip's
 * edges to trim leading or trailing poses off that take. Tap a chip to select
 * it; tap its caption tab to type a caption on the AR keyboard.
 *
 * Chips are built from a unit-plane mesh and authored materials, so the look
 * stays editable in Lens Studio while the layout stays driven by the data.
 */

export interface TimelinePanelConfig {
  /** World-space object the timeline is laid out under. */
  parent: SceneObject;
  chipMesh: RenderMesh;
  chipMaterial: Material;
  chipActiveMaterial: Material;
  handleMaterial: Material;
  playheadMaterial: Material;
  font: Font;
  chipWidthCm: number;
  chipHeightCm: number;
  gapCm: number;
}

export interface TimelinePanelCallbacks {
  onReorder: (clipId: string, newIndex: number) => void;
  onTrimChanged: (clipId: string) => void;
  onSelect: (clipId: string) => void;
  onRequestCaption: (clipId: string) => void;
}

interface ChipView {
  clipId: string;
  root: SceneObject;
  visual: RenderMeshVisual;
  label: Text;
  trimInHandle: SceneObject;
  trimOutHandle: SceneObject;
  index: number;
}

const LABEL_HEIGHT_RATIO = 0.28;
const HANDLE_WIDTH_CM = 1.2;
const CAPTION_TAB_HEIGHT_CM = 1.6;

export class TimelinePanel {
  private log = new Log("Timeline");
  private chips: ChipView[] = [];
  private playhead: SceneObject | null = null;
  private selectedClipId: string | null = null;
  private draggingClipId: string | null = null;

  constructor(
    private timeline: ReelTimeline,
    private config: TimelinePanelConfig,
    private callbacks: TimelinePanelCallbacks
  ) {}

  /** Rebuild every chip. Called when clips are added or removed. */
  rebuild(): void {
    this.clearChips();
    for (let i = 0; i < this.timeline.clips.length; i++) {
      this.chips.push(this.createChip(this.timeline.clips[i], i));
    }
    this.ensurePlayhead();
    this.layout();
    this.log.info(`timeline rebuilt with ${this.chips.length} chips`);
  }

  /** Update labels and highlight without recreating scene objects. */
  refresh(): void {
    for (const chip of this.chips) {
      const clip = this.timeline.get(chip.clipId);
      if (!clip) {
        continue;
      }
      chip.label.text = describeClip(clip);
      chip.visual.mainMaterial =
        clip.id === this.selectedClipId
          ? this.config.chipActiveMaterial
          : this.config.chipMaterial;
      this.positionTrimHandles(chip, clip);
    }
  }

  select(clipId: string | null): void {
    this.selectedClipId = clipId;
    this.refresh();
  }

  selectedClip(): string | null {
    return this.selectedClipId;
  }

  /** Move the playhead to a reel-global time. */
  setPlayhead(globalT: number): void {
    if (!this.playhead) {
      return;
    }
    const total = this.timeline.totalDuration();
    if (total <= 0) {
      this.playhead.enabled = false;
      return;
    }
    this.playhead.enabled = true;
    const span = this.trackWidth();
    const x = -span / 2 + (clamp(globalT, 0, total) / total) * span;
    this.playhead.getTransform().setLocalPosition(new vec3(x, 0, 0.2));
  }

  destroy(): void {
    this.clearChips();
    if (this.playhead) {
      this.playhead.destroy();
      this.playhead = null;
    }
  }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  private clearChips(): void {
    for (const chip of this.chips) {
      chip.root.destroy();
    }
    this.chips = [];
  }

  private createChip(clip: Clip, index: number): ChipView {
    // The chip root stays at unit scale: sizing happens on the face quad, so
    // labels and handles parented to the root are never stretched with it.
    const root = global.scene.createSceneObject(`chip_${clip.id}`);
    root.setParent(this.config.parent);

    const face = this.createChildQuad(
      root,
      `${clip.id}_face`,
      this.config.chipMaterial,
      this.config.chipWidthCm,
      this.config.chipHeightCm,
      new vec3(0, 0, 0)
    );

    const label = this.createLabel(root, describeClip(clip));

    const trimInHandle = this.createHandle(root, `${clip.id}_trimIn`, true);
    const trimOutHandle = this.createHandle(root, `${clip.id}_trimOut`, false);
    const captionTab = this.createCaptionTab(root, clip);

    const chip: ChipView = {
      clipId: clip.id,
      root,
      visual: face.visual,
      label,
      trimInHandle,
      trimOutHandle,
      index,
    };

    this.bindChipDrag(chip);
    this.bindTrimHandle(chip, trimInHandle, true);
    this.bindTrimHandle(chip, trimOutHandle, false);
    this.bindSelect(chip, captionTab);

    this.positionTrimHandles(chip, clip);
    return chip;
  }

  private createChildQuad(
    parent: SceneObject,
    name: string,
    material: Material,
    widthCm: number,
    heightCm: number,
    localPosition: vec3
  ): { object: SceneObject; visual: RenderMeshVisual } {
    const object = global.scene.createSceneObject(name);
    object.setParent(parent);
    const visual = object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = this.config.chipMesh;
    visual.mainMaterial = material;
    object.getTransform().setLocalPosition(localPosition);
    object.getTransform().setLocalScale(new vec3(widthCm, heightCm, 1));
    return { object, visual };
  }

  private createLabel(parent: SceneObject, text: string): Text {
    const object = global.scene.createSceneObject("label");
    object.setParent(parent);
    object.getTransform().setLocalPosition(new vec3(0, 0, 0.1));
    const component = object.createComponent("Component.Text") as Text;
    component.text = text;
    component.font = this.config.font;
    component.size = Math.max(12, Math.round(this.config.chipHeightCm * LABEL_HEIGHT_RATIO * 10));
    return component;
  }

  private createHandle(parent: SceneObject, name: string, isTrimIn: boolean): SceneObject {
    const half = this.config.chipWidthCm / 2;
    const x = isTrimIn ? -half : half;
    const handle = this.createChildQuad(
      parent,
      name,
      this.config.handleMaterial,
      HANDLE_WIDTH_CM,
      this.config.chipHeightCm,
      new vec3(x, 0, 0.15)
    ).object;
    this.addCollider(handle, HANDLE_WIDTH_CM, this.config.chipHeightCm);
    return handle;
  }

  private createCaptionTab(parent: SceneObject, clip: Clip): SceneObject {
    const tab = this.createChildQuad(
      parent,
      `${clip.id}_caption`,
      this.config.handleMaterial,
      this.config.chipWidthCm * 0.7,
      CAPTION_TAB_HEIGHT_CM,
      new vec3(0, -(this.config.chipHeightCm / 2 + CAPTION_TAB_HEIGHT_CM / 2 + 0.3), 0.1)
    ).object;
    this.addCollider(tab, this.config.chipWidthCm * 0.7, CAPTION_TAB_HEIGHT_CM);

    const labelObject = global.scene.createSceneObject("caption_label");
    labelObject.setParent(tab);
    labelObject.getTransform().setLocalPosition(new vec3(0, 0, 0.1));
    const label = labelObject.createComponent("Component.Text") as Text;
    label.font = this.config.font;
    label.size = 12;
    label.text = clip.caption ? clip.caption : "+ Caption";
    return tab;
  }

  private addCollider(object: SceneObject, widthCm: number, heightCm: number): void {
    const collider = object.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape = Shape.createBoxShape();
    shape.size = new vec3(widthCm, heightCm, 1);
    collider.shape = shape;
    collider.fitVisual = false;
  }

  private ensurePlayhead(): void {
    if (this.playhead) {
      return;
    }
    this.playhead = this.createChildQuad(
      this.config.parent,
      "playhead",
      this.config.playheadMaterial,
      0.4,
      this.config.chipHeightCm * 1.2,
      new vec3(0, 0, 0.2)
    ).object;
    this.playhead.enabled = false;
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  private slotWidth(): number {
    return this.config.chipWidthCm + this.config.gapCm;
  }

  private trackWidth(): number {
    return Math.max(1, this.chips.length) * this.slotWidth();
  }

  private slotX(index: number): number {
    const count = Math.max(1, this.chips.length);
    return (index - (count - 1) / 2) * this.slotWidth();
  }

  private layout(): void {
    for (let i = 0; i < this.chips.length; i++) {
      const chip = this.chips[i];
      chip.index = i;
      if (chip.clipId === this.draggingClipId) {
        continue;
      }
      chip.root.getTransform().setLocalPosition(new vec3(this.slotX(i), 0, 0));
    }
  }

  private bindChipDrag(chip: ChipView): void {
    this.addCollider(chip.root, this.config.chipWidthCm, this.config.chipHeightCm);

    const manipulation = chip.root.createComponent(
      InteractableManipulation.getTypeName()
    ) as InteractableManipulation;
    manipulation.enableTranslation = true;
    manipulation.enableRotation = false;
    manipulation.enableScale = false;
    manipulation.setTargetObject(chip.root);

    manipulation.onManipulationStart.add(() => {
      this.draggingClipId = chip.clipId;
      this.select(chip.clipId);
    });

    manipulation.onManipulationUpdate.add(() => {
      // Chips ride a rail: sideways only, so a drag can never pull a chip out
      // of the panel.
      const transform = chip.root.getTransform();
      const position = transform.getLocalPosition();
      transform.setLocalPosition(new vec3(position.x, 0, 0));

      const target = this.indexForX(position.x);
      if (target !== chip.index) {
        if (this.timeline.moveClipId(chip.clipId, target)) {
          this.reindex();
          this.callbacks.onReorder(chip.clipId, target);
        }
      }
    });

    manipulation.onManipulationEnd.add(() => {
      this.draggingClipId = null;
      this.layout();
    });
  }

  private indexForX(x: number): number {
    const count = Math.max(1, this.chips.length);
    const raw = x / this.slotWidth() + (count - 1) / 2;
    return clamp(Math.round(raw), 0, count - 1);
  }

  /** Re-sort the chip views to match the timeline's current clip order. */
  private reindex(): void {
    const ordered: ChipView[] = [];
    for (const clip of this.timeline.clips) {
      for (const chip of this.chips) {
        if (chip.clipId === clip.id) {
          ordered.push(chip);
          break;
        }
      }
    }
    this.chips = ordered;
    this.layout();
  }

  private bindTrimHandle(chip: ChipView, handle: SceneObject, isTrimIn: boolean): void {
    const manipulation = handle.createComponent(
      InteractableManipulation.getTypeName()
    ) as InteractableManipulation;
    manipulation.enableTranslation = true;
    manipulation.enableRotation = false;
    manipulation.enableScale = false;
    manipulation.setTargetObject(handle);

    manipulation.onManipulationUpdate.add(() => {
      const clip = this.timeline.get(chip.clipId);
      if (!clip || clip.keyframes.length < 2) {
        return;
      }
      const transform = handle.getTransform();
      const position = transform.getLocalPosition();
      // Handles slide along the chip's own edge only.
      transform.setLocalPosition(new vec3(position.x, 0, 0.15));

      const index = this.keyframeIndexForX(position.x, clip.keyframes.length);
      if (isTrimIn) {
        setTrimIn(clip, index);
      } else {
        setTrimOut(clip, index);
      }
      this.callbacks.onTrimChanged(clip.id);
      this.refresh();
    });

    manipulation.onManipulationEnd.add(() => {
      const clip = this.timeline.get(chip.clipId);
      if (clip) {
        this.positionTrimHandles(chip, clip);
      }
      this.layout();
    });
  }

  private keyframeIndexForX(x: number, keyframeCount: number): number {
    const half = this.config.chipWidthCm / 2;
    const u = clamp((x + half) / this.config.chipWidthCm, 0, 1);
    return Math.round(u * (keyframeCount - 1));
  }

  private positionTrimHandles(chip: ChipView, clip: Clip): void {
    const last = Math.max(1, clip.keyframes.length - 1);
    const half = this.config.chipWidthCm / 2;

    const inX = -half + (clip.trimIn / last) * this.config.chipWidthCm;
    const outX = -half + (clip.trimOut / last) * this.config.chipWidthCm;

    chip.trimInHandle.getTransform().setLocalPosition(new vec3(inX, 0, 0.15));
    chip.trimOutHandle.getTransform().setLocalPosition(new vec3(outX, 0, 0.15));
  }

  private bindSelect(chip: ChipView, captionTab: SceneObject): void {
    const chipInteractable = chip.root.createComponent(
      Interactable.getTypeName()
    ) as Interactable;
    chipInteractable.onTriggerEnd.add(() => {
      this.select(chip.clipId);
      this.callbacks.onSelect(chip.clipId);
    });

    const tabInteractable = captionTab.createComponent(
      Interactable.getTypeName()
    ) as Interactable;
    tabInteractable.onTriggerEnd.add(() => {
      this.select(chip.clipId);
      this.callbacks.onRequestCaption(chip.clipId);
    });
  }
}

/** "Take 2 · 1.6s · 5 poses" */
export function describeClip(clip: Clip): string {
  const frames = trimmedKeyframes(clip).length;
  const seconds = clipDuration(clip).toFixed(1);
  const trimmed = frames < clip.keyframes.length ? " ✂" : "";
  return `${clip.name} · ${seconds}s · ${frames} poses${trimmed}`;
}
