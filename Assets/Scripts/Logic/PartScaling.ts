import { RigPlan } from "./RigPlan";

/**
 * How generated meshes are sized, and how generation progress is reported.
 *
 * Snap3D returns meshes at arbitrary scales, so every part has to be normalized
 * against its intended share of the character's height — without this a head
 * can arrive twice the size of the body it sits on. That calculation lived
 * inside CharacterAssembler next to the scene-graph work, so the one line that
 * decides whether the puppet looks right could not be tested.
 */

export interface ScaleResult {
  scale: number;
  /** False when the mesh had no measurable bounds; caller should not scale. */
  measured: boolean;
  reason: string;
}

/**
 * Uniform scale that makes a mesh of `measuredHeight` occupy its share of the
 * character. Refuses rather than guessing when the mesh cannot be measured.
 */
export function scaleForPart(
  measuredHeight: number,
  heightFraction: number,
  targetHeightCm: number
): ScaleResult {
  if (!isFinite(measuredHeight) || measuredHeight <= 0) {
    return { scale: 1, measured: false, reason: "mesh has no measurable bounds" };
  }
  if (!isFinite(heightFraction) || heightFraction <= 0) {
    return { scale: 1, measured: false, reason: "part has no height fraction" };
  }
  if (!isFinite(targetHeightCm) || targetHeightCm <= 0) {
    return { scale: 1, measured: false, reason: "character has no target height" };
  }
  return {
    scale: (heightFraction * targetHeightCm) / measuredHeight,
    measured: true,
    reason: "scaled to height fraction",
  };
}

/** Intended height of a part in cm, for sanity-checking an assembled rig. */
export function intendedPartHeight(plan: RigPlan, jointId: string): number {
  for (const part of plan.parts) {
    if (part.jointId === jointId) {
      return part.heightFraction * plan.targetHeightCm;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Generation progress
// ---------------------------------------------------------------------------

export type PartStage = "queued" | "preview" | "base_mesh" | "done" | "failed";

const STAGE_PROGRESS: Record<PartStage, number> = {
  queued: 0.05,
  preview: 0.35,
  base_mesh: 0.7,
  done: 1,
  failed: 0,
};

export function progressForStage(stage: PartStage): number {
  const value = STAGE_PROGRESS[stage];
  return value === undefined ? 0 : value;
}

/** Progress across a whole character, 0..1. */
export function overallProgress(stages: PartStage[]): number {
  if (stages.length === 0) {
    return 0;
  }
  let total = 0;
  for (const stage of stages) {
    total += progressForStage(stage);
  }
  return total / stages.length;
}

export interface GenerationSummary {
  done: number;
  failed: number;
  total: number;
  progress: number;
  /** True once every part has either landed or failed. */
  settled: boolean;
}

export function summarizeGeneration(stages: PartStage[]): GenerationSummary {
  let done = 0;
  let failed = 0;
  for (const stage of stages) {
    if (stage === "done") done++;
    else if (stage === "failed") failed++;
  }
  return {
    done,
    failed,
    total: stages.length,
    progress: overallProgress(stages),
    settled: stages.length > 0 && done + failed === stages.length,
  };
}

/** Retries allowed per part before the whole generation is failed. */
export const PART_RETRY_LIMIT = 1;

export function shouldRetry(attempt: number): boolean {
  return attempt < PART_RETRY_LIMIT;
}
