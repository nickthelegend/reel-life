/**
 * Renders a Reel Life performance to an animated GIF, with no browser and no
 * Lens Studio.
 *
 * This is the project's answer to its own biggest problem: the app computes a
 * complete performance and, without hardware, nobody can watch it. Here the
 * real Logic modules build a rig, record a reel, bake in follow-through,
 * quantize it to a beat grid, and step it exactly as playback would — then a
 * small software rasterizer turns each exposure into pixels and the GIF encoder
 * writes a file you can actually look at.
 *
 * Every module imported below is the same code the Lens runs.
 *
 *   node tools/render-demo-gif.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeGif, inspectGif } from "../harness/gif-encoder.js";

const D = "../harness/dist/Logic";
const { buildRigPlan } = await import(`${D}/RigPlan.js`);
const { createClip, appendKeyframe } = await import(`${D}/Clip.js`);
const { samplePose } = await import(`${D}/PoseInterpolator.js`);
const { forwardKinematics } = await import(`${D}/Kinematics.js`);
const { createShootRate, holdSeconds, steppedTime } = await import(`${D}/Stepped.js`);
const { applySecondaryMotion, DEFAULT_SECONDARY_MOTION } = await import(
  `${D}/SecondaryMotion.js`
);
const { createBeatGrid, quantizeClip } = await import(`${D}/BeatGrid.js`);
const { ReelTimeline } = await import(`${D}/ReelTimeline.js`);
const { qFromAxisAngle, v3, Q_IDENTITY } = await import(`${D}/Vec.js`);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "media");

const WIDTH = 480;
const HEIGHT = 320;
const PADDING = 34;

/**
 * Camera framing, solved from the performance itself.
 *
 * The joint chain spans far less than the character's nominal height (meshes
 * fill the rest, and we are drawing a skeleton), and how much the puppet
 * travels depends entirely on what was posed. Fitting to the actual bounds of
 * every frame keeps the performance filling the frame without guessing.
 */
let camera = { scale: 9, offsetX: WIDTH / 2, offsetY: HEIGHT - 60 };

function solveCamera(poses, plan) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const pose of poses) {
    const world = forwardKinematics(pose, plan);
    for (const id in world) {
      const p = world[id].p;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((WIDTH - PADDING * 2) / spanX, (HEIGHT - PADDING * 2) / spanY);

  return {
    scale,
    offsetX: WIDTH / 2 - ((minX + maxX) / 2) * scale,
    offsetY: HEIGHT / 2 + ((minY + maxY) / 2) * scale,
    groundY: HEIGHT / 2 + ((minY + maxY) / 2) * scale - minY * scale,
  };
}

const INK = [230, 232, 240];
const BG = [10, 11, 16];
const LINE = [44, 47, 61];
const ACCENT = [255, 180, 84];

// ---------------------------------------------------------------------------
// Software rasterizer — enough for a skeleton
// ---------------------------------------------------------------------------

function createSurface() {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = BG[0];
    data[i + 1] = BG[1];
    data[i + 2] = BG[2];
    data[i + 3] = 255;
  }
  return data;
}

function pixel(data, x, y, rgb, alpha = 1) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) return;
  const i = (py * WIDTH + px) * 4;
  data[i] = data[i] * (1 - alpha) + rgb[0] * alpha;
  data[i + 1] = data[i + 1] * (1 - alpha) + rgb[1] * alpha;
  data[i + 2] = data[i + 2] * (1 - alpha) + rgb[2] * alpha;
}

function disc(data, cx, cy, radius, rgb, alpha = 1) {
  const r2 = radius * radius;
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= r2) pixel(data, cx + x, cy + y, rgb, alpha);
    }
  }
}

/** Thick line by stamping discs along it — simple and artefact-free. */
function line(data, x0, y0, x1, y1, thickness, rgb, alpha = 1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(data, x0 + dx * t, y0 + dy * t, thickness, rgb, alpha);
  }
}

const project = (p) => [camera.offsetX + p.x * camera.scale, camera.offsetY - p.y * camera.scale];

function drawSkeleton(data, pose, plan, rgb, thickness, alpha) {
  const world = forwardKinematics(pose, plan);
  for (const joint of plan.joints) {
    if (!joint.parent || !world[joint.id] || !world[joint.parent]) continue;
    const [ax, ay] = project(world[joint.parent].p);
    const [bx, by] = project(world[joint.id].p);
    line(data, ax, ay, bx, by, thickness, rgb, alpha);
  }
  for (const joint of plan.joints) {
    if (!world[joint.id]) continue;
    const [x, y] = project(world[joint.id].p);
    disc(data, x, y, joint.poseable ? thickness + 2 : thickness, rgb, alpha);
  }
}

function drawFrame(pose, ghosts, plan) {
  const data = createSurface();
  line(data, 0, camera.groundY, WIDTH, camera.groundY, 0, LINE);

  ghosts.forEach((ghost, i) => {
    drawSkeleton(data, ghost, plan, ACCENT, 2, 0.28 - i * 0.1);
  });
  drawSkeleton(data, pose, plan, INK, 3, 1);

  return { width: WIDTH, height: HEIGHT, data };
}

// ---------------------------------------------------------------------------
// The performance
// ---------------------------------------------------------------------------

const plan = buildRigPlan("a clay dragon in a top hat");

function restPose() {
  const pose = {};
  for (const joint of plan.joints) {
    if (joint.poseable) pose[joint.id] = { p: { ...joint.offset }, r: { ...Q_IDENTITY } };
  }
  return pose;
}

/** Pose the puppet: rotate a joint about Z and lift it. */
function posed(spec) {
  const pose = restPose();
  for (const [jointId, angle, lift] of spec) {
    if (!pose[jointId]) continue;
    pose[jointId] = {
      p: v3(pose[jointId].p.x, pose[jointId].p.y + (lift || 0), pose[jointId].p.z),
      r: qFromAxisAngle(v3(0, 0, 1), angle),
    };
  }
  return pose;
}

function take(name, poses) {
  const clip = createClip(name, name, "stopmotion", "smooth");
  poses.forEach((spec, i) => appendKeyframe(clip, { t: i * 0.4, joints: posed(spec) }));
  return clip;
}

// A little performance: the dragon rears up, beats its wings, and bows.
const takes = [
  take("Take 1", [
    [["torso", 0], ["wing.L", 0], ["wing.R", 0]],
    [["torso", 0.25], ["wing.L", -0.5], ["wing.R", 0.3]],
    [["torso", 0.5], ["wing.L", -1.1], ["wing.R", 0.9]],
    [["torso", 0.3], ["wing.L", -0.3], ["wing.R", 0.2]],
  ]),
  take("Take 2", [
    [["torso", 0.3], ["neck", 0], ["wing.L", -0.3], ["wing.R", 0.2]],
    [["torso", -0.2], ["neck", 0.5], ["wing.L", -1.3], ["wing.R", 1.2]],
    [["torso", 0.1], ["neck", -0.3], ["wing.L", -0.6], ["wing.R", 0.5]],
  ]),
  take("Take 3", [
    [["torso", 0.1], ["neck", -0.3]],
    [["torso", -0.7], ["neck", -0.9], ["head", -0.5]],
    [["torso", -1.0], ["neck", -1.2], ["head", -0.8]],
  ]),
];

const grid = createBeatGrid(150, 2);
const timeline = new ReelTimeline();
timeline.loop = false;

for (const clip of takes) {
  quantizeClip(clip, grid);
  timeline.add(applySecondaryMotion(clip, plan, DEFAULT_SECONDARY_MOTION));
}

// ---------------------------------------------------------------------------
// Render every exposure, exactly as playback would
// ---------------------------------------------------------------------------

const rate = createShootRate("twos", 24);
const step = holdSeconds(rate);
const frames = [];
const delays = [];

// Pass one: collect every pose so the camera can be framed to the whole reel.
const allPoses = [];
for (const segment of timeline.segments()) {
  const clip = timeline.get(segment.clipId);
  const duration = segment.end - segment.start;
  for (let localT = 0; localT < duration - 1e-6; localT += step) {
    const pose = samplePose(clip, steppedTime(localT, rate));
    if (pose) allPoses.push(pose);
  }
}
camera = solveCamera(allPoses, plan);

for (const segment of timeline.segments()) {
  const clip = timeline.get(segment.clipId);
  const duration = segment.end - segment.start;
  const recent = [];

  for (let localT = 0; localT < duration - 1e-6; localT += step) {
    const pose = samplePose(clip, steppedTime(localT, rate));
    if (!pose) continue;
    frames.push(drawFrame(pose, recent.slice(0, 2), plan));
    delays.push(step * 1000);
    recent.unshift(pose);
  }
}

// Hold the final pose so the loop lands instead of snapping away.
if (frames.length > 0) {
  frames.push(frames[frames.length - 1]);
  delays.push(900);
}

const bytes = encodeGif(frames, delays, true);
const info = inspectGif(bytes);

mkdirSync(OUT, { recursive: true });
const file = join(OUT, "reel-life-demo.gif");
writeFileSync(file, bytes);

console.log(`  takes      : ${timeline.clips.length}`);
console.log(`  reel       : ${timeline.totalDuration().toFixed(2)}s at ${grid.bpm} BPM`);
console.log(`  shot on    : twos (${(1 / step).toFixed(0)} exposures/sec)`);
console.log(`  frames     : ${info.frames}`);
console.log(`  camera     : ${camera.scale.toFixed(1)} px/cm, auto-fitted to the performance`);
console.log(`  size       : ${info.width}x${info.height}, ${info.paletteEntries} colours`);
console.log(`  loops      : ${info.loops}`);
console.log(`  bytes      : ${(info.bytes / 1024).toFixed(1)} KB`);
console.log(`  written to : docs/media/reel-life-demo.gif`);

if (!info.trailerPresent || info.frames < 2) {
  console.error("  FAILED: the encoder did not produce a valid animation");
  process.exit(1);
}
