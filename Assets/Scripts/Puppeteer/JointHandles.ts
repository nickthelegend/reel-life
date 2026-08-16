import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation";

import { AssembledCharacter } from "../Character/CharacterAssembler";
import { Log } from "../Core/Log";
import { poseableJointIds } from "../Logic/RigPlan";

/**
 * Makes every joint of the puppet independently grabbable.
 *
 * A collider is created per joint (the generated meshes have none), then SIK's
 * Interactable and InteractableManipulation are attached at runtime. Rotation
 * and translation are on, scale is off — scaling a single limb turns a puppet
 * into a mess, and whole-character scale is handled separately on the root.
 */

export interface JointHandleCallbacks {
  onGrabStart: (jointId: string) => void;
  onGrabEnd: (jointId: string) => void;
  onHover: (jointId: string, hovering: boolean) => void;
}

/** Collider radius as a share of total character height. */
const HANDLE_RADIUS_RATIO = 0.09;
const MIN_HANDLE_RADIUS_CM = 1.2;

export class JointHandles {
  private log = new Log("Handles");
  private manipulators: InteractableManipulation[] = [];
  private enabledState = true;
  private grabbedJointId: string | null = null;

  constructor(
    private character: AssembledCharacter,
    private callbacks: JointHandleCallbacks
  ) {}

  build(): void {
    const plan = this.character.plan;
    const radius = Math.max(
      MIN_HANDLE_RADIUS_CM,
      plan.targetHeightCm * HANDLE_RADIUS_RATIO
    );

    for (const jointId of poseableJointIds(plan)) {
      const object = this.character.joints[jointId];
      if (!object) {
        this.log.warn(`no scene object for poseable joint "${jointId}"`);
        continue;
      }
      this.attachHandle(jointId, object, radius);
    }
    this.log.info(`${this.manipulators.length} joint handles ready`);
  }

  private attachHandle(jointId: string, object: SceneObject, radius: number): void {
    const collider = object.createComponent("Physics.ColliderComponent") as ColliderComponent;
    const shape = Shape.createSphereShape();
    shape.radius = radius;
    collider.shape = shape;
    // The generated meshes are children of the joint, so fitting to visuals
    // would grow the handle to the whole limb chain.
    collider.fitVisual = false;

    const interactable = object.createComponent(Interactable.getTypeName()) as Interactable;
    interactable.onHoverEnter.add(() => this.callbacks.onHover(jointId, true));
    interactable.onHoverExit.add(() => this.callbacks.onHover(jointId, false));

    const manipulation = object.createComponent(
      InteractableManipulation.getTypeName()
    ) as InteractableManipulation;
    manipulation.enableTranslation = true;
    manipulation.enableRotation = true;
    manipulation.enableScale = false;
    manipulation.setTargetObject(object);

    manipulation.onManipulationStart.add(() => {
      this.grabbedJointId = jointId;
      this.callbacks.onGrabStart(jointId);
    });
    manipulation.onManipulationEnd.add(() => {
      this.grabbedJointId = null;
      this.callbacks.onGrabEnd(jointId);
    });

    this.manipulators.push(manipulation);
  }

  /** Disabled during playback so the puppet cannot be grabbed mid-take. */
  setEnabled(enabled: boolean): void {
    if (this.enabledState === enabled) {
      return;
    }
    this.enabledState = enabled;
    for (const manipulation of this.manipulators) {
      manipulation.enabled = enabled;
    }
  }

  isEnabled(): boolean {
    return this.enabledState;
  }

  grabbedJoint(): string | null {
    return this.grabbedJointId;
  }
}
