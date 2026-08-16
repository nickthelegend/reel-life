/**
 * Generates Reel Life's score and foley as real WAV files.
 *
 * The app needs one music track per mood, each tagged with the exact tempo it
 * was rendered at — that BPM is what the beat grid quantizes performances to,
 * so it has to be exact rather than approximate. It also needs three foley
 * one-shots.
 *
 * This is a real synthesizer writing real PCM, not silence or a placeholder:
 * run it and the files play. It is deterministic, so the same commit always
 * produces byte-identical audio and a recorded demo replays the same.
 *
 * If you have the CLAD /build-music (Lyria) skill available, its output is a
 * drop-in replacement — keep the BPM column in SETUP.md §5 in sync and nothing
 * else changes.
 *
 *   node tools/build-audio.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "Assets", "Audio");
const RATE = 44100;

// ---------------------------------------------------------------------------
// WAV encoding (16-bit mono PCM)
// ---------------------------------------------------------------------------

function encodeWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

/** Deterministic noise — no Math.random, so builds are reproducible. */
function makeNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function hz(name, octave, semitoneOffset = 0) {
  const midi = 12 * (octave + 1) + NOTE[name] + semitoneOffset;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Percussive envelope: instant attack, exponential decay. */
function pluck(t, decay) {
  return Math.exp(-t * decay);
}

/**
 * A plucked tone with a few harmonics. `bright` shifts harmonic weighting,
 * which is most of what distinguishes a celesta from a tuba by ear.
 */
function tone(freq, t, decay, bright) {
  const env = pluck(t, decay);
  const w = 2 * Math.PI * freq * t;
  return (
    env *
    (Math.sin(w) +
      bright * 0.5 * Math.sin(2 * w) +
      bright * 0.25 * Math.sin(3 * w) +
      bright * 0.12 * Math.sin(4 * w))
  );
}

function addAt(buffer, startSample, length, fn) {
  for (let i = 0; i < length; i++) {
    const index = startSample + i;
    if (index >= 0 && index < buffer.length) {
      buffer[index] += fn(i / RATE);
    }
  }
}

/** Peak-normalize with headroom, so nothing clips and levels are consistent. */
function normalize(buffer, peak = 0.85) {
  let max = 0;
  for (const s of buffer) {
    const a = Math.abs(s);
    if (a > max) max = a;
  }
  if (max === 0) return buffer;
  const gain = peak / max;
  for (let i = 0; i < buffer.length; i++) buffer[i] *= gain;
  return buffer;
}

// ---------------------------------------------------------------------------
// Moods
// ---------------------------------------------------------------------------

const MOODS = [
  {
    mood: "whimsical",
    bpm: 150,
    file: "music_whimsical.wav",
    // Bright major, storybook. Pizzicato-ish short plucks.
    chords: [
      ["C", 5, [0, 4, 7]],
      ["A", 4, [0, 3, 7]],
      ["F", 4, [0, 4, 7]],
      ["G", 4, [0, 4, 7]],
    ],
    decay: 9,
    bright: 0.55,
    kick: 0.55,
    hat: 0.22,
    swing: 0.12,
  },
  {
    mood: "epic",
    bpm: 120,
    file: "music_epic.wav",
    // Minor, wide, sustained.
    chords: [
      ["D", 4, [0, 3, 7]],
      ["B", 3, [0, 3, 7]],
      ["G", 3, [0, 4, 7]],
      ["A", 3, [0, 4, 7]],
    ],
    decay: 2.6,
    bright: 0.9,
    kick: 0.9,
    hat: 0.12,
    swing: 0,
  },
  {
    mood: "spooky",
    bpm: 90,
    file: "music_spooky.wav",
    // Diminished / off-kilter, toy-piano register.
    chords: [
      ["A", 5, [0, 3, 6]],
      ["A", 5, [0, 3, 6]],
      ["G", 5, [0, 3, 6]],
      ["F", 5, [0, 1, 6]],
    ],
    decay: 6,
    bright: 0.35,
    kick: 0.35,
    hat: 0.3,
    swing: 0.2,
  },
  {
    mood: "bouncy",
    bpm: 140,
    file: "music_bouncy.wav",
    // Low, comic, tuba-ish root movement.
    chords: [
      ["C", 3, [0, 7, 12]],
      ["C", 3, [0, 7, 12]],
      ["F", 3, [0, 7, 12]],
      ["G", 3, [0, 7, 12]],
    ],
    decay: 5,
    bright: 1.0,
    kick: 1.0,
    hat: 0.18,
    swing: 0.18,
  },
];

const BEATS_PER_BAR = 4;
const BARS = 4;

function renderMusic(spec) {
  const beat = 60 / spec.bpm;
  const totalBeats = BEATS_PER_BAR * BARS;
  // Exactly a whole number of bars, so the loop point is seamless and the
  // track length is an exact multiple of the beat.
  const length = Math.round(beat * totalBeats * RATE);
  const buffer = new Float64Array(length);
  const noise = makeNoise(0xbeef + spec.bpm);

  for (let b = 0; b < totalBeats; b++) {
    const bar = Math.floor(b / BEATS_PER_BAR);
    const [root, octave, intervals] = spec.chords[bar % spec.chords.length];
    const beatStart = Math.round(b * beat * RATE);

    // Chord voice on every beat; arpeggiate the upper notes on the offbeat.
    intervals.forEach((semi, voice) => {
      const f = hz(root, octave, semi);
      const offset = voice === 0 ? 0 : Math.round(beat * RATE * (voice * 0.5 * spec.swing));
      addAt(buffer, beatStart + offset, Math.round(beat * RATE * 1.6), (t) =>
        0.28 * tone(f, t, spec.decay, spec.bright)
      );
    });

    // Kick on the downbeat of each half-bar.
    if (b % 2 === 0) {
      addAt(buffer, beatStart, Math.round(0.18 * RATE), (t) => {
        const f = 110 * Math.exp(-t * 28) + 45;
        return spec.kick * 0.5 * Math.sin(2 * Math.PI * f * t) * pluck(t, 22);
      });
    }
    // Hat on the offbeat.
    addAt(buffer, beatStart + Math.round(beat * RATE * 0.5), Math.round(0.06 * RATE), (t) =>
      spec.hat * 0.4 * noise() * pluck(t, 90)
    );
  }

  // Short crossfade of the tail into the head so looping is click-free.
  const fade = Math.round(0.02 * RATE);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    buffer[i] = buffer[i] * k + buffer[length - fade + i] * (1 - k);
  }
  return normalize(buffer);
}

// ---------------------------------------------------------------------------
// Foley
// ---------------------------------------------------------------------------

const SFX = [
  {
    id: "step",
    file: "sfx_step.wav",
    seconds: 0.3,
    render(buffer, noise) {
      addAt(buffer, 0, buffer.length, (t) => {
        const body = Math.sin(2 * Math.PI * (150 * Math.exp(-t * 30) + 70) * t);
        return 0.6 * body * pluck(t, 26) + 0.3 * noise() * pluck(t, 60);
      });
    },
  },
  {
    id: "whoosh",
    file: "sfx_whoosh.wav",
    seconds: 0.4,
    render(buffer, noise) {
      // Band-swept noise: a one-pole filter whose cutoff rises then falls.
      let low = 0;
      for (let i = 0; i < buffer.length; i++) {
        const t = i / RATE;
        const progress = t / (buffer.length / RATE);
        const cutoff = 0.02 + 0.35 * Math.sin(Math.PI * progress);
        low += cutoff * (noise() - low);
        const env = Math.sin(Math.PI * progress);
        buffer[i] += 0.9 * low * env * env;
      }
    },
  },
  {
    id: "bonk",
    file: "sfx_bonk.wav",
    seconds: 0.4,
    render(buffer, noise) {
      addAt(buffer, 0, buffer.length, (t) => {
        // Two inharmonic partials read as "hollow".
        const a = Math.sin(2 * Math.PI * 220 * t) * pluck(t, 12);
        const b = Math.sin(2 * Math.PI * 337 * t) * pluck(t, 18);
        return 0.55 * (a + 0.6 * b) + 0.12 * noise() * pluck(t, 80);
      });
    },
  },
];

function renderSfx(spec) {
  const buffer = new Float64Array(Math.round(spec.seconds * RATE));
  spec.render(buffer, makeNoise(0x51f + spec.id.length));
  // Fade the last 15ms so one-shots never click on release.
  const fade = Math.round(0.015 * RATE);
  for (let i = 0; i < fade; i++) {
    buffer[buffer.length - 1 - i] *= i / fade;
  }
  return normalize(buffer, 0.9);
}

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const manifest = [];

for (const spec of MOODS) {
  const samples = renderMusic(spec);
  writeFileSync(join(OUT, spec.file), encodeWav(samples));
  const seconds = samples.length / RATE;
  const beat = 60 / spec.bpm;
  manifest.push({
    kind: "music",
    mood: spec.mood,
    file: spec.file,
    bpm: spec.bpm,
    seconds: Number(seconds.toFixed(4)),
    bars: BARS,
    beatsExact: Math.abs(seconds / beat - BEATS_PER_BAR * BARS) < 1e-6,
  });
}

for (const spec of SFX) {
  const samples = renderSfx(spec);
  writeFileSync(join(OUT, spec.file), encodeWav(samples));
  manifest.push({
    kind: "sfx",
    id: spec.id,
    file: spec.file,
    seconds: Number((samples.length / RATE).toFixed(4)),
  });
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

for (const entry of manifest) {
  const label = entry.kind === "music" ? `${entry.mood} @ ${entry.bpm}bpm` : entry.id;
  console.log(`  ${entry.file.padEnd(24)} ${String(entry.seconds).padStart(7)}s  ${label}`);
}
console.log(`\n  ${manifest.length} files written to Assets/Audio/`);
