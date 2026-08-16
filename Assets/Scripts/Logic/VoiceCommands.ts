/**
 * Hands-free editing.
 *
 * Your hands are holding a puppet. Reaching for a button means letting go of
 * the pose you just set — so the same microphone that describes a character
 * also drives the editor: "capture", "play it back", "undo that", "on twos".
 *
 * The hard requirement is the opposite of recognition: a character description
 * must NEVER be mistaken for a command. "a clay dragon in a top hat" contains
 * the word "top", and a naive matcher would happily fire something. So a
 * command has to be short AND match a known phrase, and anything else falls
 * through to being treated as a description.
 */

export type CommandKind =
  | "capture"
  | "new_take"
  | "play"
  | "stop"
  | "undo"
  | "redo"
  | "delete_last"
  | "mirror"
  | "reverse"
  | "smooth"
  | "loop"
  | "faster"
  | "slower"
  | "shoot_mode"
  | "next_mood"
  | "onion"
  | "none";

export interface VoiceCommand {
  kind: CommandKind;
  /** 0..1. Anything below ACCEPT_CONFIDENCE is treated as a description. */
  confidence: number;
  /** The utterance that produced it, for the status line. */
  heard: string;
}

/** Longer than this and it is a character description, not a command. */
export const MAX_COMMAND_WORDS = 5;

export const ACCEPT_CONFIDENCE = 0.6;

interface Phrase {
  kind: CommandKind;
  /** Exact utterances, highest confidence. */
  exact: string[];
  /** Words that must all be present for a weaker match. */
  contains?: string[][];
}

const PHRASES: Phrase[] = [
  {
    kind: "capture",
    exact: ["capture", "capture pose", "snap", "take it", "shoot it", "frame"],
    contains: [["capture", "pose"], ["capture", "that"]],
  },
  {
    kind: "new_take",
    exact: ["new take", "next take", "done", "finish take", "cut"],
    contains: [["new", "take"]],
  },
  {
    kind: "play",
    exact: ["play", "play it", "play it back", "play reel", "playback", "roll it"],
    contains: [["play", "back"], ["play", "reel"]],
  },
  {
    kind: "stop",
    exact: ["stop", "pause", "halt", "cut it"],
  },
  {
    kind: "undo",
    exact: ["undo", "undo that", "go back", "oops", "revert"],
    contains: [["undo"]],
  },
  {
    kind: "redo",
    exact: ["redo", "redo that", "put it back"],
    contains: [["redo"]],
  },
  {
    kind: "delete_last",
    exact: ["delete", "delete that", "delete last", "delete last take", "scrap that", "bin it"],
    contains: [["delete", "take"], ["delete", "last"]],
  },
  {
    kind: "mirror",
    exact: ["mirror", "mirror that", "flip it", "flip that", "other side"],
    contains: [["mirror"]],
  },
  {
    kind: "reverse",
    exact: ["reverse", "reverse it", "backwards", "play backwards", "rewind it"],
    contains: [["reverse"]],
  },
  {
    kind: "smooth",
    exact: ["smooth", "smooth it", "smooth that", "clean it up", "steady it"],
    contains: [["smooth"]],
  },
  {
    kind: "loop",
    exact: ["loop", "loop it", "make it loop", "close the loop", "cycle it"],
    contains: [["loop"]],
  },
  {
    kind: "faster",
    exact: ["faster", "speed up", "quicker", "double speed"],
    contains: [["speed", "up"]],
  },
  {
    kind: "slower",
    exact: ["slower", "slow down", "half speed", "slow it down"],
    contains: [["slow", "down"]],
  },
  {
    kind: "shoot_mode",
    exact: ["on twos", "on threes", "on ones", "shoot on twos", "twos", "change frame rate"],
    contains: [["shoot", "on"], ["on", "twos"], ["on", "threes"]],
  },
  {
    kind: "next_mood",
    exact: ["change the music", "next mood", "new music", "change music", "different music"],
    contains: [["change", "music"], ["next", "mood"]],
  },
  {
    kind: "onion",
    exact: ["onion", "onion skin", "show ghosts", "hide ghosts", "toggle onion"],
    contains: [["onion"]],
  },
];

export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text: string): string[] {
  return text.length === 0 ? [] : text.split(" ");
}

const NO_COMMAND = (heard: string): VoiceCommand => ({
  kind: "none",
  confidence: 0,
  heard,
});

/**
 * Parse an utterance into an editor command, or `none` if it should be treated
 * as a character description instead.
 */
export function parseVoiceCommand(text: string): VoiceCommand {
  const normalized = normalizeUtterance(text || "");
  if (normalized.length === 0) {
    return NO_COMMAND(text || "");
  }

  const parts = words(normalized);
  if (parts.length > MAX_COMMAND_WORDS) {
    // Long utterances are descriptions. This is the guard that stops "a clay
    // dragon holding a tiny stop sign" from firing the stop command.
    return NO_COMMAND(text);
  }

  for (const phrase of PHRASES) {
    if (phrase.exact.indexOf(normalized) >= 0) {
      return { kind: phrase.kind, confidence: 1, heard: text };
    }
  }

  for (const phrase of PHRASES) {
    if (!phrase.contains) {
      continue;
    }
    for (const group of phrase.contains) {
      if (group.every((word) => parts.indexOf(word) >= 0)) {
        // Weaker: the words are present but the phrasing is not one we know.
        return { kind: phrase.kind, confidence: 0.75, heard: text };
      }
    }
  }

  return NO_COMMAND(text);
}

export function isCommand(command: VoiceCommand): boolean {
  return command.kind !== "none" && command.confidence >= ACCEPT_CONFIDENCE;
}

/** Every phrase the app understands, for the help overlay. */
export function commandExamples(): Array<{ kind: CommandKind; say: string }> {
  return PHRASES.map((phrase) => ({ kind: phrase.kind, say: phrase.exact[0] }));
}
