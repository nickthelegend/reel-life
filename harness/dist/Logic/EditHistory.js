import { cloneClip } from "./Clip.js";
/** Snapshots kept. Beyond this the oldest are dropped. */
export const DEFAULT_HISTORY_LIMIT = 30;
function snapshot(clips) {
    return clips.map((clip) => cloneClip(clip, clip.id));
}
export class EditHistory {
    constructor(limit = DEFAULT_HISTORY_LIMIT) {
        this.limit = limit;
        this.entries = [];
        this.index = -1;
    }
    /**
     * Record the state after an edit. Anything previously undone is discarded,
     * which is the behaviour every editor has and users expect.
     */
    commit(label, clips) {
        if (this.index < this.entries.length - 1) {
            this.entries = this.entries.slice(0, this.index + 1);
        }
        this.entries.push({ label, clips: snapshot(clips) });
        if (this.entries.length > this.limit) {
            this.entries.shift();
        }
        this.index = this.entries.length - 1;
    }
    canUndo() {
        return this.index > 0;
    }
    canRedo() {
        return this.index >= 0 && this.index < this.entries.length - 1;
    }
    /** Step back. Returns a fresh copy the caller owns. */
    undo() {
        if (!this.canUndo()) {
            return null;
        }
        this.index--;
        return this.current();
    }
    redo() {
        if (!this.canRedo()) {
            return null;
        }
        this.index++;
        return this.current();
    }
    /** The state at the cursor, copied so callers cannot mutate history. */
    current() {
        if (this.index < 0 || this.index >= this.entries.length) {
            return null;
        }
        const entry = this.entries[this.index];
        return { label: entry.label, clips: snapshot(entry.clips) };
    }
    /** Label of what undo would reverse, for the button. */
    undoLabel() {
        return this.canUndo() ? this.entries[this.index].label : null;
    }
    redoLabel() {
        return this.canRedo() ? this.entries[this.index + 1].label : null;
    }
    depth() {
        return this.entries.length;
    }
    clear() {
        this.entries = [];
        this.index = -1;
    }
}
