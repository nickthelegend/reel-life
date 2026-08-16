import { resetTrim } from "./Clip.js";
import { EASE_NAMES } from "./Easing.js";
import { DEFAULT_BPM, MAX_BPM, MIN_BPM } from "./BeatGrid.js";
import { MOODS } from "./MusicPrompt.js";
import { clamp } from "./Vec.js";
/**
 * On-disk format for a saved reel.
 *
 * This is the app's real persistence: it round-trips through Lens Studio's
 * `persistentStorageSystem`, which survives a Lens restart and a device reboot.
 * Generated GLB binaries are not persistable from inside a Lens, so a saved
 * reel stores the rig plan and every recorded pose, and the character is
 * regenerated from the same prompts on load.
 */
export const REEL_SCHEMA_VERSION = 1;
const CLIP_SOURCES = ["stopmotion", "performance"];
export function createReelDocument(id, rig, savedAtMs) {
    return {
        version: REEL_SCHEMA_VERSION,
        id,
        title: rig.description,
        savedAtMs,
        rig,
        clips: [],
        bpm: DEFAULT_BPM,
        mood: "whimsical",
        playbackSpeed: 1,
    };
}
export function serializeReel(doc) {
    return JSON.stringify(doc);
}
function fail(reason) {
    throw new Error(`Corrupt reel data: ${reason}`);
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readNumber(value, label) {
    if (typeof value !== "number" || !isFinite(value)) {
        fail(`${label} is not a finite number`);
    }
    return value;
}
function readVec3(value, label) {
    if (!isObject(value)) {
        fail(`${label} is not a vector`);
    }
    return {
        x: readNumber(value.x, `${label}.x`),
        y: readNumber(value.y, `${label}.y`),
        z: readNumber(value.z, `${label}.z`),
    };
}
function readQuat(value, label) {
    if (!isObject(value)) {
        fail(`${label} is not a quaternion`);
    }
    return {
        x: readNumber(value.x, `${label}.x`),
        y: readNumber(value.y, `${label}.y`),
        z: readNumber(value.z, `${label}.z`),
        w: readNumber(value.w, `${label}.w`),
    };
}
function readKeyframe(value, label) {
    if (!isObject(value)) {
        fail(`${label} is not an object`);
    }
    const jointsRaw = value.joints;
    if (!isObject(jointsRaw)) {
        fail(`${label}.joints is missing`);
    }
    const joints = {};
    for (const id in jointsRaw) {
        const jp = jointsRaw[id];
        if (!isObject(jp)) {
            fail(`${label}.joints.${id} is not an object`);
        }
        joints[id] = {
            p: readVec3(jp.p, `${label}.joints.${id}.p`),
            r: readQuat(jp.r, `${label}.joints.${id}.r`),
        };
    }
    return { t: readNumber(value.t, `${label}.t`), joints };
}
function readClip(value, label) {
    if (!isObject(value)) {
        fail(`${label} is not an object`);
    }
    if (typeof value.id !== "string" || value.id.length === 0) {
        fail(`${label}.id is missing`);
    }
    if (!Array.isArray(value.keyframes)) {
        fail(`${label}.keyframes is not an array`);
    }
    const source = typeof value.source === "string" && CLIP_SOURCES.indexOf(value.source) >= 0
        ? value.source
        : "stopmotion";
    const ease = typeof value.ease === "string" && EASE_NAMES.indexOf(value.ease) >= 0
        ? value.ease
        : "smooth";
    const clip = {
        id: value.id,
        name: typeof value.name === "string" ? value.name : value.id,
        source,
        keyframes: value.keyframes.map((kf, i) => readKeyframe(kf, `${label}.keyframes[${i}]`)),
        trimIn: 0,
        trimOut: 0,
        caption: typeof value.caption === "string" ? value.caption : null,
        ease,
    };
    resetTrim(clip);
    if (typeof value.trimIn === "number") {
        clip.trimIn = clamp(Math.round(value.trimIn), 0, Math.max(0, clip.keyframes.length - 1));
    }
    if (typeof value.trimOut === "number") {
        clip.trimOut = clamp(Math.round(value.trimOut), clip.trimIn, Math.max(0, clip.keyframes.length - 1));
    }
    return clip;
}
function readRig(value) {
    if (!isObject(value)) {
        fail("rig is missing");
    }
    if (!Array.isArray(value.joints) || value.joints.length === 0) {
        fail("rig.joints is empty");
    }
    if (!Array.isArray(value.parts)) {
        fail("rig.parts is missing");
    }
    if (typeof value.description !== "string") {
        fail("rig.description is missing");
    }
    return value;
}
/**
 * Parse a stored reel. Throws with a specific reason rather than returning a
 * half-valid document — a silently empty reel after a crash is worse than a
 * visible error.
 */
export function parseReel(text) {
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (e) {
        fail("not valid JSON");
    }
    if (!isObject(raw)) {
        fail("root is not an object");
    }
    const version = readNumber(raw.version, "version");
    if (version > REEL_SCHEMA_VERSION) {
        fail(`schema version ${version} is newer than this build (${REEL_SCHEMA_VERSION})`);
    }
    if (typeof raw.id !== "string" || raw.id.length === 0) {
        fail("id is missing");
    }
    if (!Array.isArray(raw.clips)) {
        fail("clips is not an array");
    }
    const mood = typeof raw.mood === "string" && MOODS.indexOf(raw.mood) >= 0
        ? raw.mood
        : "whimsical";
    return {
        version: REEL_SCHEMA_VERSION,
        id: raw.id,
        title: typeof raw.title === "string" ? raw.title : raw.id,
        savedAtMs: typeof raw.savedAtMs === "number" ? raw.savedAtMs : 0,
        rig: readRig(raw.rig),
        clips: raw.clips.map((clip, i) => readClip(clip, `clips[${i}]`)),
        bpm: clamp(typeof raw.bpm === "number" ? raw.bpm : DEFAULT_BPM, MIN_BPM, MAX_BPM),
        mood,
        playbackSpeed: clamp(typeof raw.playbackSpeed === "number" ? raw.playbackSpeed : 1, 0.25, 4),
    };
}
export function summarize(doc) {
    return {
        id: doc.id,
        title: doc.title,
        savedAtMs: doc.savedAtMs,
        clipCount: doc.clips.length,
    };
}
