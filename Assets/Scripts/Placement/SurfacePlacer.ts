import { Log } from "../Core/Log";

/**
 * Point-pause-confirm placement onto a real surface.
 *
 * World Query's depth data refreshes at roughly 5Hz, so this deliberately does
 * NOT try to track a moving hand. It ray-casts on a fixed slow cadence, eases
 * the reticle toward the last hit, and only reports "ready" once the hit point
 * has held still for a moment. The interaction is designed around the data rate
 * instead of fighting it.
 */

export interface PlacementHit {
  position: vec3;
  normal: vec3;
}

export interface PlacementCallbacks {
  onReadyChanged: (ready: boolean) => void;
  onStatus: (message: string) => void;
}

/** Seconds between ray-casts. Matches the depth refresh rate. */
const HIT_TEST_INTERVAL = 0.2;

/** How still the hit point must be, in cm, to count as settled. */
const STABLE_RADIUS_CM = 4;

/** How long it must stay that still. */
const STABLE_HOLD_SECONDS = 0.5;

/** How far ahead of the user we look for a surface. */
const RAY_LENGTH_CM = 400;

export class SurfacePlacer {
  private log = new Log("Placement");
  private session: HitTestSession | null = null;
  private active = false;

  private lastTestTime = 0;
  private latestHit: PlacementHit | null = null;
  private stableSince = -1;
  private ready = false;

  constructor(
    private worldQuery: WorldQueryModule,
    private cameraObject: SceneObject,
    private reticle: SceneObject,
    private callbacks: PlacementCallbacks
  ) {}

  begin(): void {
    if (this.active) {
      return;
    }
    if (!this.session) {
      const options = HitTestSessionOptions.create();
      // Reject low-confidence hits: a character dropped into a hole in the
      // depth map is worse than asking the user to look again.
      options.filter = true;
      this.session = this.worldQuery.createHitTestSessionWithOptions(options);
    }

    this.active = true;
    this.ready = false;
    this.latestHit = null;
    this.stableSince = -1;
    this.reticle.enabled = true;
    this.session.start();
    this.callbacks.onStatus("Look at a table or the floor");
    this.log.info("placement started");
  }

  end(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.reticle.enabled = false;
    if (this.session) {
      this.session.stop();
    }
    this.setReady(false);
  }

  isActive(): boolean {
    return this.active;
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Call every frame while placing. */
  update(now: number): void {
    if (!this.active || !this.session) {
      return;
    }

    if (now - this.lastTestTime >= HIT_TEST_INTERVAL) {
      this.lastTestTime = now;
      this.castRay();
    }

    if (this.latestHit) {
      this.easeReticleToward(this.latestHit);
      if (this.stableSince >= 0 && now - this.stableSince >= STABLE_HOLD_SECONDS) {
        this.setReady(true);
      }
    }
  }

  /** The confirmed spot, or null if the user has not held still on a surface. */
  confirm(): PlacementHit | null {
    if (!this.ready || !this.latestHit) {
      this.callbacks.onStatus("Hold still on a surface first");
      return null;
    }
    const hit = this.latestHit;
    this.end();
    this.log.info(
      `placed at (${hit.position.x.toFixed(1)}, ${hit.position.y.toFixed(1)}, ${hit.position.z.toFixed(1)})`
    );
    return hit;
  }

  private castRay(): void {
    const transform = this.cameraObject.getTransform();
    const origin = transform.getWorldPosition();
    // transform.forward points backwards out of the camera in Lens Studio.
    const direction = transform.forward.uniformScale(-1);
    const target = origin.add(direction.uniformScale(RAY_LENGTH_CM));

    this.session!.hitTest(origin, target, (result) => {
      if (!this.active) {
        return;
      }
      if (!result) {
        this.latestHit = null;
        this.stableSince = -1;
        this.setReady(false);
        this.callbacks.onStatus("No surface found — try a table or the floor");
        return;
      }

      const moved =
        this.latestHit === null
          ? Infinity
          : result.position.distance(this.latestHit.position);

      this.latestHit = { position: result.position, normal: result.normal };

      if (moved > STABLE_RADIUS_CM) {
        this.stableSince = getTime();
        this.setReady(false);
        this.callbacks.onStatus("Hold still to place");
      } else if (this.stableSince < 0) {
        this.stableSince = getTime();
      }
    });
  }

  private easeReticleToward(hit: PlacementHit): void {
    const transform = this.reticle.getTransform();
    const current = transform.getWorldPosition();
    // Smoothing hides the 5Hz stepping without pretending to track faster.
    const eased = current.add(hit.position.sub(current).uniformScale(0.25));
    transform.setWorldPosition(eased);
    transform.setWorldRotation(quat.lookAt(hit.normal, vec3.up()));
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }
    this.ready = ready;
    this.callbacks.onReadyChanged(ready);
    if (ready) {
      this.callbacks.onStatus("Pinch to drop your character here");
    }
  }
}
