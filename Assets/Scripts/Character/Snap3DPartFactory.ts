import { Snap3D, Snap3DTypes } from "Remote Service Gateway.lspkg/HostedSnap/Snap3D";

import { Log, describeError } from "../Core/Log";
import { PartStage, progressForStage } from "../Logic/PartScaling";
import { PartSpec, RigPlan } from "../Logic/RigPlan";

/**
 * Generates every body part of a character with Snap3D, in parallel.
 *
 * Each part is its own text-to-3D job and each takes minutes, so the UI is
 * driven by per-part progress rather than a single spinner. There is no
 * placeholder mesh: if a part cannot be generated after one retry the whole
 * generation fails with the part named, because a puppet silently missing an
 * arm is worse than a visible error.
 */

export { PartStage };

export interface PartProgress {
  jointId: string;
  stage: PartStage;
  /** 0..1, coarse — Snap3D reports stages, not percentages. */
  progress: number;
  message: string;
}

export interface GeneratedParts {
  assets: Record<string, GltfAsset>;
  elapsedSeconds: number;
}

export class Snap3DPartFactory {
  private log = new Log("Snap3D");

  /**
   * @param refine ask Snap3D for the refined (textured) mesh. Slower, and the
   *        difference is very visible on camera, so it stays on by default.
   */
  constructor(private refine: boolean = true) {}

  async generate(
    plan: RigPlan,
    onProgress: (progress: PartProgress) => void
  ): Promise<GeneratedParts> {
    const startedAt = getTime();
    this.log.info(
      `generating ${plan.parts.length} parts for "${plan.description}" (${plan.archetype})`
    );

    for (const part of plan.parts) {
      onProgress({
        jointId: part.jointId,
        stage: "queued",
        progress: progressForStage("queued"),
        message: "queued",
      });
    }

    const results = await Promise.all(
      plan.parts.map((part) => this.generatePartWithRetry(part, onProgress))
    );

    const assets: Record<string, GltfAsset> = {};
    for (let i = 0; i < plan.parts.length; i++) {
      assets[plan.parts[i].jointId] = results[i];
    }

    const elapsedSeconds = getTime() - startedAt;
    this.log.info(`all ${plan.parts.length} parts ready in ${elapsedSeconds.toFixed(1)}s`);
    return { assets, elapsedSeconds };
  }

  private async generatePartWithRetry(
    part: PartSpec,
    onProgress: (progress: PartProgress) => void
  ): Promise<GltfAsset> {
    try {
      return await this.generatePart(part, onProgress);
    } catch (first) {
      this.log.warn(`part "${part.jointId}" failed, retrying once: ${describeError(first)}`);
      onProgress({
        jointId: part.jointId,
        stage: "queued",
        progress: progressForStage("queued"),
        message: "retrying",
      });
      try {
        return await this.generatePart(part, onProgress);
      } catch (second) {
        onProgress({
          jointId: part.jointId,
          stage: "failed",
          progress: 0,
          message: describeError(second),
        });
        throw new Error(
          `Snap3D could not generate "${part.jointId}": ${describeError(second)}`
        );
      }
    }
  }

  private generatePart(
    part: PartSpec,
    onProgress: (progress: PartProgress) => void
  ): Promise<GltfAsset> {
    return new Promise<GltfAsset>((resolve, reject) => {
      let settled = false;
      /** Best mesh seen so far, used if the job ends after the base mesh. */
      let bestAsset: GltfAsset | null = null;

      const report = (stage: PartStage, message: string) => {
        onProgress({
          jointId: part.jointId,
          stage,
          progress: progressForStage(stage),
          message,
        });
      };

      Snap3D.submitAndGetStatus({
        prompt: part.prompt,
        format: "glb",
        refine: this.refine,
        use_vertex_color: false,
      })
        .then((job) => {
          job.event.add((update) => {
            if (settled) {
              return;
            }
            const stage = update[0];
            const payload = update[1];

            if (stage === "failed") {
              settled = true;
              reject(new Error(readError(payload)));
              return;
            }
            if (stage === "image") {
              report("preview", "concept image ready");
              return;
            }

            const asset = readAsset(payload);
            if (!asset) {
              settled = true;
              reject(new Error(`stage "${stage}" returned no GLB`));
              return;
            }
            bestAsset = asset;

            if (stage === "base_mesh") {
              report("base_mesh", "base mesh ready");
              if (!this.refine) {
                settled = true;
                resolve(asset);
              }
              return;
            }
            if (stage === "refined_mesh") {
              settled = true;
              report("done", "ready");
              resolve(asset);
            }
          });
        })
        .catch((error) => {
          if (settled) {
            return;
          }
          // A submit-level failure after a usable base mesh still gives us a
          // puppet; anything earlier is a real failure.
          if (bestAsset) {
            settled = true;
            report("done", "using base mesh");
            resolve(bestAsset);
            return;
          }
          settled = true;
          reject(new Error(describeError(error)));
        });
    });
  }
}

function readAsset(payload: Snap3DTypes.AssetPayload | string): GltfAsset | null {
  if (typeof payload === "string") {
    return null;
  }
  return payload.gltfAsset ? payload.gltfAsset : null;
}

function readError(payload: Snap3DTypes.AssetPayload | string): string {
  if (typeof payload === "string") {
    return payload;
  }
  return payload.errorMsg ? payload.errorMsg : "generation failed";
}
