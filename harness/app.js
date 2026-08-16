/**
 * Reel Life verification harness.
 *
 * Every import below is a REAL shipping module from Assets/Scripts, compiled to
 * browser ESM by tsconfig.harness.json. No behaviour is reimplemented here: this
 * file is UI and wiring only, so what the browser exercises is exactly what the
 * Lens runs.
 */
import "./platform.js";

import { ReelStore } from "./dist/Character/ReelStore.js";
import { accentAtKeyframe, buildAccentIndex } from "./dist/Logic/AccentTrack.js";
import {
  createBeatGrid,
  quantizeClip,
  stepSeconds,
  suggestBpm,
} from "./dist/Logic/BeatGrid.js";
import {
  appendKeyframe,
  captureStopMotionPose,
  clipDuration,
  createClip,
  resetTrim,
  setTrimIn,
  setTrimOut,
  trimmedKeyframes,
} from "./dist/Logic/Clip.js";
import {
  isLoopClosed,
  loopBlendClip,
  mergeClips,
  pingPongClip,
  retimeClip,
  reverseClip,
  splitClip,
} from "./dist/Logic/ClipOps.js";
import { EditHistory } from "./dist/Logic/EditHistory.js";
import { IdFactory, sessionSeedFromTime } from "./dist/Logic/Ids.js";
import {
  arcRatio,
  extremityJoints,
  forwardKinematics,
  jointArc,
} from "./dist/Logic/Kinematics.js";
import { mirrorClip, smoothClip } from "./dist/Logic/PoseOps.js";
import { samplePose } from "./dist/Logic/PoseInterpolator.js";
import { SampleGate } from "./dist/Logic/SampleGate.js";
import { clonePose } from "./dist/Logic/PoseTypes.js";
import {
  createReelDocument,
  parseReel,
  serializeReel,
} from "./dist/Logic/ReelDocument.js";
import {
  describeStats,
  posterFrame,
  reelHealth,
  reelStats,
} from "./dist/Logic/ReelStats.js";
import { ReelTimeline } from "./dist/Logic/ReelTimeline.js";
import { describeRetarget, retargetClip } from "./dist/Logic/Retarget.js";
import { buildRigPlan, poseableJointIds } from "./dist/Logic/RigPlan.js";
import {
  DEFAULT_SECONDARY_MOTION,
  applySecondaryMotion,
} from "./dist/Logic/SecondaryMotion.js";
import { createShootRate, describeShootRate, steppedTime } from "./dist/Logic/Stepped.js";
import { Q_IDENTITY, qFromAxisAngle, v3 } from "./dist/Logic/Vec.js";
import { isCommand, parseVoiceCommand } from "./dist/Logic/VoiceCommands.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const state = {
  rig: null,
  pose: {},
  displayPose: null,
  activeClip: null,
  timeline: new ReelTimeline(),
  history: new EditHistory(),
  ids: new IdFactory(sessionSeedFromTime(Date.now())),
  store: new ReelStore(),
  doc: null,
  selectedClipId: null,
  shootRate: createShootRate("twos"),
  grid: createBeatGrid(150, 2),
  playing: false,
  elapsed: 0,
  lastFrame: 0,
  onion: false,
  arcs: false,
  followThrough: true,
  recording: false,
  gate: new SampleGate(),
  accents: {},
  lastAccentKey: "",
  accentLog: [],
};

window.RL = state;

const logLines = [];
function log(message, kind) {
  const stamp = new Date().toISOString().slice(11, 23);
  logLines.unshift(`${stamp} ${message}`);
  if (logLines.length > 60) logLines.pop();
  $("log").textContent = logLines.join("\n");
  if (kind === "err") console.warn(`[harness] ${message}`);
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

function restPose(rig) {
  const pose = {};
  for (const joint of rig.joints) {
    if (joint.poseable) {
      pose[joint.id] = { p: { ...joint.offset }, r: { ...Q_IDENTITY } };
    }
  }
  return pose;
}

function buildRig(description) {
  $("rig-error").textContent = "";
  let rig;
  try {
    rig = buildRigPlan(description);
  } catch (error) {
    $("rig-error").textContent = String(error && error.message ? error.message : error);
    $("rig-summary").textContent = "";
    $("rig-parts").textContent = "";
    log(`rig rejected: ${error.message}`, "err");
    return null;
  }

  state.rig = rig;
  state.pose = restPose(rig);
  state.displayPose = null;
  state.activeClip = null;
  state.timeline = new ReelTimeline();
  state.timeline.loop = false;
  state.selectedClipId = null;
  state.history = new EditHistory();
  state.history.commit("new character", []);
  state.doc = createReelDocument(state.ids.next("reel"), rig, Date.now());
  state.store.rememberRig(rig);

  $("rig-summary").textContent =
    `archetype : ${rig.archetype}\n` +
    `subject   : ${rig.subject}\n` +
    `accessory : ${rig.accessory === null ? "(none)" : rig.accessory}\n` +
    `style     : ${rig.styleTokens.join(", ")}\n` +
    `parts     : ${rig.parts.length}\n` +
    `joints    : ${rig.joints.length} (${poseableJointIds(rig).length} poseable)\n` +
    `height    : ${rig.targetHeightCm}cm`;

  $("rig-parts").textContent = rig.parts
    .map((p) => `${p.jointId.padEnd(8)} ${p.prompt}`)
    .join("\n");

  const select = $("joint-select");
  select.innerHTML = "";
  for (const id of poseableJointIds(rig)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    select.appendChild(option);
  }
  select.value = poseableJointIds(rig)[1] || poseableJointIds(rig)[0];
  syncJointSliders();

  log(`rig built: ${rig.subject} (${rig.archetype}, ${rig.parts.length} parts)`);
  refreshAll();
  return rig;
}

// ---------------------------------------------------------------------------
// Posing
// ---------------------------------------------------------------------------

function selectedJoint() {
  return $("joint-select").value;
}

function syncJointSliders() {
  if (!state.rig) return;
  const id = selectedJoint();
  const jp = state.pose[id];
  if (!jp) return;
  const joint = state.rig.joints.filter((j) => j.id === id)[0];

  const angle = 2 * Math.atan2(jp.r.z, jp.r.w);
  $("joint-rot").value = String(clampRange(angle, -3.14, 3.14));
  $("joint-rot-val").textContent = angle.toFixed(2);
  $("joint-x").value = String(clampRange(jp.p.x - joint.offset.x, -20, 20));
  $("joint-x-val").textContent = (jp.p.x - joint.offset.x).toFixed(1);
  $("joint-y").value = String(clampRange(jp.p.y - joint.offset.y, -20, 20));
  $("joint-y-val").textContent = (jp.p.y - joint.offset.y).toFixed(1);
}

function clampRange(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function applySliders() {
  if (!state.rig) return;
  const id = selectedJoint();
  const joint = state.rig.joints.filter((j) => j.id === id)[0];
  if (!joint || !state.pose[id]) return;

  const angle = parseFloat($("joint-rot").value);
  const dx = parseFloat($("joint-x").value);
  const dy = parseFloat($("joint-y").value);

  state.pose[id] = {
    p: v3(joint.offset.x + dx, joint.offset.y + dy, joint.offset.z),
    r: qFromAxisAngle(v3(0, 0, 1), angle),
  };
  $("joint-rot-val").textContent = angle.toFixed(2);
  $("joint-x-val").textContent = dx.toFixed(1);
  $("joint-y-val").textContent = dy.toFixed(1);
  state.displayPose = null;
  draw();
}

function ensureClip(source) {
  if (state.activeClip && state.activeClip.source === source) return state.activeClip;
  const n = state.timeline.clips.length + 1;
  state.activeClip = createClip(state.ids.next("clip"), `Take ${n}`, source);
  return state.activeClip;
}

function capturePose() {
  if (!state.rig) return;
  const clip = ensureClip("stopmotion");
  captureStopMotionPose(clip, clonePose(state.pose));
  log(`captured pose ${clip.keyframes.length} of ${clip.name}`);
  refreshAll();
}

function startRecording() {
  if (!state.rig || state.recording) return;
  ensureClip("performance");
  // Driven by the real SampleGate off the harness frame clock (see frame()).
  state.gate.start(performance.now() / 1000);
  state.recording = true;
  log(`recording into ${state.activeClip.name} at ${(1 / state.gate.intervalSeconds()).toFixed(0)}Hz`);
}

/** Called once per animation frame while a performance is being recorded. */
function pumpRecorder() {
  if (!state.recording || !state.activeClip) return;
  const pose = clonePose(state.pose);
  const decision = state.gate.offer(performance.now() / 1000, pose);
  if (decision.record) {
    appendKeyframe(state.activeClip, { t: decision.elapsed, joints: pose });
    $("take-status").textContent =
      `recording… ${state.activeClip.keyframes.length} samples`;
  }
}

function stopRecording() {
  if (!state.recording) return;
  state.recording = false;
  log(`recording stopped (${state.activeClip.keyframes.length} samples)`);
  refreshAll();
}

function undoPose() {
  const clip = state.activeClip;
  if (!clip || clip.keyframes.length === 0) {
    log("no pose to undo", "err");
    return;
  }
  clip.keyframes.pop();
  clip.trimOut = Math.max(0, clip.keyframes.length - 1);
  clip.trimIn = Math.min(clip.trimIn, clip.trimOut);
  log(`undid a pose (${clip.keyframes.length} left)`);
  refreshAll();
}

function finishTake() {
  stopRecording();
  const clip = state.activeClip;
  state.activeClip = null;
  if (!clip || clip.keyframes.length === 0) {
    $("take-status").textContent = "nothing captured in this take";
    log("finish take: nothing captured");
    refreshAll();
    return;
  }

  if (clip.source === "stopmotion") {
    quantizeClip(clip, state.grid);
  }
  const finished =
    state.followThrough && state.rig
      ? applySecondaryMotion(clip, state.rig, DEFAULT_SECONDARY_MOTION)
      : clip;

  state.timeline.add(finished);
  state.selectedClipId = finished.id;
  commit(`add ${finished.name}`);
  log(`added ${finished.name} (${finished.keyframes.length} poses)`);
}

// ---------------------------------------------------------------------------
// Timeline operations
// ---------------------------------------------------------------------------

function commit(label) {
  state.history.commit(label, state.timeline.clips);
  saveReel();
  refreshAll();
}

function selectedClip() {
  return state.selectedClipId ? state.timeline.get(state.selectedClipId) : null;
}

function requireSelection() {
  const clip = selectedClip();
  if (!clip) log("select a take first", "err");
  return clip;
}

function replaceSelected(replacement, label) {
  const clip = selectedClip();
  if (!clip || !replacement) {
    log(`${label} refused`, "err");
    return false;
  }
  state.timeline.clips[state.timeline.indexOf(clip.id)] = replacement;
  state.selectedClipId = replacement.id;
  commit(label);
  log(`${label}: ${replacement.name}`);
  return true;
}

function moveSelected(delta) {
  const clip = requireSelection();
  if (!clip) return;
  const from = state.timeline.indexOf(clip.id);
  if (state.timeline.move(from, from + delta)) {
    commit(`move ${clip.name}`);
    log(`moved ${clip.name} to slot ${state.timeline.indexOf(clip.id)}`);
  } else {
    log("move refused (already at the end)", "err");
  }
}

function nudgeTrim(which, delta) {
  const clip = requireSelection();
  if (!clip) return;
  if (which === "in") setTrimIn(clip, clip.trimIn + delta);
  else setTrimOut(clip, clip.trimOut + delta);
  commit(`trim ${clip.name}`);
  log(`${clip.name} trim = [${clip.trimIn}, ${clip.trimOut}] of ${clip.keyframes.length}`);
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function play() {
  if (state.timeline.isEmpty()) {
    // Mirrors ReelPlayer.play(): stop, do not merely refuse, so a reel whose
    // last take was deleted mid-play cannot stay stuck in the playing state.
    stop();
    $("playhead-readout").textContent = "nothing to play — the timeline is empty";
    log("play refused: empty timeline", "err");
    return;
  }
  state.accents = buildAccentIndex(state.timeline.clips);
  state.accentLog = [];
  state.lastAccentKey = "";
  state.elapsed = 0;
  state.playing = true;
  state.lastFrame = performance.now() / 1000;
  log(`playing ${state.timeline.clips.length} takes`);
}

function stop() {
  state.playing = false;
  state.displayPose = null;
  log("playback stopped");
  refreshAll();
}

/**
 * One logic frame — the harness's equivalent of the Lens UpdateEvent.
 *
 * Driven by a MessageChannel pump rather than requestAnimationFrame: an
 * automated browser tab reports as hidden, where rAF is paused outright and
 * setInterval is throttled to 1Hz. Neither reflects a Lens running on glasses
 * someone is looking at. The pump is only a clock — SampleGate still decides
 * what is recorded, and ReelTimeline still decides what is played.
 */
function frame() {
  pumpRecorder();
  if (window.__harnessHook) window.__harnessHook();
  if (!state.playing) return;

  const now = performance.now() / 1000;
  const dt = Math.max(0, now - state.lastFrame);
  state.lastFrame = now;
  state.elapsed += dt * state.timeline.playbackSpeed;

  const total = state.timeline.totalDuration();
  if (state.elapsed >= total) {
    state.elapsed = total;
    state.playing = false;
    const poster = posterFrame(state.timeline, state.rig);
    if (poster) {
      seekTo(poster.globalT);
      log(`reel finished — landed on poster frame at ${poster.globalT.toFixed(2)}s`);
    }
    refreshAll();
    return;
  }
  seekTo(state.elapsed);
}

const pump = new MessageChannel();
let lastPumpAt = 0;
pump.port1.onmessage = () => {
  const now = performance.now();
  if (now - lastPumpAt >= 16) {
    lastPumpAt = now;
    frame();
  }
  pump.port2.postMessage(0);
};

function seekTo(globalT) {
  const cursor = state.timeline.resolveClamped(globalT);
  if (!cursor) return;

  const exposureT = steppedTime(cursor.localT, state.shootRate);
  const pose = samplePose(cursor.clip, exposureT);
  if (pose) state.displayPose = pose;

  state.elapsed = globalT;
  const total = state.timeline.totalDuration();
  $("scrub").value = String(total > 0 ? Math.round((globalT / total) * 1000) : 0);
  $("playhead-readout").textContent =
    `t = ${globalT.toFixed(3)}s / ${total.toFixed(3)}s\n` +
    `clip = ${cursor.clip.name} (index ${cursor.index})\n` +
    `localT = ${cursor.localT.toFixed(3)}s  exposure = ${exposureT.toFixed(3)}s\n` +
    `caption = ${cursor.clip.caption === null ? "(none)" : cursor.clip.caption}\n` +
    `shoot = ${describeShootRate(state.shootRate)}  speed = ${state.timeline.playbackSpeed}×`;

  const index = nearestExposureIndex(cursor.clip, exposureT);
  const key = `${cursor.clip.id}:${index}`;
  if (key !== state.lastAccentKey) {
    state.lastAccentKey = key;
    const mark = accentAtKeyframe(state.accents[cursor.clip.id], index);
    if (mark) {
      state.accentLog.push(`${mark.sfxId}@${cursor.clip.name}#${index}`);
      $("accent-readout").textContent = `accents fired: ${state.accentLog.join(", ")}`;
    }
  }
  draw();
}

function nearestExposureIndex(clip, localT) {
  const frames = trimmedKeyframes(clip);
  if (frames.length === 0) return -1;
  const absolute = frames[0].t + localT;
  let best = 0;
  let bestDistance = Math.abs(frames[0].t - absolute);
  for (let i = 1; i < frames.length; i++) {
    const d = Math.abs(frames[i].t - absolute);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const canvas = $("stage");
const ctx = canvas.getContext("2d");
const SCALE = 8;

function project(p) {
  return [canvas.width / 2 + p.x * SCALE, canvas.height - 40 - p.y * SCALE];
}

function drawSkeleton(pose, color, width, alpha) {
  if (!state.rig) return;
  const world = forwardKinematics(pose, state.rig);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;

  for (const joint of state.rig.joints) {
    if (!joint.parent || !world[joint.id] || !world[joint.parent]) continue;
    const [ax, ay] = project(world[joint.parent].p);
    const [bx, by] = project(world[joint.id].p);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  for (const joint of state.rig.joints) {
    if (!world[joint.id]) continue;
    const [x, y] = project(world[joint.id].p);
    ctx.beginPath();
    ctx.arc(x, y, joint.poseable ? width + 1.5 : width, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function draw() {
  ctx.fillStyle = "#0a0b10";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ground line
  ctx.strokeStyle = "#2c2f3d";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height - 40);
  ctx.lineTo(canvas.width, canvas.height - 40);
  ctx.stroke();

  if (!state.rig) {
    ctx.fillStyle = "#9aa0b5";
    ctx.font = "13px monospace";
    ctx.fillText("no character — build a rig", 20, 30);
    return;
  }

  if (state.onion && state.activeClip) {
    const frames = trimmedKeyframes(state.activeClip);
    const layers = [frames[frames.length - 1], frames[frames.length - 2]];
    const alphas = [0.35, 0.15];
    layers.forEach((frame, i) => {
      if (frame) drawSkeleton(frame.joints, "#59d499", 2, alphas[i]);
    });
  }

  if (state.arcs) {
    const clip = selectedClip() || state.activeClip;
    if (clip) {
      ctx.strokeStyle = "#ffb454";
      ctx.lineWidth = 1.5;
      for (const jointId of extremityJoints(state.rig)) {
        const arc = jointArc(clip, state.rig, jointId);
        if (arc.length < 2) continue;
        ctx.beginPath();
        arc.forEach((p, i) => {
          const [x, y] = project(p);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
  }

  drawSkeleton(state.displayPose || state.pose, "#e6e8f0", 3, 1);

  ctx.fillStyle = "#9aa0b5";
  ctx.font = "11px monospace";
  ctx.fillText(state.playing ? "▶ playing" : "editing", 12, 18);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function saveReel() {
  if (!state.doc) return;
  state.doc.clips = state.timeline.clips;
  state.doc.bpm = state.grid.bpm;
  state.store.saveReel(state.doc);
}

function loadLastReel() {
  const doc = state.store.loadLastReel();
  if (!doc) {
    $("storage-readout").textContent = "nothing stored";
    log("load: nothing stored", "err");
    refreshStorage();
    return;
  }
  state.doc = doc;
  state.rig = doc.rig;
  state.pose = restPose(doc.rig);
  state.grid = createBeatGrid(doc.bpm, 2);
  state.timeline = new ReelTimeline();
  state.timeline.loop = false;
  for (const clip of doc.clips) {
    state.timeline.add(clip);
    state.ids.observe(clip.id);
  }
  state.selectedClipId = doc.clips.length > 0 ? doc.clips[0].id : null;
  state.history = new EditHistory();
  state.history.commit("restored", doc.clips);
  $("bpm").value = String(Math.round(doc.bpm));

  const select = $("joint-select");
  select.innerHTML = "";
  for (const id of poseableJointIds(doc.rig)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    select.appendChild(option);
  }
  log(`loaded "${doc.title}" — ${doc.clips.length} takes`);
  refreshAll();
}

function refreshStorage() {
  const reels = state.store.listReels();
  const list = $("reel-list");
  list.innerHTML = "";
  for (const summary of reels) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.dataset.reelId = summary.id;
    chip.textContent = `${summary.title} · ${summary.clipCount} takes`;
    chip.onclick = () => {
      const doc = state.store.loadReel(summary.id);
      if (doc) {
        state.store.saveReel(doc);
        loadLastReel();
      } else {
        log(`reel ${summary.id} could not be loaded`, "err");
        refreshStorage();
      }
    };
    list.appendChild(chip);
  }
  const recent = state.store.recentRigs();
  $("storage-readout").textContent =
    `stored reels : ${reels.length}\n` +
    `recent rigs  : ${recent.map((r) => r.subject).join(" | ") || "(none)"}`;
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

function refreshTimeline() {
  const container = $("timeline");
  container.innerHTML = "";

  if (state.timeline.isEmpty()) {
    const empty = document.createElement("div");
    empty.className = "note tip";
    empty.id = "timeline-empty";
    empty.textContent = "No takes yet — capture some poses and press Finish take.";
    container.appendChild(empty);
  }

  state.timeline.segments().forEach((segment, i) => {
    const clip = state.timeline.clips[i];
    const chip = document.createElement("span");
    chip.className = "chip" + (clip.id === state.selectedClipId ? " sel" : "");
    chip.dataset.clipId = clip.id;
    chip.dataset.index = String(i);
    const kept = trimmedKeyframes(clip).length;
    chip.textContent =
      `${clip.name} · ${clipDuration(clip).toFixed(2)}s · ${kept}/${clip.keyframes.length}` +
      (clip.caption ? ` · "${clip.caption}"` : "");
    chip.onclick = () => {
      state.selectedClipId = clip.id;
      refreshAll();
    };
    container.appendChild(chip);
  });

  const selected = selectedClip();
  $("timeline-readout").textContent =
    `clips    : ${state.timeline.clips.map((c) => c.name).join(" → ") || "(none)"}\n` +
    `segments : ${state.timeline
      .segments()
      .map((s) => `[${s.start.toFixed(2)},${s.end.toFixed(2)}]`)
      .join(" ") || "(none)"}\n` +
    `total    : ${state.timeline.totalDuration().toFixed(3)}s\n` +
    (selected
      ? `selected : ${selected.name} src=${selected.source} trim=[${selected.trimIn},${selected.trimOut}] ` +
        `kf=${selected.keyframes.length} loopClosed=${isLoopClosed(selected)}`
      : "selected : (none)");
}

function refreshStats() {
  if (!state.rig) {
    $("stats-readout").textContent = "";
    $("health-list").innerHTML = "";
    return;
  }
  const stats = reelStats(state.timeline, state.rig, state.grid.bpm);
  $("stats-readout").textContent =
    `${describeStats(stats)}\n` +
    `poses recorded : ${stats.poses}   kept : ${stats.keptPoses}\n` +
    `captions       : ${stats.captions}\n` +
    `longest take   : ${stats.longestTakeName || "(none)"}\n` +
    `world travel   : ${stats.travelCm}cm`;

  const notes = reelHealth(state.timeline, state.rig);
  const list = $("health-list");
  list.innerHTML = "";
  for (const note of notes) {
    const div = document.createElement("div");
    div.className = `note ${note.severity}`;
    div.dataset.noteId = note.id;
    div.textContent = `[${note.severity}] ${note.message}`;
    list.appendChild(div);
  }
}

function refreshHistory() {
  $("history-readout").textContent =
    `depth     : ${state.history.depth()}\n` +
    `canUndo   : ${state.history.canUndo()}\n` +
    `canRedo   : ${state.history.canRedo()}\n` +
    `undo      : ${state.history.undoLabel() || "(none)"}\n` +
    `redo      : ${state.history.redoLabel() || "(none)"}`;
  $("btn-undo").disabled = !state.history.canUndo();
  $("btn-redo").disabled = !state.history.canRedo();
}

function refreshBeat() {
  const selected = selectedClip();
  $("beat-readout").textContent =
    `bpm  : ${state.grid.bpm}\n` +
    `step : ${stepSeconds(state.grid).toFixed(4)}s\n` +
    (selected
      ? `times: ${trimmedKeyframes(selected)
          .map((k) => k.t.toFixed(3))
          .join(" ")}`
      : "times: (no take selected)");
}

function refreshTakeStatus() {
  const clip = state.activeClip;
  $("take-status").textContent = clip
    ? `${clip.name} · ${clip.source} · ${clip.keyframes.length} poses · ` +
      `times ${clip.keyframes.map((k) => k.t.toFixed(2)).join(" ")}`
    : "no take in progress";
}

function refreshAll() {
  refreshTimeline();
  refreshStats();
  refreshHistory();
  refreshBeat();
  refreshTakeStatus();
  refreshStorage();
  draw();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$("btn-build-rig").onclick = () => buildRig($("character-input").value);
const presets = {
  "btn-preset-fox": "a felt fox",
  "btn-preset-owl": "a paper owl",
  "btn-preset-slime": "a green slime",
  "btn-preset-knight": "a tiny knight",
};
for (const id in presets) {
  $(id).onclick = () => {
    $("character-input").value = presets[id];
    buildRig(presets[id]);
  };
}

$("joint-select").onchange = syncJointSliders;
for (const id of ["joint-rot", "joint-x", "joint-y"]) {
  $(id).oninput = applySliders;
}

$("btn-capture").onclick = capturePose;
$("btn-record-start").onclick = startRecording;
$("btn-record-stop").onclick = stopRecording;
$("btn-undo-pose").onclick = undoPose;
$("btn-finish-take").onclick = finishTake;

$("btn-move-left").onclick = () => moveSelected(-1);
$("btn-move-right").onclick = () => moveSelected(1);
$("btn-trim-in-plus").onclick = () => nudgeTrim("in", 1);
$("btn-trim-in-minus").onclick = () => nudgeTrim("in", -1);
$("btn-trim-out-plus").onclick = () => nudgeTrim("out", 1);
$("btn-trim-out-minus").onclick = () => nudgeTrim("out", -1);
$("btn-reset-trim").onclick = () => {
  const clip = requireSelection();
  if (!clip) return;
  resetTrim(clip);
  commit(`reset trim ${clip.name}`);
};
$("btn-delete-clip").onclick = () => {
  const clip = requireSelection();
  if (!clip) return;
  state.timeline.remove(clip.id);
  state.selectedClipId = state.timeline.isEmpty() ? null : state.timeline.clips[0].id;
  commit(`delete ${clip.name}`);
  log(`deleted ${clip.name}`);
};

$("btn-split").onclick = () => {
  const clip = requireSelection();
  if (!clip) return;
  const at = Math.floor(trimmedKeyframes(clip).length / 2);
  const halves = splitClip(clip, at, state.ids.next("clip"), state.ids.next("clip"));
  if (!halves) {
    log(`split refused: ${clip.name} is too short to split at ${at}`, "err");
    return;
  }
  const index = state.timeline.indexOf(clip.id);
  state.timeline.clips.splice(index, 1, halves[0], halves[1]);
  state.selectedClipId = halves[0].id;
  commit(`split ${clip.name}`);
  log(`split ${clip.name} at pose ${at}`);
};
$("btn-merge").onclick = () => {
  const clip = requireSelection();
  if (!clip) return;
  const index = state.timeline.indexOf(clip.id);
  const next = state.timeline.clips[index + 1];
  if (!next) {
    log("merge refused: nothing after this take", "err");
    return;
  }
  const merged = mergeClips(clip, next, state.ids.next("clip"));
  if (!merged) {
    log("merge refused", "err");
    return;
  }
  state.timeline.clips.splice(index, 2, merged);
  state.selectedClipId = merged.id;
  commit(`merge ${clip.name}`);
  log(`merged ${clip.name} + ${next.name}`);
};
$("btn-reverse").onclick = () => {
  const clip = requireSelection();
  if (clip) replaceSelected(reverseClip(clip, state.ids.next("clip")), "reverse");
};
$("btn-pingpong").onclick = () => {
  const clip = requireSelection();
  if (clip) replaceSelected(pingPongClip(clip, state.ids.next("clip")), "ping-pong");
};
$("btn-loop").onclick = () => {
  const clip = requireSelection();
  if (clip) replaceSelected(loopBlendClip(clip, state.ids.next("clip")), "loop-close");
};
$("btn-mirror").onclick = () => {
  const clip = requireSelection();
  if (clip) replaceSelected(mirrorClip(clip, state.ids.next("clip")), "mirror");
};
$("btn-smooth").onclick = () => {
  const clip = requireSelection();
  if (clip) replaceSelected(smoothClip(clip, state.ids.next("clip")), "smooth");
};
$("btn-retime").onclick = () => {
  const clip = requireSelection();
  if (clip) replaceSelected(retimeClip(clip, state.ids.next("clip"), 2), "retime");
};

$("btn-set-caption").onclick = () => {
  const clip = requireSelection();
  if (!clip) return;
  const text = $("caption-input").value.trim();
  clip.caption = text.length > 0 ? text : null;
  commit(`caption ${clip.name}`);
  log(`caption on ${clip.name}: ${clip.caption === null ? "(cleared)" : clip.caption}`);
};

$("btn-play").onclick = play;
$("btn-stop").onclick = stop;
$("shoot-mode").onchange = () => {
  state.shootRate = createShootRate($("shoot-mode").value);
  log(`shoot mode: ${describeShootRate(state.shootRate)}`);
  if (!state.playing) seekTo(state.elapsed);
};
$("speed").onchange = () => {
  state.timeline.playbackSpeed = parseFloat($("speed").value);
  log(`speed: ${state.timeline.playbackSpeed}×`);
  refreshAll();
};
$("scrub").oninput = () => {
  if (state.timeline.isEmpty()) return;
  state.playing = false;
  seekTo((parseInt($("scrub").value, 10) / 1000) * state.timeline.totalDuration());
};

$("btn-onion").onclick = () => {
  state.onion = !state.onion;
  $("btn-onion").textContent = `Onion: ${state.onion ? "on" : "off"}`;
  draw();
};
$("btn-arcs").onclick = () => {
  state.arcs = !state.arcs;
  $("btn-arcs").textContent = `Arcs: ${state.arcs ? "on" : "off"}`;
  const clip = selectedClip() || state.activeClip;
  if (state.arcs && clip && state.rig) {
    const ratios = extremityJoints(state.rig)
      .map((id) => `${id}=${arcRatio(jointArc(clip, state.rig, id)).toFixed(3)}`)
      .join(" ");
    log(`arc ratios: ${ratios}`);
  }
  draw();
};
$("btn-followthrough").onclick = () => {
  state.followThrough = !state.followThrough;
  $("btn-followthrough").textContent = `Follow-through: ${state.followThrough ? "on" : "off"}`;
};

$("btn-suggest-bpm").onclick = () => {
  const bpm = suggestBpm(state.timeline.clips);
  $("bpm").value = String(bpm);
  state.grid = createBeatGrid(bpm, 2);
  log(`inferred tempo: ${bpm} BPM`);
  refreshAll();
};
$("btn-quantize").onclick = () => {
  state.grid = createBeatGrid(parseFloat($("bpm").value), 2);
  let count = 0;
  for (const clip of state.timeline.clips) {
    if (clip.source === "stopmotion") {
      quantizeClip(clip, state.grid);
      count++;
    }
  }
  commit(`quantize to ${state.grid.bpm} BPM`);
  log(`quantized ${count} stop-motion take(s) to ${state.grid.bpm} BPM`);
};

$("btn-undo").onclick = () => {
  const entry = state.history.undo();
  if (!entry) return;
  state.timeline.clips = entry.clips;
  if (!state.timeline.get(state.selectedClipId)) {
    state.selectedClipId = state.timeline.isEmpty() ? null : state.timeline.clips[0].id;
  }
  saveReel();
  refreshAll();
  log(`undo → ${entry.label}`);
};
$("btn-redo").onclick = () => {
  const entry = state.history.redo();
  if (!entry) return;
  state.timeline.clips = entry.clips;
  if (!state.timeline.get(state.selectedClipId)) {
    state.selectedClipId = state.timeline.isEmpty() ? null : state.timeline.clips[0].id;
  }
  saveReel();
  refreshAll();
  log(`redo → ${entry.label}`);
};

$("btn-voice-run").onclick = () => {
  const said = $("voice-input").value;
  const command = parseVoiceCommand(said);
  const accepted = isCommand(command);
  $("voice-readout").textContent =
    `heard      : ${command.heard}\n` +
    `kind       : ${command.kind}\n` +
    `confidence : ${command.confidence}\n` +
    `accepted   : ${accepted}\n` +
    `action     : ${accepted ? "executed" : "treated as a character description"}`;
  if (!accepted) {
    log(`"${said}" is not a command — would be a character description`);
    return;
  }
  runCommand(command.kind);
};

function runCommand(kind) {
  switch (kind) {
    case "capture": capturePose(); break;
    case "new_take": finishTake(); break;
    case "play": play(); break;
    case "stop": stop(); break;
    case "undo": $("btn-undo").click(); break;
    case "redo": $("btn-redo").click(); break;
    case "delete_last": {
      if (state.timeline.isEmpty()) { log("nothing to delete", "err"); break; }
      const clip = state.timeline.clips[state.timeline.clips.length - 1];
      state.selectedClipId = clip.id;
      $("btn-delete-clip").click();
      break;
    }
    case "mirror": $("btn-mirror").click(); break;
    case "reverse": $("btn-reverse").click(); break;
    case "smooth": $("btn-smooth").click(); break;
    case "loop": $("btn-loop").click(); break;
    case "faster": case "slower": {
      const next = state.timeline.playbackSpeed === 1 ? 2 : 1;
      $("speed").value = String(next);
      $("speed").onchange();
      break;
    }
    case "shoot_mode": {
      const order = ["twos", "threes", "ones", "smooth"];
      const next = order[(order.indexOf(state.shootRate.mode) + 1) % order.length];
      $("shoot-mode").value = next;
      $("shoot-mode").onchange();
      break;
    }
    case "onion": $("btn-onion").click(); break;
    default: break;
  }
  log(`voice command executed: ${kind}`);
}

$("btn-retarget").onclick = () => {
  if (state.timeline.isEmpty() || !state.rig) {
    $("retarget-readout").textContent = "record a take first";
    log("retarget refused: nothing to remix", "err");
    return;
  }
  let target;
  try {
    target = buildRigPlan($("retarget-input").value);
  } catch (error) {
    $("retarget-readout").textContent = String(error.message);
    log(`retarget rejected: ${error.message}`, "err");
    return;
  }

  const source = state.rig;
  const moved = [];
  let lastReport = null;
  for (const clip of state.timeline.clips) {
    const result = retargetClip(clip, source, target, state.ids.next("clip"));
    moved.push(result.clip);
    lastReport = result.report;
  }

  state.rig = target;
  state.pose = restPose(target);
  state.timeline.clips = moved;
  state.selectedClipId = moved[0].id;
  state.doc = createReelDocument(state.ids.next("reel"), target, Date.now());

  const select = $("joint-select");
  select.innerHTML = "";
  for (const id of poseableJointIds(target)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    select.appendChild(option);
  }

  $("retarget-readout").textContent =
    `${source.subject} → ${target.subject}\n` +
    `${describeRetarget(lastReport)}\n` +
    `exact       : ${lastReport.exact.join(", ") || "(none)"}\n` +
    `substituted : ${Object.keys(lastReport.substituted)
      .map((k) => `${k}→${lastReport.substituted[k]}`)
      .join(", ") || "(none)"}\n` +
    `dropped     : ${lastReport.dropped.join(", ") || "(none)"}\n` +
    `unfilled    : ${lastReport.unfilled.join(", ") || "(none)"}\n` +
    `scale       : ${lastReport.scale}`;

  commit(`retarget to ${target.subject}`);
  log(`retargeted ${moved.length} take(s) onto ${target.subject}`);
};

$("btn-save").onclick = () => {
  saveReel();
  log(`saved reel ${state.doc ? state.doc.id : "(none)"}`);
  refreshStorage();
};
$("btn-load-last").onclick = loadLastReel;
$("btn-delete-reel").onclick = () => {
  if (!state.doc) return;
  state.store.deleteReel(state.doc.id);
  log(`deleted reel ${state.doc.id}`);
  refreshStorage();
};
$("btn-corrupt").onclick = () => {
  if (!state.doc) return;
  window.localStorage.setItem(
    `reellife:reellife.reel.v1.${state.doc.id}`,
    '{"version":1,"id":"x","clips":[{"id":"c","keyframes":[{"t":0,"joints":{"torso":{"p":{"x":null,"y":0,"z":0},"r":{"x":0,"y":0,"z":0,"w":1}}}}]}],"rig":{"description":"x","joints":[{"id":"root","parent":null,"offset":{"x":0,"y":0,"z":0},"poseable":false,"label":"r"}],"parts":[]}}'
  );
  log(`corrupted stored data for ${state.doc.id} — now try Load last`);
  refreshStorage();
};
$("btn-clear-storage").onclick = () => {
  state.store.clearAll();
  log("cleared all stored reels");
  refreshStorage();
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

$("build-info").textContent =
  "real Logic modules loaded from ./dist — persistence via localStorage";
refreshAll();
pump.port2.postMessage(0);
log(`harness ready — frame clock: MessageChannel (document.hidden=${document.hidden})`);
