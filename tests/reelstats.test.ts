import { strict as assert } from "node:assert";
import { test } from "node:test";

import { Clip, appendKeyframe, createClip, setTrimOut } from "../Assets/Scripts/Logic/Clip";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { ReelTimeline } from "../Assets/Scripts/Logic/ReelTimeline";
import {
  countAnimatedJoints,
  describeStats,
  posterFrame,
  reelHealth,
  reelStats,
} from "../Assets/Scripts/Logic/ReelStats";
import { RigPlan, buildRigPlan } from "../Assets/Scripts/Logic/RigPlan";
import { Q_IDENTITY, qFromAxisAngle, v3, v3Add } from "../Assets/Scripts/Logic/Vec";

const plan = buildRigPlan("a clay dragon in a top hat");

function restPose(source: RigPlan): PoseSample {
  const pose: PoseSample = {};
  for (const joint of source.joints) {
    if (joint.poseable) {
      pose[joint.id] = { p: { ...joint.offset }, r: { ...Q_IDENTITY } };
    }
  }
  return pose;
}

/** A take that swings the torso, so limbs move in world space. */
function swingTake(id: string, angles: number[], step = 0.4): Clip {
  const clip = createClip(id, id, "stopmotion");
  angles.forEach((angle, i) => {
    const pose = restPose(plan);
    pose.torso.r = qFromAxisAngle(v3(0, 0, 1), angle);
    appendKeyframe(clip, { t: i * step, joints: pose });
  });
  return clip;
}

function timelineOf(...clips: Clip[]): ReelTimeline {
  const timeline = new ReelTimeline();
  for (const clip of clips) {
    timeline.add(clip);
  }
  return timeline;
}

// --- stats ------------------------------------------------------------------

test("stats count what is on the timeline", () => {
  const a = swingTake("a", [0, 0.4, 0.8]);
  a.caption = "he wakes";
  const b = swingTake("b", [0, 1.2]);
  const stats = reelStats(timelineOf(a, b), plan, 150);

  assert.equal(stats.takes, 2);
  assert.equal(stats.poses, 5);
  assert.equal(stats.keptPoses, 5);
  assert.equal(stats.captions, 1);
  assert.equal(stats.bpm, 150);
  assert.equal(stats.longestTakeName, "a");
  assert.ok(stats.durationSeconds > 0);
});

test("trimmed poses are counted separately from recorded ones", () => {
  const a = swingTake("a", [0, 0.4, 0.8, 1.2]);
  setTrimOut(a, 1);
  const stats = reelStats(timelineOf(a), plan, 120);

  assert.equal(stats.poses, 4, "nothing is deleted by trimming");
  assert.equal(stats.keptPoses, 2);
});

test("only joints the user actually moved are counted", () => {
  // The torso is the only joint whose local transform changes.
  assert.equal(countAnimatedJoints([swingTake("a", [0, 0.5, 1])], plan), 1);
  assert.equal(countAnimatedJoints([swingTake("a", [0, 0, 0])], plan), 0);
});

test("world travel is reported so a still reel reads as still", () => {
  assert.ok(reelStats(timelineOf(swingTake("a", [0, 1.2])), plan, 120).travelCm > 0);
  assert.equal(reelStats(timelineOf(swingTake("a", [0, 0])), plan, 120).travelCm, 0);
});

test("an empty reel produces zeroes, not NaN", () => {
  const stats = reelStats(new ReelTimeline(), plan, 120);
  assert.equal(stats.takes, 0);
  assert.equal(stats.poses, 0);
  assert.equal(stats.durationSeconds, 0);
  assert.equal(stats.longestTakeName, null);
  assert.equal(stats.travelCm, 0);
});

test("the stats line is short enough to put on a card", () => {
  const text = describeStats(reelStats(timelineOf(swingTake("a", [0, 0.5])), plan, 150));
  assert.ok(text.indexOf("1 take") >= 0, text);
  assert.ok(text.indexOf("150 BPM") >= 0, text);
  assert.ok(text.length < 70, text);
});

// --- poster frame -----------------------------------------------------------

test("the poster frame is the most extreme pose in the reel", () => {
  const clip = createClip("a", "Take 1", "stopmotion");
  const positions = [0, 2, 40, 3];
  positions.forEach((x, i) => {
    const pose = restPose(plan);
    pose.head.p = v3Add(pose.head.p, v3(x, 0, 0));
    appendKeyframe(clip, { t: i * 0.4, joints: pose });
  });

  const poster = posterFrame(timelineOf(clip), plan)!;
  assert.equal(poster.keyframeIndex, 2, "the outlier pose should win");
  assert.equal(poster.clipId, "a");
  assert.ok(poster.globalT > 0);
});

test("the poster frame's time seeks straight to it", () => {
  const a = swingTake("a", [0, 0.2]);
  const b = createClip("b", "Take 2", "stopmotion");
  [0, 60].forEach((x, i) => {
    const pose = restPose(plan);
    pose.head.p = v3Add(pose.head.p, v3(x, 0, 0));
    appendKeyframe(b, { t: i * 0.4, joints: pose });
  });

  const timeline = timelineOf(a, b);
  const poster = posterFrame(timeline, plan)!;
  assert.equal(poster.clipIndex, 1);

  // resolveClamped, not resolve: the poster frame here sits exactly at the end
  // of the reel, which a looping resolve would wrap back to the start.
  const cursor = timeline.resolveClamped(poster.globalT)!;
  assert.equal(cursor.clip.id, "b");
});

test("an empty reel has no poster frame", () => {
  assert.equal(posterFrame(new ReelTimeline(), plan), null);
});

// --- health -----------------------------------------------------------------

test("an empty reel explains what to do instead of showing nothing", () => {
  const notes = reelHealth(new ReelTimeline(), plan);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, "empty");
  assert.ok(notes[0].message.indexOf("Capture Pose") >= 0);
});

test("a single-pose take is flagged as a still frame", () => {
  const clip = createClip("a", "Take 1", "stopmotion");
  appendKeyframe(clip, { t: 0, joints: restPose(plan) });

  const notes = reelHealth(timelineOf(clip), plan);
  const note = notes.filter((n) => n.id.indexOf("single-pose") === 0)[0];
  assert.ok(note, "should warn about a one-pose take");
  assert.equal(note.severity, "warning");
  assert.equal(note.clipId, "a");
});

test("a shaky live take offers to smooth itself", () => {
  const clip = createClip("a", "Take 1", "performance");
  const wobble = [0, 1.4, -1.2, 1.1, -1.5, 1.3, -1.1, 0.9];
  wobble.forEach((w, i) => {
    const pose = restPose(plan);
    pose.head.p = v3Add(pose.head.p, v3(i * 2 + w, 0, 0));
    appendKeyframe(clip, { t: i / 12, joints: pose });
  });

  const note = reelHealth(timelineOf(clip), plan).filter(
    (n) => n.id.indexOf("shaky") === 0
  )[0];
  assert.ok(note, "should notice hand tremor");
  assert.equal(note.fix, "smooth");
  assert.ok(note.message.indexOf("smooth it") >= 0);
});

test("a limb moving in a dead straight line gets an arcs note", () => {
  const clip = createClip("a", "Take 1", "stopmotion");
  [0, 10, 20, 30].forEach((x, i) => {
    const pose = restPose(plan);
    pose.head.p = v3Add(pose.head.p, v3(x, 0, 0));
    appendKeyframe(clip, { t: i * 0.4, joints: pose });
  });

  const note = reelHealth(timelineOf(clip), plan).filter(
    (n) => n.id.indexOf("straight") === 0
  )[0];
  assert.ok(note, "a straight-line limb should be flagged");
  assert.ok(note.message.indexOf("arcs") >= 0);
});

test("a joint that barely moves is not judged on its arc", () => {
  const notes = reelHealth(timelineOf(swingTake("a", [0, 0, 0])), plan);
  assert.equal(notes.filter((n) => n.id.indexOf("straight") === 0).length, 0);
});

test("a curved take gets no arcs complaint", () => {
  const notes = reelHealth(timelineOf(swingTake("a", [0, 0.6, 1.2, 1.8])), plan);
  assert.equal(notes.filter((n) => n.id.indexOf("straight") === 0).length, 0);
});

test("a lone take suggests recording a second", () => {
  const notes = reelHealth(timelineOf(swingTake("a", [0, 0.6, 1.2])), plan);
  assert.ok(notes.filter((n) => n.id === "one-take").length === 1);
});

test("captions are suggested once there is something to cut", () => {
  const withoutCaptions = reelHealth(
    timelineOf(swingTake("a", [0, 0.6]), swingTake("b", [0, 0.6])),
    plan
  );
  assert.ok(withoutCaptions.filter((n) => n.id === "no-captions").length === 1);

  const a = swingTake("a", [0, 0.6]);
  a.caption = "he wakes";
  const withCaption = reelHealth(timelineOf(a, swingTake("b", [0, 0.6])), plan);
  assert.equal(withCaption.filter((n) => n.id === "no-captions").length, 0);
});

test("warnings sort above tips", () => {
  const single = createClip("a", "Take 1", "stopmotion");
  appendKeyframe(single, { t: 0, joints: restPose(plan) });

  const notes = reelHealth(timelineOf(single, swingTake("b", [0, 0.6])), plan);
  assert.ok(notes.length >= 2);
  assert.equal(notes[0].severity, "warning");
});

test("every note carries a stable id so the UI can dedupe it", () => {
  const timeline = timelineOf(swingTake("a", [0, 0.6, 1.2]));
  const first = reelHealth(timeline, plan).map((n) => n.id);
  const second = reelHealth(timeline, plan).map((n) => n.id);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length, "ids must be unique");
});
