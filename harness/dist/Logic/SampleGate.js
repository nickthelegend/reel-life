import { poseDelta } from "./Clip.js";
/**
 * The sampling policy for a live performance take.
 *
 * This used to live inside PoseRecorder, which is engine-bound — so the one
 * piece of it that is pure decision-making ("should this frame be recorded?")
 * could not be tested or reused. It is a policy, not plumbing: it decides the
 * capture rate, drops frames where nothing moved, and guarantees a held pose
 * still gets recorded often enough to survive interpolation.
 *
 * The gate is driven by whatever frame clock the host provides — the Lens
 * UpdateEvent on Spectacles, requestAnimationFrame in a browser — and is
 * purely time-based, so it produces the same take regardless of how fast or
 * irregularly that clock ticks.
 */
/** Fast enough to catch a gesture, slow enough to stay light. */
export const PERFORMANCE_SAMPLE_HZ = 12;
/** Poses this similar to the last recorded one are dropped. */
export const IDLE_POSITION_EPSILON_CM = 0.2;
export const IDLE_ANGLE_EPSILON_RAD = 0.01;
/** ...but never leave a gap longer than this, so held poses still read. */
export const MAX_SAMPLE_GAP_SECONDS = 1;
export class SampleGate {
    constructor(hz = PERFORMANCE_SAMPLE_HZ) {
        this.startedAt = 0;
        this.lastSampleTime = Number.NEGATIVE_INFINITY;
        this.lastPose = null;
        this.interval = 1 / (hz > 0 ? hz : PERFORMANCE_SAMPLE_HZ);
    }
    /** Begin a take at `now`. */
    start(now) {
        this.startedAt = now;
        this.lastSampleTime = Number.NEGATIVE_INFINITY;
        this.lastPose = null;
    }
    /** Seconds since the take began. */
    elapsed(now) {
        return Math.max(0, now - this.startedAt);
    }
    /**
     * Decide whether `pose` should be recorded at `now`, and commit the decision.
     * Calling this is what advances the gate, so call it once per frame.
     */
    offer(now, pose) {
        const elapsed = this.elapsed(now);
        if (now - this.lastSampleTime < this.interval) {
            return { record: false, elapsed, reason: "too-soon" };
        }
        if (this.lastPose) {
            const delta = poseDelta(this.lastPose, pose);
            const still = delta.maxPosition < IDLE_POSITION_EPSILON_CM &&
                delta.maxAngle < IDLE_ANGLE_EPSILON_RAD;
            const gap = now - this.lastSampleTime;
            if (still && gap < MAX_SAMPLE_GAP_SECONDS) {
                return { record: false, elapsed, reason: "unchanged" };
            }
        }
        this.lastSampleTime = now;
        this.lastPose = pose;
        return { record: true, elapsed, reason: "recorded" };
    }
    /** Sample interval in seconds, for display. */
    intervalSeconds() {
        return this.interval;
    }
}
