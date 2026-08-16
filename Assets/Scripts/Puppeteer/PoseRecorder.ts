import { AssembledCharacter } from "../Character/CharacterAssembler";
import { newId } from "../Character/ReelStore";
import { readJointPose } from "../Core/Convert";
import { Log } from "../Core/Log";
import {
  Clip,
  ClipSource,
  appendKeyframe,
  captureStopMotionPose,
  createClip,
  poseDelta,
} from "../Logic/Clip";
import { PoseSample } from "../Logic/PoseTypes";
import { poseableJointIds } from "../Logic/RigPlan";

/**
 * Captures what the user does to the puppet.
 *
 * Two modes, one buffer:
 *  - Capture Pose: deliberate stop-motion. Pose, tap, pose, tap.
 *  - Record Performance: hold the button and move the puppet; transforms are
 *    sampled on a fixed interval like a mocap take.
 */

/** Live sampling rate. Fast enough to catch a gesture, slow enough to stay light. */
export const PERFORMANCE_SAMPLE_HZ = 12;

/** Samples this similar to the previous one are dropped. */
const IDLE_POSITION_EPSILON_CM = 0.2;
const IDLE_ANGLE_EPSILON_RAD = 0.01;

/** ...but never leave a gap longer than this, so held poses still read. */
const MAX_SAMPLE_GAP_SECONDS = 1;

export class PoseRecorder {
  private log = new Log("Recorder");
  private jointIds: string[];
  private clip: Clip | null = null;
  private clipCounter = 1;
  private recording = false;
  private performanceStart = 0;
  private lastSampleTime = 0;
  private lastSampledPose: PoseSample | null = null;

  constructor(private character: AssembledCharacter) {
    this.jointIds = poseableJointIds(character.plan);
  }

  /** Read every poseable joint's local transform right now. */
  currentPose(): PoseSample {
    const pose: PoseSample = {};
    for (const jointId of this.jointIds) {
      const object = this.character.joints[jointId];
      if (object) {
        pose[jointId] = readJointPose(object.getTransform());
      }
    }
    return pose;
  }

  activeClip(): Clip | null {
    return this.clip;
  }

  isRecording(): boolean {
    return this.recording;
  }

  private ensureClip(source: ClipSource): Clip {
    if (this.clip && this.clip.source === source) {
      return this.clip;
    }
    // Switching modes starts a new take rather than mixing cadences.
    const index = this.clipCounter++;
    this.clip = createClip(newId("clip"), `Take ${index}`, source);
    this.log.info(`started ${source} clip "${this.clip.name}"`);
    return this.clip;
  }

  // -------------------------------------------------------------------------
  // Stop motion
  // -------------------------------------------------------------------------

  capturePose(): Clip {
    const clip = this.ensureClip("stopmotion");
    captureStopMotionPose(clip, this.currentPose());
    this.log.info(`captured pose ${clip.keyframes.length} of "${clip.name}"`);
    return clip;
  }

  /** Drop the most recent captured pose. Undo for a mis-tap. */
  undoLastPose(): boolean {
    if (!this.clip || this.clip.keyframes.length === 0) {
      return false;
    }
    this.clip.keyframes.pop();
    this.clip.trimOut = Math.max(0, this.clip.keyframes.length - 1);
    this.clip.trimIn = Math.min(this.clip.trimIn, this.clip.trimOut);
    return true;
  }

  // -------------------------------------------------------------------------
  // Live performance
  // -------------------------------------------------------------------------

  startPerformance(now: number): Clip {
    const clip = this.ensureClip("performance");
    this.recording = true;
    this.performanceStart = now;
    this.lastSampleTime = -Infinity;
    this.lastSampledPose = null;
    this.log.info(`recording performance into "${clip.name}"`);
    return clip;
  }

  /** Call every frame while a performance is being recorded. */
  update(now: number): void {
    if (!this.recording || !this.clip) {
      return;
    }
    const interval = 1 / PERFORMANCE_SAMPLE_HZ;
    if (now - this.lastSampleTime < interval) {
      return;
    }

    const pose = this.currentPose();
    const elapsed = now - this.performanceStart;

    if (this.lastSampledPose) {
      const delta = poseDelta(this.lastSampledPose, pose);
      const stillEnough =
        delta.maxPosition < IDLE_POSITION_EPSILON_CM &&
        delta.maxAngle < IDLE_ANGLE_EPSILON_RAD;
      const gap = now - this.lastSampleTime;
      if (stillEnough && gap < MAX_SAMPLE_GAP_SECONDS) {
        // Nothing moved; skip the sample rather than storing a duplicate.
        return;
      }
    }

    appendKeyframe(this.clip, { t: elapsed, joints: pose });
    this.lastSampleTime = now;
    this.lastSampledPose = pose;
  }

  stopPerformance(): Clip | null {
    if (!this.recording) {
      return null;
    }
    this.recording = false;
    const clip = this.clip;
    if (clip) {
      this.log.info(`performance captured ${clip.keyframes.length} samples`);
    }
    return clip;
  }

  // -------------------------------------------------------------------------

  /** Close the current take and hand it to the timeline. */
  finishClip(): Clip | null {
    if (this.recording) {
      this.stopPerformance();
    }
    const clip = this.clip;
    this.clip = null;
    this.lastSampledPose = null;
    if (!clip || clip.keyframes.length === 0) {
      return null;
    }
    return clip;
  }

  /** Poses to ghost behind the puppet, most recent first. */
  recentPoses(count: number): PoseSample[] {
    if (!this.clip) {
      return [];
    }
    const out: PoseSample[] = [];
    for (let i = this.clip.keyframes.length - 1; i >= 0 && out.length < count; i--) {
      out.push(this.clip.keyframes[i].joints);
    }
    return out;
  }
}
