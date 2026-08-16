import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  MAX_MUSIC_SECONDS,
  MOODS,
  buildMusicPrompt,
  buildSfxPrompts,
  musicTakeCount,
  sfxForAccent,
} from "../Assets/Scripts/Logic/MusicPrompt";
import { buildRigPlan } from "../Assets/Scripts/Logic/RigPlan";

const rig = buildRigPlan("a clay dragon in a top hat");

test("the music prompt carries character, mood and the measured tempo", () => {
  const prompt = buildMusicPrompt("whimsical", rig, 150, 12);
  assert.ok(prompt.indexOf("clay dragon") >= 0, prompt);
  assert.ok(prompt.indexOf("150 BPM") >= 0, prompt);
  assert.ok(prompt.indexOf("12 seconds") >= 0, prompt);
  assert.ok(prompt.indexOf("pizzicato") >= 0, prompt);
  assert.ok(prompt.indexOf("no vocals") >= 0, prompt);
});

test("every mood produces a distinct instrumentation", () => {
  const prompts = MOODS.map((mood) => buildMusicPrompt(mood, rig, 120, 10));
  assert.equal(new Set(prompts).size, MOODS.length);
});

test("requested music length is clamped to what the generator can render", () => {
  assert.ok(buildMusicPrompt("epic", rig, 120, 900).indexOf(`${MAX_MUSIC_SECONDS} seconds`) >= 0);
  assert.ok(buildMusicPrompt("epic", rig, 120, 0.2).indexOf("4 seconds") >= 0);
});

test("long reels are scored with two takes, short ones with one", () => {
  assert.equal(musicTakeCount(20), 1);
  assert.equal(musicTakeCount(30), 1);
  assert.equal(musicTakeCount(45), 2);
  assert.equal(musicTakeCount(300), 2);
});

test("foley prompts inherit the character's material", () => {
  const sfx = buildSfxPrompts(rig);
  assert.equal(sfx.length, 3);
  for (const request of sfx) {
    assert.ok(request.prompt.indexOf("clay") >= 0, request.prompt);
  }
  assert.deepEqual(sfx.map((s) => s.id), ["step", "whoosh", "bonk"]);
});

test("accent sounds are chosen deterministically from the motion", () => {
  assert.equal(sfxForAccent("leg.L", 1), "step");
  assert.equal(sfxForAccent("head", 12), "bonk");
  assert.equal(sfxForAccent("arm.R", 2), "whoosh");
  assert.equal(sfxForAccent(null, 1), "whoosh");
});
