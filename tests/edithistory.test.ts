import { strict as assert } from "node:assert";
import { test } from "node:test";

import { Clip, appendKeyframe, createClip } from "../Assets/Scripts/Logic/Clip";
import { EditHistory } from "../Assets/Scripts/Logic/EditHistory";
import { PoseSample } from "../Assets/Scripts/Logic/PoseTypes";
import { Q_IDENTITY, v3 } from "../Assets/Scripts/Logic/Vec";

function pose(x: number): PoseSample {
  return { torso: { p: v3(x, 0, 0), r: { ...Q_IDENTITY } } };
}

function take(id: string, positions: number[]): Clip {
  const clip = createClip(id, id, "stopmotion");
  positions.forEach((x, i) => appendKeyframe(clip, { t: i * 0.4, joints: pose(x) }));
  return clip;
}

test("undo walks back through committed states", () => {
  const history = new EditHistory();
  history.commit("start", []);
  history.commit("add Take 1", [take("a", [0, 10])]);
  history.commit("add Take 2", [take("a", [0, 10]), take("b", [20, 30])]);

  assert.equal(history.current()!.clips.length, 2);
  assert.equal(history.undo()!.clips.length, 1);
  assert.equal(history.undo()!.clips.length, 0);
  assert.equal(history.undo(), null, "cannot undo past the first state");
});

test("redo walks forward again", () => {
  const history = new EditHistory();
  history.commit("start", []);
  history.commit("add Take 1", [take("a", [0, 10])]);

  history.undo();
  assert.ok(history.canRedo());
  assert.equal(history.redo()!.clips.length, 1);
  assert.equal(history.redo(), null);
});

test("committing after an undo discards the redo tail", () => {
  const history = new EditHistory();
  history.commit("start", []);
  history.commit("add Take 1", [take("a", [0, 10])]);
  history.commit("add Take 2", [take("a", [0, 10]), take("b", [20, 30])]);

  history.undo();
  assert.ok(history.canRedo());

  history.commit("trim Take 1", [take("a", [0, 10, 20])]);
  assert.equal(history.canRedo(), false, "the discarded future must not come back");
  assert.equal(history.current()!.label, "trim Take 1");
});

test("history is isolated — mutating what you get back cannot corrupt it", () => {
  const history = new EditHistory();
  const clips = [take("a", [0, 10])];
  history.commit("start", clips);

  // Mutate the array the caller still holds.
  clips[0].keyframes[0].joints.torso.p.x = 999;
  clips.push(take("b", [1, 2]));
  assert.equal(history.current()!.clips.length, 1);
  assert.equal(history.current()!.clips[0].keyframes[0].joints.torso.p.x, 0);

  // Mutate what undo/current handed out.
  const restored = history.current()!;
  restored.clips[0].keyframes[0].joints.torso.p.x = -50;
  assert.equal(history.current()!.clips[0].keyframes[0].joints.torso.p.x, 0);
});

test("the stack is bounded and drops the oldest states", () => {
  const history = new EditHistory(5);
  for (let i = 0; i < 12; i++) {
    history.commit(`edit ${i}`, [take("a", [i])]);
  }
  assert.equal(history.depth(), 5);
  assert.equal(history.current()!.label, "edit 11");

  let steps = 0;
  while (history.undo()) {
    steps++;
  }
  assert.equal(steps, 4, "five states means four undos");
});

test("labels describe what undo and redo would do", () => {
  const history = new EditHistory();
  history.commit("start", []);
  history.commit("trim Take 1", [take("a", [0, 10])]);

  assert.equal(history.undoLabel(), "trim Take 1");
  assert.equal(history.redoLabel(), null);

  history.undo();
  assert.equal(history.undoLabel(), null);
  assert.equal(history.redoLabel(), "trim Take 1");
});

test("an empty history undoes and redoes nothing", () => {
  const history = new EditHistory();
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
  assert.equal(history.current(), null);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
});

test("clearing resets the stack", () => {
  const history = new EditHistory();
  history.commit("start", []);
  history.commit("edit", [take("a", [0, 10])]);
  history.clear();

  assert.equal(history.depth(), 0);
  assert.equal(history.current(), null);
});

test("undo restores trim state, not just the clip list", () => {
  const history = new EditHistory();
  const clip = take("a", [0, 10, 20, 30]);
  history.commit("record", [clip]);

  const trimmed = take("a", [0, 10, 20, 30]);
  trimmed.trimIn = 1;
  trimmed.trimOut = 2;
  history.commit("trim", [trimmed]);

  const back = history.undo()!;
  assert.equal(back.clips[0].trimIn, 0);
  assert.equal(back.clips[0].trimOut, 3);
});
