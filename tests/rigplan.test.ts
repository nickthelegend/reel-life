import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  buildRigPlan,
  detectAccessory,
  detectArchetype,
  detectStyleTokens,
  extractSubject,
  jointsInBuildOrder,
  poseableJointIds,
} from "../Assets/Scripts/Logic/RigPlan";

test("a clay dragon in a top hat becomes a winged biped", () => {
  const plan = buildRigPlan("a clay dragon in a top hat");
  assert.equal(plan.archetype, "winged_biped");
  assert.equal(plan.accessory, "top hat");
  assert.equal(plan.subject, "clay dragon");
  assert.ok(plan.styleTokens.indexOf("clay") >= 0);
});

test("the accessory is attached to the head part only", () => {
  const plan = buildRigPlan("a clay dragon in a top hat");
  const head = plan.parts.filter((p) => p.jointId === "head")[0];
  const torso = plan.parts.filter((p) => p.jointId === "torso")[0];
  assert.ok(head.prompt.indexOf("top hat") >= 0, head.prompt);
  assert.equal(torso.prompt.indexOf("top hat"), -1, torso.prompt);
});

test("every part prompt carries the shared style so meshes match", () => {
  const plan = buildRigPlan("a wooden robot knight");
  for (const part of plan.parts) {
    assert.ok(part.prompt.indexOf("wood") >= 0, `missing style: ${part.prompt}`);
    assert.ok(
      part.prompt.indexOf("isolated single object") >= 0,
      `missing isolation directive: ${part.prompt}`
    );
  }
});

test("part count stays inside the generation budget", () => {
  const descriptions = [
    "a clay dragon in a top hat",
    "a felt fox",
    "an owl made of paper",
    "a slime blob",
    "a knight",
  ];
  for (const description of descriptions) {
    const plan = buildRigPlan(description);
    assert.ok(plan.parts.length <= 7, `${description} -> ${plan.parts.length} parts`);
    assert.ok(plan.parts.length >= 3, `${description} -> ${plan.parts.length} parts`);
  }
});

test("archetypes are picked from the description", () => {
  assert.equal(detectArchetype("a felt fox"), "quadruped");
  assert.equal(detectArchetype("a paper owl"), "bird");
  assert.equal(detectArchetype("a green slime"), "blob");
  assert.equal(detectArchetype("a tiny knight"), "biped");
  assert.equal(detectArchetype("a bat with wings"), "winged_biped");
});

test("style defaults to claymation when nothing is specified", () => {
  assert.deepEqual(detectStyleTokens("a tiny knight"), ["clay", "claymation"]);
});

test("accessory phrasing variants are all recognised", () => {
  assert.equal(detectAccessory("a dragon wearing a top hat"), "top hat");
  assert.equal(detectAccessory("a dragon in a top hat"), "top hat");
  assert.equal(detectAccessory("a dragon with a tiny umbrella"), "tiny umbrella");
  assert.equal(detectAccessory("a plain dragon"), null);
});

test("subject strips the article and the accessory clause", () => {
  assert.equal(extractSubject("a clay dragon wearing a top hat"), "clay dragon");
  assert.equal(extractSubject("the wooden robot"), "wooden robot");
});

test("joints build parents-first", () => {
  const plan = buildRigPlan("a clay dragon in a top hat");
  const ordered = jointsInBuildOrder(plan);
  assert.equal(ordered.length, plan.joints.length);

  const seen: Record<string, boolean> = {};
  for (const joint of ordered) {
    if (joint.parent !== null) {
      assert.ok(seen[joint.parent], `${joint.id} built before parent ${joint.parent}`);
    }
    seen[joint.id] = true;
  }
});

test("every part hangs off a joint that exists", () => {
  const plan = buildRigPlan("a felt fox");
  const ids = plan.joints.map((j) => j.id);
  for (const part of plan.parts) {
    assert.ok(ids.indexOf(part.jointId) >= 0, `orphan part on ${part.jointId}`);
  }
});

test("the root is not poseable but the spine is", () => {
  const plan = buildRigPlan("a knight");
  const poseable = poseableJointIds(plan);
  assert.equal(poseable.indexOf("root"), -1);
  for (const id of ["hips", "torso", "neck", "head"]) {
    assert.ok(poseable.indexOf(id) >= 0, `${id} should be poseable`);
  }
});

test("an empty description is rejected rather than producing an empty rig", () => {
  assert.throws(() => buildRigPlan("   "), /description is empty/);
});
