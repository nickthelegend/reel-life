import { ReelDocument, parseReel, serializeReel } from "./ReelDocument";

/**
 * Getting a reel out of the app and into someone else's hands.
 *
 * There is no cloud backend and no in-Lens video export, so the honest
 * shareable artefact is the reel document itself: every pose, the rig plan, the
 * tempo. Someone who receives it can rebuild the exact character from the
 * stored prompts and play the exact performance.
 *
 * Two carriers, one format:
 *  - a `.reel` file, for saving and sending
 *  - a URL fragment, for pasting a reel into a chat window
 *
 * The encoding is URL-safe base64 over the same JSON that persistence uses, so
 * a shared reel and a saved reel are byte-identical documents.
 */

export const REEL_FILE_EXTENSION = ".reel.json";

/** Conservative ceiling — beyond this a URL stops surviving copy/paste. */
export const MAX_URL_LENGTH = 8000;

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

export function toFileContents(doc: ReelDocument): string {
  // Pretty-printed: a shared reel should be readable and diffable.
  return JSON.stringify(JSON.parse(serializeReel(doc)), null, 2) + "\n";
}

export function fromFileContents(text: string): ReelDocument {
  return parseReel(text);
}

export function suggestedFileName(doc: ReelDocument): string {
  const slug = doc.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "reel"}${REEL_FILE_EXTENSION}`;
}

// ---------------------------------------------------------------------------
// URL-safe base64
// ---------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Encodes UTF-8 text as URL-safe base64 without padding.
 *
 * Implemented by hand rather than via btoa/Buffer: this module has to run in a
 * Lens, in a browser, and in Node, and none of those three share an encoder.
 */
export function encodeBase64Url(text: string): string {
  const bytes = utf8Bytes(text);
  let out = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;

    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 < 0 ? 0 : b1 >> 4)];
    if (b1 < 0) break;
    out += B64[((b1 & 15) << 2) | (b2 < 0 ? 0 : b2 >> 6)];
    if (b2 < 0) break;
    out += B64[b2 & 63];
  }
  return out;
}

export function decodeBase64Url(encoded: string): string {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < encoded.length; i++) {
    const value = B64.indexOf(encoded.charAt(i));
    if (value < 0) {
      throw new Error("Corrupt reel link: not valid URL-safe base64");
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return utf8String(bytes);
}

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);

    // Combine a surrogate pair into a single code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63)
      );
    }
  }
  return bytes;
}

function utf8String(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++];
    let code: number;

    if (b0 < 0x80) {
      code = b0;
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      code = ((b0 & 31) << 6) | (bytes[i++] & 63);
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      code = ((b0 & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    } else {
      code =
        ((b0 & 7) << 18) |
        ((bytes[i++] & 63) << 12) |
        ((bytes[i++] & 63) << 6) |
        (bytes[i++] & 63);
    }

    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

export interface ReelLink {
  fragment: string;
  length: number;
  /** False when the reel is too long to survive being pasted around. */
  withinUrlLimit: boolean;
}

export function toLinkFragment(doc: ReelDocument): ReelLink {
  const fragment = `reel=${encodeBase64Url(serializeReel(doc))}`;
  return {
    fragment,
    length: fragment.length,
    withinUrlLimit: fragment.length <= MAX_URL_LENGTH,
  };
}

/** Parse a reel out of a URL, a fragment, or the raw encoded payload. */
export function fromLinkFragment(input: string): ReelDocument {
  let payload = input.trim();

  const marker = payload.indexOf("reel=");
  if (marker >= 0) {
    payload = payload.slice(marker + 5);
  }
  const amp = payload.indexOf("&");
  if (amp >= 0) {
    payload = payload.slice(0, amp);
  }
  if (payload.length === 0) {
    throw new Error("Corrupt reel link: no reel data found");
  }

  return parseReel(decodeBase64Url(payload));
}
