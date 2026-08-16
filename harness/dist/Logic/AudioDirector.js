import { clamp01 } from "./Vec.js";
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
export function validateTracks(candidates) {
    const MOODS = ["whimsical", "epic", "spooky", "bouncy"];
    const tracks = [];
    const rejected = [];
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
        tracks.push({ mood: entry.mood, bpm: entry.bpm, handle: entry.handle });
    });
    return { tracks, rejected };
}
export function trackForMood(tracks, mood) {
    for (const track of tracks) {
        if (track.mood === mood) {
            return track;
        }
    }
    return null;
}
export function availableMoods(tracks) {
    const moods = [];
    for (const track of tracks) {
        if (moods.indexOf(track.mood) < 0) {
            moods.push(track.mood);
        }
    }
    return moods;
}
/** Tempo the reel should be quantized to: the playing track's, or a fallback. */
export function activeBpm(track, fallback) {
    return track ? track.bpm : fallback;
}
// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------
/** Foley volume from how far the puppet moved on that transition. */
export function volumeForStrength(strength) {
    return 0.35 + 0.65 * clamp01(strength);
}
export function targetVolume(musicVolume, ducked) {
    return ducked ? DUCKED_VOLUME : clamp01(musicVolume);
}
/** Progress through a crossfade, 0..1. */
export function crossfadeProgress(now, startedAt) {
    if (startedAt < 0) {
        return 1;
    }
    return clamp01((now - startedAt) / CROSSFADE_SECONDS);
}
/** One frame of a volume ramp, stepping toward the target without overshoot. */
export function stepVolume(current, target) {
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
    constructor(cooldown = SFX_COOLDOWN_SECONDS) {
        this.cooldown = cooldown;
        this.lastPlayed = {};
    }
    /** True if the sound may play now; records it when so. */
    request(sfxId, now) {
        const last = this.lastPlayed[sfxId];
        if (last !== undefined && now - last < this.cooldown) {
            return false;
        }
        this.lastPlayed[sfxId] = now;
        return true;
    }
    /** Different sounds do not block each other. */
    lastPlayedAt(sfxId) {
        const last = this.lastPlayed[sfxId];
        return last === undefined ? null : last;
    }
    reset() {
        this.lastPlayed = {};
    }
}
