import { strict as assert } from "node:assert";
import { test } from "node:test";

import { createBeatGrid } from "../Assets/Scripts/Logic/BeatGrid";
import { Clip, appendKeyframe, createClip } from "../Assets/Scripts/Logic/Clip";
import {
  addMovingHold,
  cutToBeat,
  longHolds,
} from "../Assets/Scripts/Logic/ClipOps";
import {
  exposureSheet,
  formatXSheet,
  frameCount,
  frameToTime,
  keyframeAt,
  nextExposureTime,
  previousExposureTime,
  timeToFrame,
} from "../Assets/Scripts/Logic/ExposureSheet";
import {
  critiqueClip,
  detectTwinning,
  lowContrastPairs,
  mirroredPairs,
  poseContrast,
  twinningScore,
} from "../Assets/Scripts/Logic/PoseCritique";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { RigPlan, buildRigPlan } from "../Assets/Scripts/Logic/RigPlan";
import {
  createReelDocument,
  serializeReel,
} from "../Assets/Scripts/Logic/ReelDocument";
import {
  decodeBase64Url,
  encodeBase64Url,
  fromFileContents,
  fromLinkFragment,
  suggestedFileName,
  toFileContents,
  toLinkFragment,
} from "../Assets/Scripts/Logic/ReelTransfer";
import { createShootRate } from "../Assets/Scripts/Logic/Stepped";
import { Q_IDENTITY, qFromAxisAngle, v3, v3Add } from "../Assets/Scripts/Logic/Vec";

const plan = buildRigPlan("a clay dragon in a top hat");

function rest(p: RigPlan = plan): PoseSample {
  const pose: PoseSample = {};
  for (const joint of p.joints) {
    if (joint.poseable) {
      pose[joint.id] = { p: { ...joint.offset }, r: { ...Q_IDENTITY } };
    }
  }
  return pose;
}

function take(times: number[], build: (i: number) => PoseSample): Clip {
  const clip = createClip("c", "Take 1", "stopmotion");
  times.forEach((t, i) => appendKeyframe(clip, { t, joints: build(i) }));
  return clip;
}

// ===========================================================================
// Exposure sheet
// ===========================================================================

test("an exposure sheet has one row per film frame", () => {
  const clip = take([0, 0.4, 0.8], () => rest());
  const sheet = exposureSheet(clip, createShootRate("twos", 24));
  // 0.8s at 24fps = 19 frames + the final one.
  assert.equal(sheet.totalFrames, frameCount(clip, 24));
  assert.equal(sheet.rows.length, sheet.totalFrames);
  assert.equal(sheet.rows[0].frame, 1, "X-sheets are 1-based");
});

test("on twos, each exposure is held for exactly two frames", () => {
  const clip = take([0, 0.4, 0.8], () => rest());
  const sheet = exposureSheet(clip, createShootRate("twos", 24));
  const exposures = sheet.rows.filter((r) => r.isNewExposure);

  assert.ok(exposures.length > 3);
  // Every exposure except possibly the last runs the full hold.
  for (const row of exposures.slice(0, -1)) {
    assert.equal(row.heldFrames, 2, `frame ${row.frame} held ${row.heldFrames}`);
  }
});

test("on threes, exposures are held for three frames", () => {
  const clip = take([0, 0.4, 0.8], () => rest());
  const sheet = exposureSheet(clip, createShootRate("threes", 24));
  const exposures = sheet.rows.filter((r) => r.isNewExposure);
  for (const row of exposures.slice(0, -1)) {
    assert.equal(row.heldFrames, 3);
  }
});

test("shooting smooth exposes a new pose only when the pose changes", () => {
  const clip = take([0, 0.4, 0.8], () => rest());
  const sheet = exposureSheet(clip, createShootRate("smooth", 24));
  // Smooth has no stepping, so exposures track keyframe changes: 3 of them.
  assert.equal(sheet.exposures, 3);
});

test("the sheet marks the beats when a grid is supplied", () => {
  const clip = take([0, 0.4, 0.8, 1.2], () => rest());
  const sheet = exposureSheet(clip, createShootRate("twos", 24), createBeatGrid(120, 2));
  const beats = sheet.rows.filter((r) => r.onBeat);
  // 120 BPM = a beat every 0.5s; over 1.2s that is 0, 0.5, 1.0.
  assert.equal(beats.length, 3);
  assert.deepEqual(beats.map((b) => b.seconds), [0, 0.5, 1]);
});

test("with no grid, nothing is marked as on the beat", () => {
  const sheet = exposureSheet(take([0, 0.4], () => rest()), createShootRate("twos", 24));
  assert.equal(sheet.rows.filter((r) => r.onBeat).length, 0);
});

test("an empty clip produces an empty sheet rather than throwing", () => {
  const sheet = exposureSheet(createClip("x", "x", "stopmotion"), createShootRate("twos"));
  assert.deepEqual(sheet.rows, []);
  assert.equal(sheet.totalFrames, 0);
});

test("the rendered sheet reads like an X-sheet", () => {
  const clip = take([0, 0.4], () => rest());
  const text = formatXSheet(exposureSheet(clip, createShootRate("twos", 24)), "Take 1");
  assert.ok(text.includes("Take 1"));
  assert.ok(text.includes("24fps"));
  assert.ok(text.includes("on twos"));
  assert.ok(text.includes("frame │ pose │ hold │ beat"));
});

test("keyframeAt reports which pose is showing", () => {
  const clip = take([0, 0.4, 0.8], () => rest());
  assert.equal(keyframeAt(clip, 0), 0);
  assert.equal(keyframeAt(clip, 0.39), 0);
  assert.equal(keyframeAt(clip, 0.4), 1);
  assert.equal(keyframeAt(clip, 0.9), 2);
  assert.equal(keyframeAt(createClip("x", "x", "stopmotion"), 0), -1);
});

test("frames and times convert both ways", () => {
  assert.equal(frameToTime(1, 24), 0);
  assert.ok(Math.abs(frameToTime(25, 24) - 1) < 1e-9);
  assert.equal(timeToFrame(0, 24), 1);
  assert.equal(timeToFrame(1, 24), 25);
});

test("stepping forward lands on the next exposure, then stops at the end", () => {
  const clip = take([0, 0.4, 0.8], () => rest());
  const rate = createShootRate("twos", 24);
  const hold = 2 / 24;

  const first = nextExposureTime(clip, 0, rate)!;
  assert.ok(Math.abs(first - hold) < 1e-9);

  // Walking forward must terminate rather than run past the clip.
  let t: number | null = 0;
  let steps = 0;
  while ((t = nextExposureTime(clip, t as number, rate)) !== null && steps < 500) {
    steps++;
  }
  assert.ok(steps > 5 && steps < 500, `walked ${steps} exposures`);
});

test("stepping back reaches the start and stops", () => {
  const clip = take([0, 0.4, 0.8], () => rest());
  const rate = createShootRate("twos", 24);
  let t: number | null = 0.8;
  let steps = 0;
  while ((t = previousExposureTime(clip, t as number, rate)) !== null && steps < 500) {
    if (t === 0) break;
    steps++;
  }
  assert.ok(steps < 500);
  assert.equal(t, 0);
});

test("smooth mode steps key to key", () => {
  const clip = take([0, 0.4, 0.8], () => rest());
  const rate = createShootRate("smooth", 24);
  assert.ok(Math.abs(nextExposureTime(clip, 0, rate)! - 0.4) < 1e-9);
  assert.ok(Math.abs(previousExposureTime(clip, 0.8, rate)! - 0.4) < 1e-9);
  assert.equal(nextExposureTime(clip, 0.8, rate), null);
});

// ===========================================================================
// Pose critique
// ===========================================================================

test("the rig's left/right pairs are found once each", () => {
  const pairs = mirroredPairs(plan);
  const flat = pairs.reduce<string[]>((a, p) => a.concat(p), []);
  assert.equal(new Set(flat).size, flat.length, "no joint appears twice");
  assert.ok(pairs.some((p) => p[0] === "wing.L" && p[1] === "wing.R"));
  assert.equal(flat.indexOf("head"), -1, "centre-line joints have no pair");
});

test("perfectly twinned limbs score 1", () => {
  const pose = rest();
  const angle = qFromAxisAngle(v3(0, 1, 0), 0.8);
  pose["wing.L"].r = angle;
  pose["wing.R"].r = { x: angle.x, y: -angle.y, z: -angle.z, w: angle.w };
  pose["leg.L"].r = angle;
  pose["leg.R"].r = { x: angle.x, y: -angle.y, z: -angle.z, w: angle.w };
  assert.ok(twinningScore(pose, plan) > 0.99, `${twinningScore(pose, plan)}`);
});

test("limbs doing different things score low", () => {
  const pose = rest();
  pose["wing.L"].r = qFromAxisAngle(v3(0, 1, 0), 1.2);
  pose["wing.R"].r = qFromAxisAngle(v3(1, 0, 0), -0.9);
  pose["leg.L"].r = qFromAxisAngle(v3(0, 0, 1), 1.0);
  pose["leg.R"].r = qFromAxisAngle(v3(0, 1, 0), -1.4);
  assert.ok(twinningScore(pose, plan) < 0.6, `${twinningScore(pose, plan)}`);
});

test("a twinned take is flagged", () => {
  const twin = (i: number) => {
    const pose = rest();
    const a = qFromAxisAngle(v3(0, 1, 0), 0.3 + i * 0.3);
    pose["wing.L"].r = a;
    pose["wing.R"].r = { x: a.x, y: -a.y, z: -a.z, w: a.w };
    return pose;
  };
  const flagged = detectTwinning(take([0, 0.4, 0.8], twin), plan);
  assert.ok(flagged.length >= 2, `flagged ${flagged.length}`);
  assert.ok(flagged[0].score >= 0.9);
});

test("limb pairs that were never posed do not count toward twinning", () => {
  // Regression, found in the browser: only the wings were dragged (identically,
  // not mirrored). The legs sat at rest, and two identity rotations score as
  // perfect twins — which pulled the average over the threshold and flagged a
  // take that was not twinned at all.
  const pose = rest();
  const a = qFromAxisAngle(v3(0, 0, 1), 0.13);
  pose["wing.L"].r = a;
  pose["wing.R"].r = a; // identical, NOT mirrored -> not twinned
  // leg.L / leg.R left at rest.

  const score = twinningScore(pose, plan);
  assert.ok(score < 0.9, `unposed legs must not inflate the score (got ${score})`);
});

test("a rest pose is not reported as twinning", () => {
  // Everything is trivially mirrored at rest; that is not a mistake.
  assert.deepEqual(detectTwinning(take([0, 0.4, 0.8], () => rest()), plan), []);
});

test("pose contrast measures what the eye sees, in world space", () => {
  const a = rest();
  const b = rest();
  b.torso.r = qFromAxisAngle(v3(0, 0, 1), 0.8);
  assert.ok(poseContrast(a, b, plan) > 1);
  assert.equal(poseContrast(a, a, plan), 0);
});

test("consecutive poses that barely differ are flagged", () => {
  const clip = take([0, 0.4, 0.8], (i) => {
    const pose = rest();
    pose.torso.r = qFromAxisAngle(v3(0, 0, 1), i * 0.001);
    return pose;
  });
  const flagged = lowContrastPairs(clip, plan);
  assert.equal(flagged.length, 2, "both transitions are too subtle to read");
  assert.ok(flagged[0].contrastCm < 0.6);
});

test("a take with real pose changes is not flagged for contrast", () => {
  const clip = take([0, 0.4, 0.8], (i) => {
    const pose = rest();
    pose.torso.r = qFromAxisAngle(v3(0, 0, 1), i * 0.6);
    return pose;
  });
  assert.deepEqual(lowContrastPairs(clip, plan), []);
});

test("critique reports all three findings together", () => {
  const clip = take([0, 0.4, 0.8], () => rest());
  const summary = critiqueClip(clip, plan);
  assert.deepEqual(summary.twinnedKeyframes, []);
  assert.equal(summary.lowContrastPairs.length, 2, "identical rest poses have no contrast");
});

// ===========================================================================
// Beat-aware editing
// ===========================================================================

test("a long take is cut into bar-length pieces", () => {
  // 120 BPM, 4/4 -> a bar is 2s. An 8s take should cut into 4.
  const times: number[] = [];
  for (let i = 0; i <= 16; i++) times.push(i * 0.5);
  const clip = take(times, (i) => {
    const pose = rest();
    pose.torso.r = qFromAxisAngle(v3(0, 0, 1), i * 0.1);
    return pose;
  });

  const pieces = cutToBeat(clip, createBeatGrid(120, 2), (i) => `piece-${i}`);
  assert.equal(pieces.length, 4);
  for (const piece of pieces) {
    assert.equal(piece.keyframes[0].t, 0, "every piece starts at zero");
    assert.ok(piece.keyframes.length >= 2);
    const span = piece.keyframes[piece.keyframes.length - 1].t;
    assert.ok(span <= 2 + 1e-6, `piece spans ${span}s, longer than a bar`);
  }
  assert.ok(pieces[0].name.includes("bar 1"));
});

test("a take shorter than a bar is left alone", () => {
  const clip = take([0, 0.4, 0.8], () => rest());
  const pieces = cutToBeat(clip, createBeatGrid(120, 2), (i) => `p${i}`);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].keyframes.length, 3);
});

test("cutting to the beat does not mutate the source take", () => {
  const times: number[] = [];
  for (let i = 0; i <= 16; i++) times.push(i * 0.5);
  const clip = take(times, () => rest());
  const snapshot = JSON.stringify(clip);
  cutToBeat(clip, createBeatGrid(120, 2), (i) => `p${i}`);
  assert.equal(JSON.stringify(clip), snapshot);
});

test("only the first piece keeps the caption", () => {
  const times: number[] = [];
  for (let i = 0; i <= 16; i++) times.push(i * 0.5);
  const clip = take(times, () => rest());
  clip.caption = "he bows";
  const pieces = cutToBeat(clip, createBeatGrid(120, 2), (i) => `p${i}`);
  assert.equal(pieces[0].caption, "he bows");
  assert.equal(pieces[1].caption, null);
});

test("a moving hold breaks up a dead pause", () => {
  const clip = take([0, 1.2], (i) => {
    const pose = rest();
    pose.torso.p = v3Add(pose.torso.p, v3(i * 10, 0, 0));
    return pose;
  });
  assert.deepEqual(longHolds(clip), [0]);

  const moved = addMovingHold(clip, 0, "mh", 0.4)!;
  assert.equal(moved.keyframes.length, 3);
  assert.ok(Math.abs(moved.keyframes[1].t - 0.6) < 1e-9);

  // The drift travels toward the next pose, by the requested distance.
  const drift = moved.keyframes[1].joints.torso.p.x - clip.keyframes[0].joints.torso.p.x;
  assert.ok(Math.abs(drift - 0.4) < 1e-6, `drifted ${drift}cm`);
});

test("a moving hold is refused where there is no room for one", () => {
  const clip = take([0, 0.01], () => rest());
  assert.equal(addMovingHold(clip, 0, "mh"), null);
  assert.equal(addMovingHold(take([0, 1], () => rest()), 5, "mh"), null);
  assert.equal(addMovingHold(take([0, 1], () => rest()), 0, "mh", 0), null);
});

test("moving holds leave the source take untouched", () => {
  const clip = take([0, 1.2], () => rest());
  const snapshot = JSON.stringify(clip);
  addMovingHold(clip, 0, "mh");
  assert.equal(JSON.stringify(clip), snapshot);
});

// ===========================================================================
// Transfer
// ===========================================================================

function sampleDoc() {
  const doc = createReelDocument("reel-x", plan, 1755300000000);
  const clip = take([0, 0.4, 0.8], (i) => {
    const pose = rest();
    pose.torso.r = qFromAxisAngle(v3(0, 1, 0), i * 0.4);
    return pose;
  });
  clip.caption = "he takes a bow";
  doc.clips = [clip];
  return doc;
}

test("base64url round-trips plain and unicode text", () => {
  for (const text of ["", "hello", "a clay dragon", '{"t":0.4}', "café ✂ 🎬 日本語"]) {
    assert.equal(decodeBase64Url(encodeBase64Url(text)), text, text);
  }
});

test("the encoding is URL-safe and unpadded", () => {
  const encoded = encodeBase64Url(JSON.stringify(sampleDoc()));
  assert.ok(!/[+/=]/.test(encoded), "must not contain +, / or =");
});

test("a reel survives a round trip through a file", () => {
  const doc = sampleDoc();
  const restored = fromFileContents(toFileContents(doc));
  assert.equal(restored.id, doc.id);
  assert.equal(restored.clips[0].caption, "he takes a bow");
  assert.deepEqual(restored.clips[0].keyframes, doc.clips[0].keyframes);
});

test("the file is pretty-printed so a shared reel is readable", () => {
  const text = toFileContents(sampleDoc());
  assert.ok(text.includes("\n  "), "should be indented");
  assert.ok(text.endsWith("\n"));
});

test("the suggested filename is a safe slug", () => {
  const name = suggestedFileName(sampleDoc());
  assert.ok(name.endsWith(".reel.json"));
  assert.ok(/^[a-z0-9-]+\.reel\.json$/.test(name), name);
});

test("a reel survives a round trip through a link", () => {
  const doc = sampleDoc();
  const link = toLinkFragment(doc);
  assert.ok(link.fragment.indexOf("reel=") === 0);
  assert.equal(link.withinUrlLimit, true);

  const restored = fromLinkFragment(link.fragment);
  assert.equal(restored.id, doc.id);
  assert.deepEqual(restored.clips[0].keyframes, doc.clips[0].keyframes);
});

test("a link parses from a full URL, a fragment, or the bare payload", () => {
  const link = toLinkFragment(sampleDoc());
  const payload = link.fragment.slice(5);

  for (const form of [
    link.fragment,
    `https://example.com/#${link.fragment}`,
    `https://example.com/?x=1&${link.fragment}&y=2`,
    payload,
  ]) {
    assert.equal(fromLinkFragment(form).id, "reel-x", form.slice(0, 40));
  }
});

test("an oversized reel is reported rather than silently truncated", () => {
  const doc = sampleDoc();
  const big = take(
    Array.from({ length: 400 }, (_, i) => i / 12),
    () => rest()
  );
  doc.clips = [big];
  const link = toLinkFragment(doc);
  assert.equal(link.withinUrlLimit, false);
  assert.ok(link.length > 8000);
  // It still round-trips — the flag is advice, not a failure.
  assert.equal(fromLinkFragment(link.fragment).clips[0].keyframes.length, 400);
});

test("a corrupt link fails with a reason instead of half-loading", () => {
  assert.throws(() => fromLinkFragment("reel=not*valid*base64"), /URL-safe base64/);
  assert.throws(() => fromLinkFragment("reel="), /no reel data/);
  assert.throws(() => fromLinkFragment("   "), /no reel data/);
  assert.throws(() => fromLinkFragment(`reel=${encodeBase64Url("garbage")}`), /Corrupt reel/);
});

test("a link and a saved reel are the same document", () => {
  const doc = sampleDoc();
  const viaLink = fromLinkFragment(toLinkFragment(doc).fragment);
  const viaFile = fromFileContents(toFileContents(doc));
  assert.equal(serializeReel(viaLink), serializeReel(viaFile));
});
