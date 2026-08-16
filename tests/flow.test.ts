import { strict as assert } from "node:assert";
import { test } from "node:test";

import { accentAtKeyframe, buildAccentIndex } from "../Assets/Scripts/Logic/AccentTrack";
import {
  BeatGrid,
  createBeatGrid,
  quantizeClip,
  stepSeconds,
  suggestBpm,
} from "../Assets/Scripts/Logic/BeatGrid";
import {
  Clip,
  appendKeyframe,
  captureStopMotionPose,
  clipDuration,
  createClip,
  setTrimIn,
  setTrimOut,
} from "../Assets/Scripts/Logic/Clip";
import { buildMusicPrompt } from "../Assets/Scripts/Logic/MusicPrompt";
import { nearestKeyframeIndex, samplePose } from "../Assets/Scripts/Logic/PoseInterpolator";
import { PoseSample, clonePose } from "../Assets/Scripts/Logic/PoseTypes";
import { createReelDocument, parseReel, serializeReel } from "../Assets/Scripts/Logic/ReelDocument";
import { ReelTimeline } from "../Assets/Scripts/Logic/ReelTimeline";
import { RigPlan, buildRigPlan } from "../Assets/Scripts/Logic/RigPlan";
import { Q_IDENTITY, qFromAxisAngle, v3 } from "../Assets/Scripts/Logic/Vec";

/**
 * End-to-end rehearsal of the demo, run entirely through the engine-agnostic
 * layer: speak a character, record three takes, snap them to the beat, cut them
 * on the timeline, save and reload, then play the reel back frame by frame.
 *
 * This is the same code path the Lens executes; only the scene graph and the
 * generated meshes are absent.
 */

/** Every poseable joint sitting at its rest offset. */
function restPose(plan: RigPlan): PoseSample {
  const pose: PoseSample = {};
  for (const joint of plan.joints) {
    if (joint.poseable) {
      pose[joint.id] = { p: { ...joint.offset }, r: { ...Q_IDENTITY } };
    }
  }
  return pose;
}

/** Stand-in for the user grabbing a joint and moving it. */
function poseJoint(
  pose: PoseSample,
  jointId: string,
  offsetCm: number,
  angleRad: number
): PoseSample {
  const next = clonePose(pose);
  const joint = next[jointId];
  assert.ok(joint, `rig has no joint "${jointId}"`);
  joint.p = { x: joint.p.x + offsetCm, y: joint.p.y, z: joint.p.z };
  joint.r = qFromAxisAngle(v3(0, 1, 0), angleRad);
  return next;
}

function assertFinitePose(pose: PoseSample, where: string): void {
  for (const id in pose) {
    const jp = pose[id];
    for (const key of ["x", "y", "z"] as const) {
      assert.ok(isFinite(jp.p[key]), `${where}: ${id}.p.${key} is not finite`);
    }
    for (const key of ["x", "y", "z", "w"] as const) {
      assert.ok(isFinite(jp.r[key]), `${where}: ${id}.r.${key} is not finite`);
    }
  }
}

function recordStopMotion(plan: RigPlan, name: string, poses: number): Clip {
  const clip = createClip(`clip-${name}`, name, "stopmotion");
  let pose = restPose(plan);
  captureStopMotionPose(clip, pose);
  for (let i = 1; i < poses; i++) {
    pose = poseJoint(pose, i % 2 === 0 ? "head" : "torso", i * 3, i * 0.35);
    captureStopMotionPose(clip, pose);
  }
  return clip;
}

function recordPerformance(plan: RigPlan, name: string, seconds: number): Clip {
  const clip = createClip(`clip-${name}`, name, "performance");
  const sampleCount = Math.round(seconds * 12);
  const base = restPose(plan);
  for (let i = 0; i <= sampleCount; i++) {
    const t = i / 12;
    const swing = Math.sin(t * 3) * 6;
    appendKeyframe(clip, { t, joints: poseJoint(base, "head", swing, swing * 0.05) });
  }
  return clip;
}

test("the full create -> edit -> play flow holds together", () => {
  // 1. Speak a character.
  const plan = buildRigPlan("a clay dragon in a top hat");
  assert.equal(plan.parts.length, 7);

  // 2. Record three takes.
  const takeA = recordStopMotion(plan, "Take 1", 4);
  const takeB = recordPerformance(plan, "Take 2", 1.5);
  const takeC = recordStopMotion(plan, "Take 3", 3);

  // 3. Snap the deliberate takes to the tempo the user posed at.
  const bpm = suggestBpm([takeA, takeC]);
  const grid: BeatGrid = createBeatGrid(bpm, 2);
  quantizeClip(takeA, grid);
  quantizeClip(takeC, grid);

  const step = stepSeconds(grid);
  for (const clip of [takeA, takeC]) {
    for (const keyframe of clip.keyframes) {
      const offGrid = Math.abs(keyframe.t / step - Math.round(keyframe.t / step));
      assert.ok(offGrid < 1e-6, `${clip.name} keyframe at ${keyframe.t} is off the beat`);
    }
  }

  // 4. Cut them together.
  const timeline = new ReelTimeline();
  timeline.add(takeA);
  timeline.add(takeB);
  timeline.add(takeC);
  takeA.caption = "he wakes up";
  takeC.caption = "and takes a bow";

  // Reorder: drag the last chip to the front.
  assert.ok(timeline.moveClipId(takeC.id, 0));
  assert.deepEqual(timeline.clips.map((c) => c.name), ["Take 3", "Take 1", "Take 2"]);

  // Trim the performance take down.
  const beforeTrim = clipDuration(takeB);
  setTrimIn(takeB, 3);
  setTrimOut(takeB, takeB.keyframes.length - 4);
  assert.ok(clipDuration(takeB) < beforeTrim);
  assert.equal(takeB.keyframes.length, Math.round(1.5 * 12) + 1, "trim must not delete poses");

  // 5. Save and reload — the edit has to survive a restart.
  const doc = createReelDocument("reel-flow", plan, 1755300000000);
  doc.clips = timeline.clips;
  doc.bpm = grid.bpm;
  const restoredDoc = parseReel(serializeReel(doc));

  const restored = new ReelTimeline();
  restored.loop = false;
  for (const clip of restoredDoc.clips) {
    restored.add(clip);
  }
  assert.deepEqual(restored.clips.map((c) => c.name), ["Take 3", "Take 1", "Take 2"]);
  assert.equal(restored.clips[2].trimIn, 3);
  assert.equal(restored.get(takeA.id)!.caption, "he wakes up");

  // 6. Play the reel back frame by frame, exactly as ReelPlayer does.
  const accents = buildAccentIndex(restored.clips);
  const total = restored.totalDuration();
  assert.ok(total > 0);

  const captionsSeen: Array<string | null> = [];
  const clipsSeen: string[] = [];
  const accentsFired: string[] = [];
  let lastAccentKey = "";
  let lastClipIndex = -1;
  let lastPose: PoseSample | null = null;

  const frames = Math.ceil(total * 60);
  for (let frame = 0; frame <= frames; frame++) {
    const globalT = Math.min(total, frame / 60);
    const cursor = restored.resolve(globalT);
    assert.ok(cursor, `no cursor at t=${globalT}`);

    const pose = samplePose(cursor.clip, cursor.localT);
    assert.ok(pose, `no pose at t=${globalT}`);
    assertFinitePose(pose, `t=${globalT.toFixed(3)}`);
    lastPose = pose;

    if (cursor.index !== lastClipIndex) {
      lastClipIndex = cursor.index;
      clipsSeen.push(cursor.clip.name);
      captionsSeen.push(cursor.clip.caption);
    }

    const keyframeIndex = nearestKeyframeIndex(cursor.clip, cursor.localT);
    const key = `${cursor.clip.id}:${keyframeIndex}`;
    if (key !== lastAccentKey) {
      lastAccentKey = key;
      const mark = accentAtKeyframe(accents[cursor.clip.id], keyframeIndex);
      if (mark) {
        accentsFired.push(mark.sfxId);
        assert.ok(mark.strength > 0 && mark.strength <= 1);
      }
    }
  }

  // Every clip played, in the edited order.
  assert.deepEqual(clipsSeen, ["Take 3", "Take 1", "Take 2"]);
  assert.deepEqual(captionsSeen, ["and takes a bow", "he wakes up", null]);

  // The big pose changes made sounds.
  assert.ok(accentsFired.length >= 2, `expected foley, got ${accentsFired.length}`);

  // Playback ends on the final pose of the final clip, not mid-tween.
  const finalClip = restored.clips[restored.clips.length - 1];
  const finalPose = samplePose(finalClip, clipDuration(finalClip))!;
  assert.deepEqual(lastPose, finalPose);
});

test("the music prompt describes the reel that was actually recorded", () => {
  const plan = buildRigPlan("a clay dragon in a top hat");
  const takeA = recordStopMotion(plan, "Take 1", 5);
  const bpm = suggestBpm([takeA]);

  const timeline = new ReelTimeline();
  timeline.add(takeA);

  const prompt = buildMusicPrompt("whimsical", plan, bpm, timeline.totalDuration());
  assert.ok(prompt.indexOf("clay dragon") >= 0, prompt);
  assert.ok(prompt.indexOf(`${bpm} BPM`) >= 0, prompt);
});

test("an empty reel cannot be played", () => {
  const timeline = new ReelTimeline();
  assert.ok(timeline.isEmpty());
  assert.equal(timeline.resolve(0), null);
  assert.deepEqual(buildAccentIndex(timeline.clips), {});
});

test("re-gridding to a new tempo keeps takes ordered and on the beat", () => {
  const plan = buildRigPlan("a felt fox");
  const clip = recordStopMotion(plan, "Take 1", 6);

  const fastGrid = createBeatGrid(150, 2);
  quantizeClip(clip, fastGrid);
  const fastDuration = clipDuration(clip);
  assert.ok(
    offBeatSeconds(fastDuration, stepSeconds(fastGrid)) < 1e-3,
    "the take ends on a beat at the first tempo"
  );

  // 90 BPM has a step of 1/3 second, which no binary float represents exactly —
  // so the requirement is "within a millisecond of the beat", not bit-exact.
  const slowGrid = createBeatGrid(90, 2);
  quantizeClip(clip, slowGrid);

  const step = stepSeconds(slowGrid);
  for (let i = 0; i < clip.keyframes.length; i++) {
    const t = clip.keyframes[i].t;
    assert.ok(offBeatSeconds(t, step) < 1e-3, `frame ${i} at ${t} is off the beat`);
    if (i > 0) {
      assert.ok(t > clip.keyframes[i - 1].t, `frame ${i} out of order`);
    }
  }

  const slowDuration = clipDuration(clip);
  assert.ok(slowDuration > 0);
  assert.ok(
    offBeatSeconds(slowDuration, step) < 1e-3,
    "the take ends on a beat at the new tempo too"
  );
});

/** Distance from a time to the nearest grid line, in seconds. */
function offBeatSeconds(t: number, step: number): number {
  return Math.abs(t - Math.round(t / step) * step);
}
