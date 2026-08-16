/**
 * Vendored subset of the Spectacles Interaction Kit and Remote Service Gateway
 * package APIs, for offline typechecking only (see lens-studio.d.ts).
 *
 * The real definitions ship inside the .lspkg packages installed from the
 * Asset Library. Import paths below match the package folder names Lens Studio
 * creates:
 *   Assets/SpectaclesInteractionKit.lspkg/
 *   Assets/Remote Service Gateway.lspkg/
 *
 * If your installed package version exposes a different surface, fix it here
 * and the typecheck will point at every call site that needs updating.
 */

declare module "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable" {
  export interface InteractorEvent {
    interactor: any;
    target: SceneObject;
  }

  export class Interactable extends BaseScriptComponent {
    /** Lens Studio generates this on every decorated script component. */
    static getTypeName(): string;
    onHoverEnter: EventWrapper<InteractorEvent>;
    onHoverExit: EventWrapper<InteractorEvent>;
    onTriggerStart: EventWrapper<InteractorEvent>;
    onTriggerEnd: EventWrapper<InteractorEvent>;
    onTriggerCanceled: EventWrapper<InteractorEvent>;
    enableInstantDrag: boolean;
    isScrollable: boolean;
  }
}

declare module "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation" {
  export interface TransformEventArg {
    interactor: any;
    startTransform: mat4;
    currentTransform: mat4;
  }

  export class InteractableManipulation extends BaseScriptComponent {
    static getTypeName(): string;
    onManipulationStart: EventWrapper<TransformEventArg>;
    onManipulationUpdate: EventWrapper<TransformEventArg>;
    onManipulationEnd: EventWrapper<TransformEventArg>;

    enableTranslation: boolean;
    enableRotation: boolean;
    enableScale: boolean;
    /** Object actually moved by the manipulation; defaults to the owner. */
    setTargetObject(target: SceneObject): void;
    getTargetObject(): SceneObject;
    setCanTranslate(value: boolean): void;
    setCanRotate(value: boolean): void;
    setCanScale(value: boolean): void;
  }
}

declare module "SpectaclesInteractionKit.lspkg/Components/UI/ContainerFrame/ContainerFrame" {
  export class ContainerFrame extends BaseScriptComponent {
    innerSize: vec2;
    autoShowHide: boolean;
  }
}

declare module "SpectaclesInteractionKit.lspkg/SIK" {
  export const SIK: {
    HandInputData: any;
    InteractionManager: any;
    InteractionConfiguration: any;
  };
}

// ---------------------------------------------------------------------------
// Remote Service Gateway — Snap3D
// ---------------------------------------------------------------------------

declare module "Remote Service Gateway.lspkg/HostedSnap/Snap3D" {
  export namespace Snap3DTypes {
    /** Progressive stages a text-to-3D job reports as it runs. */
    type Stage = "image" | "base_mesh" | "refined_mesh" | "failed";

    interface SubmitRequest {
      prompt: string;
      format?: "glb" | "gltf";
      refine?: boolean;
      use_vertex_color?: boolean;
    }

    interface AssetPayload {
      gltfAsset?: GltfAsset;
      texture?: Texture;
      errorMsg?: string;
    }

    interface SubmitAndGetStatusResults {
      event: EventWrapper<[Stage, AssetPayload | string]>;
    }
  }

  export class Snap3D {
    static submitAndGetStatus(
      request: Snap3DTypes.SubmitRequest
    ): Promise<Snap3DTypes.SubmitAndGetStatusResults>;
  }
}

declare module "Remote Service Gateway.lspkg/RemoteServiceGatewayCredentials" {
  export class RemoteServiceGatewayCredentials extends BaseScriptComponent {
    apiToken: string;
  }
}
