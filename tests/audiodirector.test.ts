import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  CROSSFADE_SECONDS,
  DUCKED_VOLUME,
  SFX_COOLDOWN_SECONDS,
  SfxGate,
  TrackInfo,
  activeBpm,
  availableMoods,
  crossfadeProgress,
  stepVolume,
  targetVolume,
  trackForMood,
  validateTracks,
  volumeForStrength,
} from "../Assets/Scripts/Logic/AudioDirector";

const TRACKS: Array<TrackInfo<string>> = [
  { mood: "whimsical", bpm: 150, handle: "music_whimsical.wav" },
  { mood: "epic", bpm: 120, handle: "music_epic.wav" },
  { mood: "spooky", bpm: 90, handle: "music_spooky.wav" },
  { mood: "bouncy", bpm: 140, handle: "music_bouncy.wav" },
];

// --- selection --------------------------------------------------------------

test("each mood selects its own track", () => {
  assert.equal(trackForMood(TRACKS, "whimsical")!.handle, "music_whimsical.wav");
  assert.equal(trackForMood(TRACKS, "spooky")!.bpm, 90);
});

test("a mood with no imported track returns null rather than the wrong one", () => {
  assert.equal(trackForMood([TRACKS[0]], "epic"), null);
  assert.equal(trackForMood([], "whimsical"), null);
});

test("available moods lists only what is actually imported, without duplicates", () => {
  assert.deepEqual(availableMoods(TRACKS), ["whimsical", "epic", "spooky", "bouncy"]);
  assert.deepEqual(availableMoods([TRACKS[0], TRACKS[0]]), ["whimsical"]);
  assert.deepEqual(availableMoods([]), []);
});

test("the beat grid follows the playing track's tempo, or falls back", () => {
  assert.equal(activeBpm(TRACKS[2], 110), 90);
  assert.equal(activeBpm(null, 110), 110);
});

// --- validation -------------------------------------------------------------

test("well-formed track rows are accepted", () => {
  const { tracks, rejected } = validateTracks([
    { mood: "whimsical", bpm: 150, handle: "a.wav" },
    { mood: "epic", bpm: 120, handle: "b.wav" },
  ]);
  assert.equal(tracks.length, 2);
  assert.deepEqual(rejected, []);
});

test("a track with no tempo is rejected, not silently used", () => {
  // This is the one that matters: a 0-BPM track would desynchronise every
  // performance quantized against it.
  const { tracks, rejected } = validateTracks([
    { mood: "whimsical", bpm: 0, handle: "a.wav" },
    { mood: "epic", bpm: NaN, handle: "b.wav" },
    { mood: "spooky", bpm: -5, handle: "c.wav" },
  ]);
  assert.equal(tracks.length, 0);
  assert.equal(rejected.length, 3);
  assert.ok(rejected[0].includes("bpm must be positive"));
});

test("an unknown mood is rejected with the offending value named", () => {
  const { tracks, rejected } = validateTracks([
    { mood: "interpretive-jazz", bpm: 120, handle: "a.wav" },
  ]);
  assert.equal(tracks.length, 0);
  assert.ok(rejected[0].includes("interpretive-jazz"));
});

test("a row with no audio asset assigned is rejected", () => {
  const { tracks, rejected } = validateTracks([
    { mood: "whimsical", bpm: 150, handle: null as unknown as string },
  ]);
  assert.equal(tracks.length, 0);
  assert.ok(rejected[0].includes("no audio asset"));
});

test("good rows survive alongside bad ones", () => {
  const { tracks, rejected } = validateTracks([
    { mood: "whimsical", bpm: 150, handle: "a.wav" },
    { mood: "nope", bpm: 120, handle: "b.wav" },
    { mood: "epic", bpm: 120, handle: "c.wav" },
  ]);
  assert.deepEqual(tracks.map((t) => t.mood), ["whimsical", "epic"]);
  assert.equal(rejected.length, 1);
});

// --- levels -----------------------------------------------------------------

test("foley volume scales with how far the puppet moved", () => {
  assert.ok(Math.abs(volumeForStrength(0) - 0.35) < 1e-9);
  assert.ok(Math.abs(volumeForStrength(1) - 1) < 1e-9);
  assert.ok(volumeForStrength(0.5) > volumeForStrength(0.1));
});

test("foley volume clamps rather than blowing past full scale", () => {
  assert.ok(volumeForStrength(99) <= 1);
  assert.ok(volumeForStrength(-5) >= 0.35);
});

test("ducking drops the music while the mic is open", () => {
  assert.equal(targetVolume(1, true), DUCKED_VOLUME);
  assert.equal(targetVolume(1, false), 1);
  assert.equal(targetVolume(0.4, false), 0.4);
});

test("a volume ramp lands exactly on target instead of oscillating", () => {
  let v = 0;
  for (let i = 0; i < 100 && v !== 1; i++) {
    v = stepVolume(v, 1);
  }
  assert.equal(v, 1);

  // And coming down.
  for (let i = 0; i < 100 && v !== 0.15; i++) {
    v = stepVolume(v, 0.15);
  }
  assert.equal(v, 0.15);
});

test("a ramp never overshoots its target in one step", () => {
  assert.equal(stepVolume(0.99, 1), 1);
  assert.equal(stepVolume(0.16, 0.15), 0.15);
});

test("crossfade progress runs 0 to 1 over the crossfade window", () => {
  assert.equal(crossfadeProgress(10, 10), 0);
  assert.equal(crossfadeProgress(10 + CROSSFADE_SECONDS / 2, 10), 0.5);
  assert.equal(crossfadeProgress(10 + CROSSFADE_SECONDS, 10), 1);
  assert.equal(crossfadeProgress(99, 10), 1);
});

test("no crossfade in progress reports as finished", () => {
  assert.equal(crossfadeProgress(5, -1), 1);
});

// --- foley gating -----------------------------------------------------------

test("the same sound cannot retrigger inside its cooldown", () => {
  const gate = new SfxGate();
  assert.equal(gate.request("step", 0), true);
  assert.equal(gate.request("step", SFX_COOLDOWN_SECONDS / 2), false);
  assert.equal(gate.request("step", SFX_COOLDOWN_SECONDS + 0.001), true);
});

test("different sounds do not block each other", () => {
  const gate = new SfxGate();
  assert.equal(gate.request("step", 0), true);
  assert.equal(gate.request("whoosh", 0), true);
  assert.equal(gate.request("bonk", 0), true);
});

test("a machine-gun performance is thinned to the cooldown rate", () => {
  const gate = new SfxGate();
  let played = 0;
  // 100 requests over one second — far faster than the cooldown allows.
  for (let i = 0; i < 100; i++) {
    if (gate.request("whoosh", i / 100)) {
      played++;
    }
  }
  const ceiling = Math.ceil(1 / SFX_COOLDOWN_SECONDS) + 1;
  assert.ok(played <= ceiling, `${played} plays exceeds the ${ceiling} the cooldown allows`);
  assert.ok(played >= 5, "but it must not swallow the whole performance");
});

test("the gate reports when a sound last played, and resets", () => {
  const gate = new SfxGate();
  assert.equal(gate.lastPlayedAt("step"), null);
  gate.request("step", 4.2);
  assert.equal(gate.lastPlayedAt("step"), 4.2);
  gate.reset();
  assert.equal(gate.lastPlayedAt("step"), null);
});
