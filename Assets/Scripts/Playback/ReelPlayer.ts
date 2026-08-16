import { AssembledCharacter } from "../Character/CharacterAssembler";
import { Log } from "../Core/Log";
import { AccentIndex, accentAtKeyframe, buildAccentIndex } from "../Logic/AccentTrack";
import { Clip } from "../Logic/Clip";
import { nearestKeyframeIndex, samplePose } from "../Logic/PoseInterpolator";
import { ReelTimeline } from "../Logic/ReelTimeline";
import { applyPoseTo } from "../Puppeteer/OnionSkin";

/**
 * Plays an edited reel back onto the real puppet.
 *
 * Everything the user sees during "Play Reel" comes from here: the interpolated
 * pose each frame, the caption for the current clip, and the foley accents on
 * the big transitions.
 */

export interface AccentEvent {
  sfxId: string;
  jointId: string | null;
  strength: number;
}

export interface ReelPlayerCallbacks {
  onClipChanged: (index: number, clip: Clip) => void;
  onCaption: (caption: string | null) => void;
  onAccent: (accent: AccentEvent) => void;
  onProgress: (elapsed: number, total: number) => void;
  onFinished: () => void;
}

export class ReelPlayer {
  private log = new Log("Player");
  private playing = false;
  private elapsed = 0;
  private lastUpdate = 0;
  private currentClipIndex = -1;
  private lastAccentKey = "";
  private accents: AccentIndex = {};

  constructor(
    private character: AssembledCharacter,
    private timeline: ReelTimeline,
    private callbacks: ReelPlayerCallbacks
  ) {}

  isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Swap the timeline being played. "Play Preview" points this at a
   * single-clip timeline; "Play Reel" points it back at the full edit.
   */
  setTimeline(timeline: ReelTimeline): void {
    this.stop();
    this.timeline = timeline;
  }

  currentTimeline(): ReelTimeline {
    return this.timeline;
  }

  elapsedSeconds(): number {
    return this.elapsed;
  }

  play(now: number, fromStart = true): void {
    if (this.timeline.isEmpty()) {
      this.log.warn("nothing to play — the timeline is empty");
      return;
    }
    this.accents = buildAccentIndex(this.timeline.clips);
    if (fromStart) {
      this.elapsed = 0;
      this.currentClipIndex = -1;
      this.lastAccentKey = "";
    }
    this.playing = true;
    this.lastUpdate = now;
    this.log.info(
      `playing ${this.timeline.clips.length} clips, ${this.timeline.totalDuration().toFixed(1)}s at ${this.timeline.playbackSpeed}x`
    );
  }

  pause(): void {
    this.playing = false;
  }

  stop(): void {
    this.playing = false;
    this.elapsed = 0;
    this.currentClipIndex = -1;
    this.callbacks.onCaption(null);
  }

  /** Scrub to an absolute reel time without starting playback. */
  seek(seconds: number): void {
    this.elapsed = Math.max(0, seconds);
    this.applyAt(this.elapsed, false);
  }

  /** Call every frame. `now` is getTime(). */
  update(now: number): void {
    if (!this.playing) {
      return;
    }
    const dt = Math.max(0, now - this.lastUpdate);
    this.lastUpdate = now;
    this.elapsed += dt * this.timeline.playbackSpeed;

    const total = this.timeline.totalDuration();
    if (!this.timeline.loop && this.elapsed >= total) {
      this.elapsed = total;
      this.applyAt(this.elapsed, true);
      this.playing = false;
      this.callbacks.onFinished();
      return;
    }
    this.applyAt(this.elapsed, true);
    this.callbacks.onProgress(this.elapsed, total);
  }

  private applyAt(globalT: number, allowAccents: boolean): void {
    const cursor = this.timeline.resolve(globalT);
    if (!cursor) {
      return;
    }

    const pose = samplePose(cursor.clip, cursor.localT);
    if (pose) {
      applyPoseTo(this.character, pose);
    }

    if (cursor.index !== this.currentClipIndex) {
      this.currentClipIndex = cursor.index;
      this.callbacks.onClipChanged(cursor.index, cursor.clip);
      this.callbacks.onCaption(cursor.clip.caption);
    }

    if (allowAccents) {
      this.fireAccents(cursor.clip, cursor.localT);
    }
  }

  /** Fires each accent once, when playback first reaches its keyframe. */
  private fireAccents(clip: Clip, localT: number): void {
    const index = nearestKeyframeIndex(clip, localT);
    const key = `${clip.id}:${index}`;
    if (key === this.lastAccentKey) {
      return;
    }
    this.lastAccentKey = key;

    const mark = accentAtKeyframe(this.accents[clip.id], index);
    if (mark) {
      this.callbacks.onAccent({
        sfxId: mark.sfxId,
        jointId: mark.jointId,
        strength: mark.strength,
      });
    }
  }
}
