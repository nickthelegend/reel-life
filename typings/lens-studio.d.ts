/**
 * Vendored subset of the Lens Studio runtime API.
 *
 * Lens Studio ships its own complete definitions and generates its own
 * tsconfig inside a project. These declarations exist ONLY so this repo can be
 * type-checked on a machine without Lens Studio installed
 * (`npm run typecheck`). They live outside `Assets/`, so the editor never sees
 * them and never uses them.
 *
 * Scope: exactly the API surface Reel Life touches. If you extend the Lens,
 * extend this file too — a missing declaration here is a typecheck failure,
 * not a runtime failure.
 */

// ---------------------------------------------------------------------------
// Decorators supplied by the Lens Studio TypeScript compiler
// ---------------------------------------------------------------------------

declare function component(target: any): any;
declare function input(target: any, propertyKey: string): void;
declare function allowUndefined(target: any, propertyKey: string): void;
declare function hint(text: string): (target: any, propertyKey: string) => void;
declare function label(text: string): (target: any, propertyKey: string) => void;
declare function typename(target: any): any;

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

declare class vec2 {
  constructor(x: number, y: number);
  x: number;
  y: number;
  static zero(): vec2;
}

declare class vec3 {
  constructor(x: number, y: number, z: number);
  x: number;
  y: number;
  z: number;
  add(other: vec3): vec3;
  sub(other: vec3): vec3;
  uniformScale(scale: number): vec3;
  scale(other: vec3): vec3;
  length: number;
  distance(other: vec3): number;
  normalize(): vec3;
  dot(other: vec3): number;
  cross(other: vec3): vec3;
  static zero(): vec3;
  static one(): vec3;
  static up(): vec3;
  static forward(): vec3;
  static right(): vec3;
}

declare class vec4 {
  constructor(x: number, y: number, z: number, w: number);
  x: number;
  y: number;
  z: number;
  w: number;
}

declare class quat {
  constructor(w: number, x: number, y: number, z: number);
  x: number;
  y: number;
  z: number;
  w: number;
  multiply(other: quat): quat;
  invert(): quat;
  normalize(): quat;
  toEulerAngles(): vec3;
  static quatIdentity(): quat;
  static angleAxis(radians: number, axis: vec3): quat;
  static fromEulerAngles(x: number, y: number, z: number): quat;
  static slerp(a: quat, b: quat, t: number): quat;
  static lookAt(forward: vec3, up: vec3): quat;
}

declare class mat4 {
  static identity(): mat4;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

declare class SceneEvent {
  bind(callback: (eventData?: any) => void): void;
  enabled: boolean;
}

declare class DelayedCallbackEvent extends SceneEvent {
  reset(delaySeconds: number): void;
  cancel(): void;
}

declare class EventWrapper<T = any> {
  add(callback: (args: T) => void): void;
  remove(callback: (args: T) => void): void;
}

// ---------------------------------------------------------------------------
// Scene graph
// ---------------------------------------------------------------------------

declare class Transform {
  getLocalPosition(): vec3;
  setLocalPosition(position: vec3): void;
  getLocalRotation(): quat;
  setLocalRotation(rotation: quat): void;
  getLocalScale(): vec3;
  setLocalScale(scale: vec3): void;
  getWorldPosition(): vec3;
  setWorldPosition(position: vec3): void;
  getWorldRotation(): quat;
  setWorldRotation(rotation: quat): void;
  getWorldScale(): vec3;
  forward: vec3;
  right: vec3;
  up: vec3;
}

declare class Component {
  enabled: boolean;
  getSceneObject(): SceneObject;
  getTransform(): Transform;
  destroy(): void;
}

declare class SceneObject {
  name: string;
  enabled: boolean;
  getTransform(): Transform;
  getParent(): SceneObject | null;
  setParent(parent: SceneObject): void;
  setParentPreserveWorldTransform(parent: SceneObject): void;
  getChild(index: number): SceneObject;
  getChildrenCount(): number;
  destroy(): void;
  createComponent(typeName: string): any;
  getComponent(typeName: string): any;
  getComponents(typeName: string): any[];
}

declare class ScriptComponent extends Component {}

declare class BaseScriptComponent extends ScriptComponent {
  sceneObject: SceneObject;
  createEvent(eventType: "DelayedCallbackEvent"): DelayedCallbackEvent;
  createEvent(
    eventType: "OnAwakeEvent" | "OnStartEvent" | "UpdateEvent" | "LateUpdateEvent" | "OnDestroyEvent" | "OnEnableEvent" | "OnDisableEvent"
  ): SceneEvent;
  removeEvent(event: SceneEvent): void;
}

// ---------------------------------------------------------------------------
// Assets and visual components
// ---------------------------------------------------------------------------

declare class Asset {
  name: string;
}

declare class Texture extends Asset {}

declare class Pass {
  baseColor: vec4;
  [key: string]: any;
}

declare class Material extends Asset {
  mainPass: Pass;
  clone(): Material;
}

declare class RenderMesh extends Asset {
  aabbMin: vec3;
  aabbMax: vec3;
}

declare class Shape {
  static createSphereShape(): SphereShape;
  static createBoxShape(): BoxShape;
}

declare class SphereShape extends Shape {
  radius: number;
}

declare class BoxShape extends Shape {
  size: vec3;
}

declare class Font extends Asset {}

declare class AudioTrackAsset extends Asset {}

declare class GltfAsset extends Asset {
  /** Instantiates the GLB under `parent`. Returns null if the asset failed. */
  tryInstantiate(parent: SceneObject, material: Material): SceneObject | null;
}

declare class MaterialMeshVisual extends Component {
  mainMaterial: Material;
  materials: Material[];
  meshShadowMode: number;
}

declare class RenderMeshVisual extends MaterialMeshVisual {
  mesh: RenderMesh;
}

declare class Text extends Component {
  text: string;
  size: number;
  font: Font;
  textFill: {
    color: vec4;
    [key: string]: any;
  };
  horizontalAlignment: number;
  verticalAlignment: number;
}

declare class AudioComponent extends Component {
  audioTrack: AudioTrackAsset;
  volume: number;
  /** loops = 1 plays once; -1 loops forever. */
  play(loops: number): void;
  stop(fadeOut: boolean): void;
  pause(): void;
  resume(): void;
  isPlaying(): boolean;
  duration: number;
  position: number;
}

declare class ColliderComponent extends Component {
  shape: Shape;
  fitVisual: boolean;
  debugDrawEnabled: boolean;
}

declare class Camera extends Component {
  screenSpaceToWorldSpace(point: vec2, depth: number): vec3;
  worldSpaceToScreenSpace(point: vec3): vec2;
  near: number;
  far: number;
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

declare class AsrModule extends Asset {
  startTranscribing(options: AsrModule.AsrTranscriptionOptions): void;
  stopTranscribing(): void;
}

declare namespace AsrModule {
  enum AsrMode {
    HighAccuracy,
    Balanced,
    HighSpeed,
  }

  interface AsrTranscriptionUpdateEvent {
    text: string;
    isFinal: boolean;
  }

  class AsrTranscriptionOptions {
    static create(): AsrTranscriptionOptions;
    mode: AsrMode;
    silenceUntilTerminationMs: number;
    onTranscriptionUpdateEvent: EventWrapper<AsrTranscriptionUpdateEvent>;
    onTranscriptionErrorEvent: EventWrapper<number>;
  }

  enum AsrStatusCode {
    InternalError,
    Unauthenticated,
    NoInternet,
  }
}

declare class HitTestSessionOptions {
  static create(): HitTestSessionOptions;
  /** Filters out unreliable/low-confidence hits. */
  filter: boolean;
}

declare class WorldQueryHitTestResult {
  position: vec3;
  normal: vec3;
}

declare class HitTestSession {
  start(): void;
  stop(): void;
  hitTest(
    rayStart: vec3,
    rayEnd: vec3,
    callback: (result: WorldQueryHitTestResult | null) => void
  ): void;
}

declare class WorldQueryModule extends Asset {
  createHitTestSessionWithOptions(options: HitTestSessionOptions): HitTestSession;
}

declare class GeneralDataStore {
  putString(key: string, value: string): void;
  getString(key: string): string;
  has(key: string): boolean;
  remove(key: string): void;
  clear(): void;
}

declare class PersistentStorageSystem {
  store: GeneralDataStore;
}

declare class Scene {
  createSceneObject(name: string): SceneObject;
  getRootObjectsCount(): number;
  getRootObject(index: number): SceneObject;
}

declare class DeviceInfoSystem {
  getTrackingCamera(): any;
}

declare const global: {
  scene: Scene;
  persistentStorageSystem: PersistentStorageSystem;
  deviceInfoSystem: DeviceInfoSystem;
  [key: string]: any;
};

/** Seconds since the Lens started. */
declare function getTime(): number;
declare function print(message: any): void;
declare function isNull(value: any): boolean;

declare module "LensStudio:WorldQueryModule" {
  const module: WorldQueryModule;
  export = module;
}

declare module "LensStudio:AsrModule" {
  const module: AsrModule;
  export = module;
}
