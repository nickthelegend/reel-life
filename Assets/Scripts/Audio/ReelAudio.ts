import { Log } from "../Core/Log";
import {
  SfxGate,
  TrackInfo,
  activeBpm,
  availableMoods,
  crossfadeProgress,
  stepVolume,
  targetVolume,
  trackForMood,
  volumeForStrength,
} from "../Logic/AudioDirector";
import { MoodTag } from "../Logic/MusicPrompt";
import { clamp01 } from "../Logic/Vec";
/**
 * Score and foley playback.
 *
 * Music is generated ahead of time with /build-music (Lyria) and imported as
 * audio assets, each tagged with the BPM it was rendered at. That BPM is what
 * the beat grid quantizes the performance to — so the puppet lands on the beat
 * of the actual track, rather than the app pretending it can retime audio at
 * runtime.
 *
 * Two music channels exist so switching mood crossfades instead of cutting.
 */
/** A music track plus the tempo it was rendered at. */
export type MusicTrack = TrackInfo<AudioTrackAsset>;
export interface SfxBank {
  [sfxId: string]: AudioComponent;
}
export class ReelAudio {
  private log = new Log("Audio");
  private channels: AudioComponent[];
  private activeChannel = 0;
  private targetVolume = 1;
  private musicVolume = 1;
  private fadeFrom = 0;
  private fadeStart = -1;
  private ducked = false;
  private sfxGate = new SfxGate();
  private currentTrack: MusicTrack | null = null;
  constructor(
    musicChannelA: AudioComponent,
    musicChannelB: AudioComponent,
    private sfx: SfxBank,
    private tracks: MusicTrack[]
  ) {
    this.channels = [musicChannelA, musicChannelB];
    for (const channel of this.channels) {
      channel.volume = 0;
    }
  }
  /** All moods that actually have a track imported. */
  availableMoods(): MoodTag[] {
    return availableMoods(this.tracks);
  }
  trackForMood(mood: MoodTag): MusicTrack | null {
    return trackForMood(this.tracks, mood);
  }
  activeTrack(): MusicTrack | null {
    return this.currentTrack;
  }
  /** Tempo the reel should be quantized to. */
  activeBpm(fallback: number): number {
    return activeBpm(this.currentTrack, fallback);
  }
  /**
   * Start (or crossfade to) the track for a mood. Returns the track so the
   * caller can rebuild the beat grid from its BPM.
   */
  playMood(mood: MoodTag, now: number): MusicTrack | null {
    const entry = this.trackForMood(mood);
    if (!entry) {
      this.log.warn(`no music imported for mood "${mood}" — run /build-music for it`);
      return null;
    }
    if (this.currentTrack && this.currentTrack.handle === entry.handle) {
      return this.currentTrack;
    }
    const next = (this.activeChannel + 1) % this.channels.length;
    const incoming = this.channels[next];
    incoming.audioTrack = entry.handle;
    incoming.volume = 0;
    incoming.play(-1);
    this.activeChannel = next;
    this.currentTrack = entry;
    this.fadeFrom = 0;
    this.fadeStart = now;
    this.targetVolume = targetVolume(this.musicVolume, this.ducked);
    this.log.info(`music: ${mood} at ${entry.bpm} BPM`);
    return entry;
  }
  stopMusic(): void {
    for (const channel of this.channels) {
      if (channel.isPlaying()) {
        channel.stop(true);
      }
      channel.volume = 0;
    }
    this.currentTrack = null;
    this.fadeStart = -1;
  }
  setMusicVolume(volume: number): void {
    this.musicVolume = clamp01(volume);
    this.targetVolume = targetVolume(this.musicVolume, this.ducked);
  }
  /** Called while the mic is open so speech recognition stays clean. */
  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.targetVolume = targetVolume(this.musicVolume, this.ducked);
  }
  /** Call every frame. Drives the crossfade and volume ramps. */
  update(now: number): void {
    const active = this.channels[this.activeChannel];
    if (this.fadeStart >= 0) {
      const t = crossfadeProgress(now, this.fadeStart);
      active.volume = this.fadeFrom + (this.targetVolume - this.fadeFrom) * t;
      for (let i = 0; i < this.channels.length; i++) {
        if (i === this.activeChannel) {
          continue;
        }
        const other = this.channels[i];
        other.volume = Math.max(0, other.volume * (1 - t));
        if (t >= 1 && other.isPlaying()) {
          other.stop(false);
        }
      }
      if (t >= 1) {
        this.fadeStart = -1;
      }
      return;
    }
    if (active.volume !== this.targetVolume) {
      active.volume = stepVolume(active.volume, this.targetVolume);
    }
  }
  /**
   * Fire a foley hit. `strength` (0..1) comes from how far the puppet moved on
   * that transition, so a big leap is louder than a small step.
   */
  triggerSfx(sfxId: string, strength: number, now: number): void {
    const component = this.sfx[sfxId];
    if (!component || !component.audioTrack) {
      return;
    }
    if (!this.sfxGate.request(sfxId, now)) {
      return;
    }
    component.volume = volumeForStrength(strength);
    component.play(1);
  }
  stopAll(): void {
    this.stopMusic();
    for (const id in this.sfx) {
      const component = this.sfx[id];
      if (component.isPlaying()) {
        component.stop(false);
      }
    }
  }
}
