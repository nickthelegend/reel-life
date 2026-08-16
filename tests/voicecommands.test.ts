import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  MAX_COMMAND_WORDS,
  commandExamples,
  isCommand,
  normalizeUtterance,
  parseVoiceCommand,
} from "../Assets/Scripts/Logic/VoiceCommands";

test("plain commands are recognised", () => {
  const cases: Array<[string, string]> = [
    ["capture", "capture"],
    ["capture pose", "capture"],
    ["play it back", "play"],
    ["stop", "stop"],
    ["undo", "undo"],
    ["undo that", "undo"],
    ["redo", "redo"],
    ["new take", "new_take"],
    ["delete last take", "delete_last"],
    ["mirror that", "mirror"],
    ["reverse it", "reverse"],
    ["smooth it", "smooth"],
    ["loop it", "loop"],
    ["faster", "faster"],
    ["slow down", "slower"],
    ["on twos", "shoot_mode"],
    ["change the music", "next_mood"],
    ["onion skin", "onion"],
  ];

  for (const [said, expected] of cases) {
    const command = parseVoiceCommand(said);
    assert.equal(command.kind, expected, `"${said}" -> ${command.kind}`);
    assert.ok(isCommand(command), `"${said}" was not confident enough`);
  }
});

test("punctuation and casing do not matter", () => {
  assert.equal(parseVoiceCommand("Undo, that!").kind, "undo");
  assert.equal(parseVoiceCommand("  PLAY IT BACK  ").kind, "play");
  assert.equal(normalizeUtterance("  Play   it Back!  "), "play it back");
});

test("looser phrasings match with lower confidence", () => {
  const command = parseVoiceCommand("just undo");
  assert.equal(command.kind, "undo");
  assert.ok(command.confidence < 1 && command.confidence >= 0.6);
});

// --- the part that actually matters ----------------------------------------

test("character descriptions are never mistaken for commands", () => {
  const descriptions = [
    "a clay dragon in a top hat",
    "a wooden robot knight holding a tiny stop sign",
    "a felt fox that plays the drums",
    "an owl made of folded paper",
    "a slime blob wearing sunglasses",
    "a bear cub reversing a small truck",
    "a penguin doing a loop the loop in the snow",
    "a mirror ball with legs and a smile",
  ];

  for (const description of descriptions) {
    const command = parseVoiceCommand(description);
    assert.equal(
      command.kind,
      "none",
      `"${description}" was misread as ${command.kind}`
    );
    assert.equal(isCommand(command), false);
  }
});

test("anything longer than a short phrase is treated as a description", () => {
  const longButCommandLike = "please could you undo that last thing for me";
  assert.ok(longButCommandLike.split(" ").length > MAX_COMMAND_WORDS);
  assert.equal(parseVoiceCommand(longButCommandLike).kind, "none");
});

test("a short description that shares a command word still loses", () => {
  // "stop" appears, but as part of a five-word noun phrase.
  assert.equal(parseVoiceCommand("a red stop sign puppet").kind, "none");
});

test("empty or whitespace input is not a command", () => {
  assert.equal(parseVoiceCommand("").kind, "none");
  assert.equal(parseVoiceCommand("   ").kind, "none");
  assert.equal(parseVoiceCommand("banana").kind, "none");
});

test("the utterance is carried through for the status line", () => {
  assert.equal(parseVoiceCommand("Undo that!").heard, "Undo that!");
  assert.equal(parseVoiceCommand("a clay dragon").heard, "a clay dragon");
});

test("every command kind has at least one example to show the user", () => {
  const examples = commandExamples();
  assert.ok(examples.length >= 15);

  for (const example of examples) {
    const parsed = parseVoiceCommand(example.say);
    assert.equal(
      parsed.kind,
      example.kind,
      `the help text says "${example.say}" but that parses to ${parsed.kind}`
    );
    assert.equal(parsed.confidence, 1);
  }
});

test("no two command kinds claim the same exact phrase", () => {
  const seen: Record<string, string> = {};
  for (const example of commandExamples()) {
    assert.equal(seen[example.say], undefined, `"${example.say}" is ambiguous`);
    seen[example.say] = example.kind;
  }
});
