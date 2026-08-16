import { Log } from "../Core/Log";
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

export interface MusicTrack {
  mood: MoodTag;
  track: AudioTrackAsset;
  /** Tempo the track was generated at. Drives the beat grid. */
  bpm: number;
}

export interface SfxBank {
  [sfxId: string]: AudioComponent;
}

const CROSSFADE_SECONDS = 0.5;

/** Foley cooldown, so a fast performance does not machine-gun one sound. */
const SFX_COOLDOWN_SECONDS = 0.12;

/** Music drops to this while the mic is live, so ASR is not fighting the score. */
const DUCKED_VOLUME = 0.15;

export class ReelAudio {
  private log = new Log("Audio");
  private channels: AudioComponent[];
  private activeChannel = 0;
  private targetVolume = 1;
  private musicVolume = 1;
  private fadeFrom = 0;
  private fadeStart = -1;
  private ducked = false;
  private lastSfxAt: Record<string, number> = {};
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
    const moods: MoodTag[] = [];
    for (const entry of this.tracks) {
      if (moods.indexOf(entry.mood) === -1) {
        moods.push(entry.mood);
      }
    }
    return moods;
  }

  trackForMood(mood: MoodTag): MusicTrack | null {
    for (const entry of this.tracks) {
      if (entry.mood === mood) {
        return entry;
      }
    }
    return null;
  }

  activeTrack(): MusicTrack | null {
    return this.currentTrack;
  }

  /** Tempo the reel should be quantized to. */
  activeBpm(fallback: number): number {
    return this.currentTrack ? this.currentTrack.bpm : fallback;
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
    if (this.currentTrack && this.currentTrack.track === entry.track) {
      return this.currentTrack;
    }

    const next = (this.activeChannel + 1) % this.channels.length;
    const incoming = this.channels[next];
    incoming.audioTrack = entry.track;
    incoming.volume = 0;
    incoming.play(-1);

    this.activeChannel = next;
    this.currentTrack = entry;
    this.fadeFrom = 0;
    this.fadeStart = now;
    this.targetVolume = this.ducked ? DUCKED_VOLUME : this.musicVolume;

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
    if (!this.ducked) {
      this.targetVolume = this.musicVolume;
    }
  }

  /** Called while the mic is open so speech recognition stays clean. */
  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.targetVolume = ducked ? DUCKED_VOLUME : this.musicVolume;
  }

  /** Call every frame. Drives the crossfade and volume ramps. */
  update(now: number): void {
    const active = this.channels[this.activeChannel];

    if (this.fadeStart >= 0) {
      const t = clamp01((now - this.fadeStart) / CROSSFADE_SECONDS);
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

    if (Math.abs(active.volume - this.targetVolume) > 0.001) {
      // Small per-frame step: fast enough to feel immediate, slow enough not
      // to click.
      const step = 0.08;
      const delta = this.targetVolume - active.volume;
      active.volume += Math.abs(delta) < step ? delta : Math.sign(delta) * step;
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
    const last = this.lastSfxAt[sfxId];
    if (last !== undefined && now - last < SFX_COOLDOWN_SECONDS) {
      return;
    }
    this.lastSfxAt[sfxId] = now;
    component.volume = 0.35 + 0.65 * clamp01(strength);
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
