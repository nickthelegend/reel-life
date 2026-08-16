import { Log, describeError } from "../Core/Log.js";
import { parseReel, serializeReel, summarize, } from "../Logic/ReelDocument.js";
/**
 * Persistent storage for reels and recent characters.
 *
 * Backed by Lens Studio's persistentStorageSystem, which survives closing the
 * Lens and rebooting the device. Generated GLB binaries cannot be written to
 * persistent storage from inside a Lens, so what is stored is everything needed
 * to rebuild: the rig plan (including the exact Snap3D prompt for every part)
 * and every recorded pose.
 */
const INDEX_KEY = "reellife.index.v1";
const REEL_KEY_PREFIX = "reellife.reel.v1.";
const RECENT_RIGS_KEY = "reellife.recentRigs.v1";
const LAST_REEL_KEY = "reellife.lastReel.v1";
/** How many characters stay one tap away from being regenerated. */
export const RECENT_RIG_LIMIT = 3;
export class ReelStore {
    constructor() {
        this.log = new Log("Store");
    }
    get store() {
        return global.persistentStorageSystem.store;
    }
    // -------------------------------------------------------------------------
    // Reels
    // -------------------------------------------------------------------------
    listReels() {
        if (!this.store.has(INDEX_KEY)) {
            return [];
        }
        try {
            const parsed = JSON.parse(this.store.getString(INDEX_KEY));
            return Array.isArray(parsed) ? parsed : [];
        }
        catch (error) {
            this.log.error("reel index is unreadable, starting a fresh index", error);
            this.store.remove(INDEX_KEY);
            return [];
        }
    }
    saveReel(doc) {
        doc.savedAtMs = Date.now();
        this.store.putString(REEL_KEY_PREFIX + doc.id, serializeReel(doc));
        this.store.putString(LAST_REEL_KEY, doc.id);
        const summaries = this.listReels().filter((entry) => entry.id !== doc.id);
        summaries.unshift(summarize(doc));
        this.store.putString(INDEX_KEY, JSON.stringify(summaries));
        this.log.info(`saved reel "${doc.id}" with ${doc.clips.length} clips`);
    }
    /** Returns null when the reel is absent or corrupt; never a partial reel. */
    loadReel(id) {
        const key = REEL_KEY_PREFIX + id;
        if (!this.store.has(key)) {
            return null;
        }
        try {
            return parseReel(this.store.getString(key));
        }
        catch (error) {
            this.log.error(`reel "${id}" is corrupt and was dropped`, error);
            this.deleteReel(id);
            return null;
        }
    }
    loadLastReel() {
        if (!this.store.has(LAST_REEL_KEY)) {
            return null;
        }
        return this.loadReel(this.store.getString(LAST_REEL_KEY));
    }
    deleteReel(id) {
        const key = REEL_KEY_PREFIX + id;
        if (this.store.has(key)) {
            this.store.remove(key);
        }
        const summaries = this.listReels().filter((entry) => entry.id !== id);
        this.store.putString(INDEX_KEY, JSON.stringify(summaries));
    }
    // -------------------------------------------------------------------------
    // Recent characters
    // -------------------------------------------------------------------------
    /**
     * Remembering the rig plan means regenerating a character is one tap and the
     * exact same prompts — which matters when you are re-running a demo and do
     * not want a different dragon each time.
     */
    rememberRig(plan) {
        const recent = this.recentRigs().filter((entry) => entry.description !== plan.description);
        recent.unshift(plan);
        const trimmed = recent.slice(0, RECENT_RIG_LIMIT);
        this.store.putString(RECENT_RIGS_KEY, JSON.stringify(trimmed));
    }
    recentRigs() {
        if (!this.store.has(RECENT_RIGS_KEY)) {
            return [];
        }
        try {
            const parsed = JSON.parse(this.store.getString(RECENT_RIGS_KEY));
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed.filter((entry) => !!entry &&
                typeof entry === "object" &&
                Array.isArray(entry.joints) &&
                Array.isArray(entry.parts));
        }
        catch (error) {
            this.log.warn(`recent characters unreadable: ${describeError(error)}`);
            this.store.remove(RECENT_RIGS_KEY);
            return [];
        }
    }
    /** Wipes every stored reel. Only reachable from the debug panel. */
    clearAll() {
        for (const summary of this.listReels()) {
            const key = REEL_KEY_PREFIX + summary.id;
            if (this.store.has(key)) {
                this.store.remove(key);
            }
        }
        this.store.remove(INDEX_KEY);
        this.store.remove(RECENT_RIGS_KEY);
        this.store.remove(LAST_REEL_KEY);
        this.log.info("cleared all stored reels");
    }
}
