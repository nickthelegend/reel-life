import { AssembledCharacter } from "../Character/CharacterAssembler";
import { readJointPose } from "../Core/Convert";
import { Log } from "../Core/Log";
import {
  Clip,
  ClipSource,
  appendKeyframe,
  captureStopMotionPose,
  createClip,
} from "../Logic/Clip";
import { IdFactory } from "../Logic/Ids";
import { PoseSample } from "../Logic/PoseTypes";
import { poseableJointIds } from "../Logic/RigPlan";
import { PERFORMANCE_SAMPLE_HZ, SampleGate } from "../Logic/SampleGate";

/**
 * Captures what the user does to the puppet.
 *
 * Two modes, one buffer:
 *  - Capture Pose: deliberate stop-motion. Pose, tap, pose, tap.
 *  - Record Performance: hold the button and move the puppet; transforms are
 *    sampled on a fixed interval like a mocap take.
 */

export { PERFORMANCE_SAMPLE_HZ };

export class PoseRecorder {
  private log = new Log("Recorder");
  private jointIds: string[];
  private clip: Clip | null = null;
  private clipCounter = 1;
  private recording = false;
  private gate = new SampleGate(PERFORMANCE_SAMPLE_HZ);

  constructor(
    private character: AssembledCharacter,
    private ids: IdFactory
  ) {
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
    this.clip = createClip(this.ids.next("clip"), `Take ${index}`, source);
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
    this.gate.start(now);
    this.log.info(`recording performance into "${clip.name}"`);
    return clip;
  }

  /** Call every frame while a performance is being recorded. */
  update(now: number): void {
    if (!this.recording || !this.clip) {
      return;
    }
    const pose = this.currentPose();
    const decision = this.gate.offer(now, pose);
    if (decision.record) {
      appendKeyframe(this.clip, { t: decision.elapsed, joints: pose });
    }
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
