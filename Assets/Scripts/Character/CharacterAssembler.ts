import { toEngineVec } from "../Core/Convert";
import { Log } from "../Core/Log";
import { JointSpec, RigPlan, jointsInBuildOrder } from "../Logic/RigPlan";

/**
 * Turns a rig plan plus a bag of generated GLBs into a jointed puppet.
 *
 * Every joint is an empty SceneObject; meshes hang underneath them. Posing a
 * joint rotates the empty, which carries its mesh and every child joint with
 * it — the same way a real stop-motion armature works.
 */

export interface AssembledCharacter {
  root: SceneObject;
  /** Joint id -> the empty SceneObject that represents it. */
  joints: Record<string, SceneObject>;
  /** Joint id -> the instantiated mesh under that joint. */
  meshes: Record<string, SceneObject>;
  plan: RigPlan;
}

export class CharacterAssembler {
  private log = new Log("Assembler");

  constructor(private partMaterial: Material) {}

  assemble(
    plan: RigPlan,
    assets: Record<string, GltfAsset>,
    parent: SceneObject
  ): AssembledCharacter {
    const root = global.scene.createSceneObject("Character");
    root.setParent(parent);

    const joints: Record<string, SceneObject> = {};
    const meshes: Record<string, SceneObject> = {};

    for (const joint of jointsInBuildOrder(plan)) {
      joints[joint.id] = this.createJoint(joint, joints, root);
    }

    for (const part of plan.parts) {
      const asset = assets[part.jointId];
      if (!asset) {
        throw new Error(`CharacterAssembler: no mesh generated for "${part.jointId}"`);
      }
      const joint = joints[part.jointId];
      if (!joint) {
        throw new Error(`CharacterAssembler: rig has no joint "${part.jointId}"`);
      }

      const instance = asset.tryInstantiate(joint, this.partMaterial);
      if (!instance) {
        throw new Error(`CharacterAssembler: failed to instantiate "${part.jointId}"`);
      }
      instance.name = `mesh_${part.jointId}`;
      meshes[part.jointId] = instance;

      this.normalizePartScale(instance, part.heightFraction * plan.targetHeightCm, part.jointId);
    }

    this.log.info(
      `assembled ${plan.parts.length} parts across ${Object.keys(joints).length} joints`
    );
    return { root, joints, meshes, plan };
  }

  private createJoint(
    joint: JointSpec,
    joints: Record<string, SceneObject>,
    root: SceneObject
  ): SceneObject {
    if (joint.parent === null) {
      // The plan's root joint is the character root itself.
      root.name = `joint_${joint.id}`;
      return root;
    }
    const parent = joints[joint.parent];
    if (!parent) {
      throw new Error(`CharacterAssembler: joint "${joint.id}" has no parent object`);
    }
    const object = global.scene.createSceneObject(`joint_${joint.id}`);
    object.setParent(parent);
    object.getTransform().setLocalPosition(toEngineVec(joint.offset));
    object.getTransform().setLocalRotation(quat.quatIdentity());
    return object;
  }

  /**
   * Scale a generated mesh so it occupies its intended share of the character's
   * height. Snap3D returns meshes at arbitrary sizes, so without this a head
   * can arrive twice the size of the body it sits on.
   */
  private normalizePartScale(
    instance: SceneObject,
    targetHeightCm: number,
    jointId: string
  ): void {
    const height = measureHeight(instance);
    if (height <= 0) {
      this.log.warn(
        `part "${jointId}" has no measurable mesh bounds; leaving it at authored scale`
      );
      return;
    }
    const scale = targetHeightCm / height;
    instance.getTransform().setLocalScale(new vec3(scale, scale, scale));
  }
}

/** Largest mesh height anywhere under `object`, in local units. */
export function measureHeight(object: SceneObject): number {
  let tallest = 0;
  forEachMeshVisual(object, (visual) => {
    if (!visual.mesh) {
      return;
    }
    const height = visual.mesh.aabbMax.y - visual.mesh.aabbMin.y;
    if (height > tallest) {
      tallest = height;
    }
  });
  return tallest;
}

export function forEachMeshVisual(
  object: SceneObject,
  visit: (visual: RenderMeshVisual) => void
): void {
  const visuals = object.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[];
  for (const visual of visuals) {
    visit(visual);
  }
  const count = object.getChildrenCount();
  for (let i = 0; i < count; i++) {
    forEachMeshVisual(object.getChild(i), visit);
  }
}

/** Swap every material under an object, used by the onion-skin ghosts. */
export function applyMaterialRecursively(object: SceneObject, material: Material): void {
  forEachMeshVisual(object, (visual) => {
    visual.mainMaterial = material;
  });
}
