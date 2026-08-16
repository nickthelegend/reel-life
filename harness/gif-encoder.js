/**
 * A real GIF89a encoder — LZW and all — with no dependencies.
 *
 * This exists because Reel Life's whole problem is that nobody can watch it.
 * There is no Lens Studio here and no Spectacles, so the performance can be
 * computed perfectly and still never reach a screen. Rendering the reel
 * straight to an animated GIF produces the one thing the project was missing:
 * an artefact you can drop into a submission, a README, or a chat window.
 *
 * GIF suits this content exactly. The stage is drawn from a handful of flat
 * colours, so a small exact palette is lossless, and GIF's per-frame delay maps
 * cleanly onto shooting on twos — each exposure becomes one frame held for the
 * right number of hundredths.
 */

// ---------------------------------------------------------------------------
// Byte stream
// ---------------------------------------------------------------------------

class ByteStream {
  constructor() {
    this.bytes = [];
  }
  byte(value) {
    this.bytes.push(value & 0xff);
    return this;
  }
  short(value) {
    return this.byte(value).byte(value >> 8);
  }
  string(text) {
    for (let i = 0; i < text.length; i++) this.byte(text.charCodeAt(i));
    return this;
  }
  raw(values) {
    for (const v of values) this.byte(v);
    return this;
  }
  toUint8Array() {
    return Uint8Array.from(this.bytes);
  }
}

// ---------------------------------------------------------------------------
// LZW, as GIF specifies it
// ---------------------------------------------------------------------------

/**
 * GIF's LZW differs from the textbook version in two ways that matter: codes
 * are written least-significant-bit first, and the code width grows only after
 * the dictionary passes the current limit. Getting either wrong produces a file
 * that decoders reject.
 */
function lzwCompress(indices, minimumCodeSize) {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;

  let codeSize = minimumCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = new Map();

  const out = [];
  let bitBuffer = 0;
  let bitCount = 0;

  const emit = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  const resetDictionary = () => {
    dictionary = new Map();
    codeSize = minimumCodeSize + 1;
    nextCode = endCode + 1;
  };

  emit(clearCode);
  resetDictionary();

  let current = indices.length > 0 ? String(indices[0]) : "";

  for (let i = 1; i < indices.length; i++) {
    const next = indices[i];
    const candidate = current + "," + next;

    if (dictionary.has(candidate)) {
      current = candidate;
      continue;
    }

    emit(codeFor(current, dictionary, clearCode));
    dictionary.set(candidate, nextCode++);

    if (nextCode > (1 << codeSize)) {
      if (codeSize < 12) {
        codeSize++;
      } else {
        emit(clearCode);
        resetDictionary();
      }
    }
    current = String(next);
  }

  if (current.length > 0) {
    emit(codeFor(current, dictionary, clearCode));
  }
  emit(endCode);

  if (bitCount > 0) {
    out.push(bitBuffer & 0xff);
  }
  return out;
}

/** Single indices are their own code; longer runs come from the dictionary. */
function codeFor(sequence, dictionary, clearCode) {
  if (dictionary.has(sequence)) {
    return dictionary.get(sequence);
  }
  const value = Number(sequence);
  if (!isFinite(value) || value >= clearCode) {
    throw new Error(`GIF encoder: no code for sequence "${sequence}"`);
  }
  return value;
}

/** Image data ships in sub-blocks of at most 255 bytes. */
function writeSubBlocks(stream, bytes) {
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    stream.byte(chunk.length).raw(chunk);
  }
  stream.byte(0);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * Build a palette from the frames themselves.
 *
 * The stage uses a handful of flat colours, so in practice every colour fits
 * and the encode is lossless. If a frame ever introduces more than 256, the
 * extras map to the nearest entry rather than failing.
 */
export function buildPalette(frames, maxColors = 256) {
  const counts = new Map();

  for (const frame of frames) {
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      // Quantize to 5 bits per channel so near-identical antialiasing shades
      // collapse together instead of exhausting the palette.
      const key =
        ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxColors);
  const palette = ordered.map(([key]) => [
    ((key >> 10) & 31) << 3,
    ((key >> 5) & 31) << 3,
    (key & 31) << 3,
  ]);

  while (palette.length < 2) {
    palette.push([0, 0, 0]);
  }
  return palette;
}

function paletteSizeFor(count) {
  let bits = 1;
  while (1 << bits < count) bits++;
  return { bits: Math.min(bits, 8), entries: 1 << Math.min(bits, 8) };
}

/** Map every pixel to its nearest palette entry. */
function toIndices(frame, palette, cache) {
  const data = frame.data;
  const indices = new Uint8Array(data.length / 4);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    let index = cache.get(key);

    if (index === undefined) {
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < palette.length; c++) {
        const dr = data[i] - palette[c][0];
        const dg = data[i + 1] - palette[c][1];
        const db = data[i + 2] - palette[c][2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = c;
        }
      }
      index = best;
      cache.set(key, index);
    }
    indices[p] = index;
  }
  return indices;
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/**
 * Encode ImageData frames into an animated GIF.
 *
 * @param frames    ImageData, all the same size
 * @param delaysMs  per-frame delay in milliseconds
 * @param loop      true for an infinite loop
 * @returns Uint8Array of GIF89a bytes
 */
export function encodeGif(frames, delaysMs, loop = true) {
  if (frames.length === 0) {
    throw new Error("GIF encoder: no frames to encode");
  }
  const width = frames[0].width;
  const height = frames[0].height;

  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height) {
      throw new Error("GIF encoder: every frame must be the same size");
    }
  }

  const palette = buildPalette(frames);
  const { bits, entries } = paletteSizeFor(palette.length);
  const stream = new ByteStream();

  // Header + logical screen descriptor with a global colour table.
  stream.string("GIF89a").short(width).short(height);
  stream.byte(0x80 | (bits - 1)).byte(0).byte(0);

  for (let i = 0; i < entries; i++) {
    const rgb = palette[i] || [0, 0, 0];
    stream.byte(rgb[0]).byte(rgb[1]).byte(rgb[2]);
  }

  // Netscape application extension — the only way to say "loop forever".
  if (loop) {
    stream.byte(0x21).byte(0xff).byte(11).string("NETSCAPE2.0");
    stream.byte(3).byte(1).short(0).byte(0);
  }

  const cache = new Map();
  const minimumCodeSize = Math.max(2, bits);

  for (let i = 0; i < frames.length; i++) {
    // GIF delays are in hundredths of a second, and most decoders treat 0 or 1
    // as "as fast as possible", so anything real is clamped to 2.
    const delay = Math.max(2, Math.round((delaysMs[i] || 100) / 10));

    stream.byte(0x21).byte(0xf9).byte(4);
    stream.byte(0x04); // dispose: restore to background
    stream.short(delay).byte(0).byte(0);

    stream.byte(0x2c).short(0).short(0).short(width).short(height).byte(0);
    stream.byte(minimumCodeSize);

    const indices = toIndices(frames[i], palette, cache);
    writeSubBlocks(stream, lzwCompress(indices, minimumCodeSize));
  }

  stream.byte(0x3b); // trailer
  return stream.toUint8Array();
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Parse back the structural facts of a GIF we produced.
 *
 * Used to prove an export is a real, well-formed GIF rather than trusting that
 * the writer did the right thing.
 */
export function inspectGif(bytes) {
  if (bytes.length < 14) {
    throw new Error("not a GIF: too short");
  }
  const signature = String.fromCharCode(...bytes.slice(0, 6));
  if (signature !== "GIF89a") {
    throw new Error(`not a GIF89a: got "${signature}"`);
  }

  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const packed = bytes[10];
  const paletteEntries = 1 << ((packed & 0x07) + 1);

  let i = 13 + (packed & 0x80 ? paletteEntries * 3 : 0);
  let frames = 0;
  let loops = false;
  const delays = [];

  while (i < bytes.length) {
    const marker = bytes[i];

    if (marker === 0x3b) {
      break;
    }
    if (marker === 0x21) {
      const label = bytes[i + 1];
      if (label === 0xf9) {
        delays.push((bytes[i + 4] | (bytes[i + 5] << 8)) * 10);
      }
      if (label === 0xff) {
        loops = true;
      }
      i += 2;
      while (i < bytes.length && bytes[i] !== 0) {
        i += bytes[i] + 1;
      }
      i++;
      continue;
    }
    if (marker === 0x2c) {
      frames++;
      const localPacked = bytes[i + 9];
      i += 10 + (localPacked & 0x80 ? (1 << ((localPacked & 0x07) + 1)) * 3 : 0);
      i++; // minimum code size
      while (i < bytes.length && bytes[i] !== 0) {
        i += bytes[i] + 1;
      }
      i++;
      continue;
    }
    throw new Error(`unexpected byte 0x${marker.toString(16)} at ${i}`);
  }

  return {
    signature,
    width,
    height,
    paletteEntries,
    frames,
    loops,
    delaysMs: delays,
    bytes: bytes.length,
    trailerPresent: bytes[bytes.length - 1] === 0x3b,
  };
}
