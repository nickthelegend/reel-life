import { AssembledCharacter, CharacterAssembler } from "../Character/CharacterAssembler";
import { applyJointPose } from "../Core/Convert";
import { Log } from "../Core/Log";
import { PoseSample } from "../Logic/PoseTypes";
import { RigPlan } from "../Logic/RigPlan";

/**
 * Onion skinning — translucent ghosts of the poses you already captured,
 * standing where you left them.
 *
 * This is the tool real stop-motion animators work with, and it is the thing
 * that makes posing in AR feel like animating rather than fiddling: you can see
 * the arc you are building instead of holding it in your head. Ghosts are built
 * once from the same GLBs as the puppet, then re-posed — no per-frame
 * instantiation.
 */

export class OnionSkin {
  private log = new Log("OnionSkin");
  private ghosts: AssembledCharacter[] = [];
  private visible = false;
  /** How many ghost layers currently hold a real pose. */
  private posedLayers = 0;

  /**
   * @param materials one translucent material per ghost layer, most recent
   *        first. Two layers is the sweet spot: more is visual noise.
   */
  constructor(
    private plan: RigPlan,
    private assets: Record<string, GltfAsset>,
    private parent: SceneObject,
    private materials: Material[]
  ) {}

  build(): void {
    if (this.ghosts.length > 0) {
      return;
    }
    for (let layer = 0; layer < this.materials.length; layer++) {
      const assembler = new CharacterAssembler(this.materials[layer]);
      const ghost = assembler.assemble(this.plan, this.assets, this.parent);
      ghost.root.name = `OnionGhost_${layer}`;
      ghost.root.enabled = false;
      this.ghosts.push(ghost);
    }
    this.log.info(`${this.ghosts.length} ghost layers ready`);
  }

  layerCount(): number {
    return this.ghosts.length;
  }

  /**
   * Show one ghost per pose, most recent first. Fewer poses than layers simply
   * hides the unused layers.
   */
  showPoses(poses: PoseSample[]): void {
    this.posedLayers = 0;
    for (let layer = 0; layer < this.ghosts.length; layer++) {
      const pose = poses[layer];
      if (!pose) {
        continue;
      }
      applyPoseTo(this.ghosts[layer], pose);
      this.posedLayers = layer + 1;
    }
    this.refresh();
  }

  /** Ghosts follow the puppet's anchor so they stay registered with the world. */
  alignTo(character: AssembledCharacter): void {
    const source = character.root.getTransform();
    for (const ghost of this.ghosts) {
      const transform = ghost.root.getTransform();
      transform.setWorldPosition(source.getWorldPosition());
      transform.setWorldRotation(source.getWorldRotation());
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.refresh();
  }

  /** A ghost is on only if onion skinning is on AND it has a pose to show. */
  private refresh(): void {
    for (let layer = 0; layer < this.ghosts.length; layer++) {
      this.ghosts[layer].root.enabled = this.visible && layer < this.posedLayers;
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    for (const ghost of this.ghosts) {
      ghost.root.destroy();
    }
    this.ghosts = [];
  }
}

/** Drive every joint of an assembled character from a pose. */
export function applyPoseTo(character: AssembledCharacter, pose: PoseSample): void {
  for (const jointId in pose) {
    const object = character.joints[jointId];
    if (object) {
      applyJointPose(object.getTransform(), pose[jointId]);
    }
  }
}
