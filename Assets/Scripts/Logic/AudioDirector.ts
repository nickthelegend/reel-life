import { MoodTag } from "./MusicPrompt";
import { clamp01 } from "./Vec";

/**
 * Every decision the audio layer makes, with no engine types involved.
 *
 * This used to live inside ReelAudio, which owns AudioComponents and therefore
 * cannot run outside Lens Studio — so the parts that are pure judgement (which
 * track for which mood, is this foley hit too soon, how loud should it be, how
 * far through a crossfade are we) could never be tested. They are the parts
 * most likely to be wrong.
 *
 * ReelAudio now owns only playback plumbing; everything below is decided here.
 */

/** A track that has been imported, tagged with the tempo it was rendered at. */
export interface TrackInfo<T = unknown> {
  mood: MoodTag;
  bpm: number;
  /** Whatever the host uses to play it: an AudioTrackAsset, a URL, a buffer. */
  handle: T;
}

export const CROSSFADE_SECONDS = 0.5;

/** Foley cooldown, so a fast performance cannot machine-gun one sound. */
export const SFX_COOLDOWN_SECONDS = 0.12;

/** Music level while the mic is live, so speech recognition stays clean. */
export const DUCKED_VOLUME = 0.15;

/** Per-frame volume step: immediate to the ear, slow enough not to click. */
export const VOLUME_STEP = 0.08;

// ---------------------------------------------------------------------------
// Track selection
// ---------------------------------------------------------------------------

/**
 * Reject entries the editor left half-filled rather than letting a track with
 * no tempo silently desynchronise every performance quantized against it.
 */
export function validateTracks<T>(
  candidates: Array<{ mood: string; bpm: number; handle: T }>
): { tracks: Array<TrackInfo<T>>; rejected: string[] } {
  const MOODS: string[] = ["whimsical", "epic", "spooky", "bouncy"];
  const tracks: Array<TrackInfo<T>> = [];
  const rejected: string[] = [];

  candidates.forEach((entry, index) => {
    if (MOODS.indexOf(entry.mood) < 0) {
      rejected.push(`track ${index}: unknown mood "${entry.mood}"`);
      return;
    }
    if (!isFinite(entry.bpm) || entry.bpm <= 0) {
      rejected.push(`track ${index} (${entry.mood}): bpm must be positive`);
      return;
    }
    if (entry.handle === null || entry.handle === undefined) {
      rejected.push(`track ${index} (${entry.mood}): no audio asset assigned`);
      return;
    }
    tracks.push({ mood: entry.mood as MoodTag, bpm: entry.bpm, handle: entry.handle });
  });

  return { tracks, rejected };
}

export function trackForMood<T>(tracks: Array<TrackInfo<T>>, mood: MoodTag): TrackInfo<T> | null {
  for (const track of tracks) {
    if (track.mood === mood) {
      return track;
    }
  }
  return null;
}

export function availableMoods<T>(tracks: Array<TrackInfo<T>>): MoodTag[] {
  const moods: MoodTag[] = [];
  for (const track of tracks) {
    if (moods.indexOf(track.mood) < 0) {
      moods.push(track.mood);
    }
  }
  return moods;
}

/** Tempo the reel should be quantized to: the playing track's, or a fallback. */
export function activeBpm<T>(track: TrackInfo<T> | null, fallback: number): number {
  return track ? track.bpm : fallback;
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** Foley volume from how far the puppet moved on that transition. */
export function volumeForStrength(strength: number): number {
  return 0.35 + 0.65 * clamp01(strength);
}

export function targetVolume(musicVolume: number, ducked: boolean): number {
  return ducked ? DUCKED_VOLUME : clamp01(musicVolume);
}

/** Progress through a crossfade, 0..1. */
export function crossfadeProgress(now: number, startedAt: number): number {
  if (startedAt < 0) {
    return 1;
  }
  return clamp01((now - startedAt) / CROSSFADE_SECONDS);
}

/** One frame of a volume ramp, stepping toward the target without overshoot. */
export function stepVolume(current: number, target: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= VOLUME_STEP) {
    return target;
  }
  return current + (delta > 0 ? VOLUME_STEP : -VOLUME_STEP);
}

// ---------------------------------------------------------------------------
// Foley gating
// ---------------------------------------------------------------------------

/**
 * Enforces the per-sound cooldown. Kept as an object rather than a free
 * function because the "when did this last play" state is exactly what makes
 * the rule testable.
 */
export class SfxGate {
  private lastPlayed: Record<string, number> = {};

  constructor(private cooldown: number = SFX_COOLDOWN_SECONDS) {}

  /** True if the sound may play now; records it when so. */
  request(sfxId: string, now: number): boolean {
    const last = this.lastPlayed[sfxId];
    if (last !== undefined && now - last < this.cooldown) {
      return false;
    }
    this.lastPlayed[sfxId] = now;
    return true;
  }

  /** Different sounds do not block each other. */
  lastPlayedAt(sfxId: string): number | null {
    const last = this.lastPlayed[sfxId];
    return last === undefined ? null : last;
  }

  reset(): void {
    this.lastPlayed = {};
  }
}
