/**
 * Deterministic id generation.
 *
 * Ids used to come from Date.now() plus Math.random(), which made saved reels
 * impossible to diff and tests impossible to write against real ids. A seeded
 * counter per session gives ids that are unique, sortable, and reproducible —
 * so a recorded demo replays identically every time.
 */
export class IdFactory {
    constructor(sessionSeed) {
        this.sessionSeed = sessionSeed;
        this.counters = {};
    }
    next(prefix) {
        const n = (this.counters[prefix] || 0) + 1;
        this.counters[prefix] = n;
        return `${prefix}-${this.sessionSeed}-${n}`;
    }
    /** Current count for a prefix, used for user-facing numbering ("Take 3"). */
    count(prefix) {
        return this.counters[prefix] || 0;
    }
    /** Restore counters after loading a reel so new ids never collide. */
    observe(id) {
        const parts = id.split("-");
        if (parts.length < 3) {
            return;
        }
        const prefix = parts[0];
        const n = parseInt(parts[parts.length - 1], 10);
        if (isFinite(n) && n > (this.counters[prefix] || 0)) {
            this.counters[prefix] = n;
        }
    }
}
/**
 * A short, human-readable seed from a timestamp. Base36 milliseconds keeps it
 * to ~8 characters while staying unique across sessions.
 */
export function sessionSeedFromTime(epochMs) {
    return Math.floor(epochMs).toString(36);
}
