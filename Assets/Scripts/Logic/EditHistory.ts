import { Clip, cloneClip } from "./Clip";

/**
 * Undo and redo for every edit on the reel.
 *
 * Snapshot-based rather than command-based: each entry holds a deep copy of the
 * whole clip list. Inverse-operation undo is where editors get subtly wrong —
 * an inverse that is 99% correct corrupts a project silently. A reel is a few
 * takes of a few dozen keyframes, so copying the lot is cheap and exactly
 * right.
 *
 * The reason this matters for a demo: without undo, one mis-tapped trim during
 * a live recording means starting the whole take over on camera.
 */

export interface HistoryEntry {
  label: string;
  clips: Clip[];
}

/** Snapshots kept. Beyond this the oldest are dropped. */
export const DEFAULT_HISTORY_LIMIT = 30;

function snapshot(clips: Clip[]): Clip[] {
  return clips.map((clip) => cloneClip(clip, clip.id));
}

export class EditHistory {
  private entries: HistoryEntry[] = [];
  private index = -1;

  constructor(private limit: number = DEFAULT_HISTORY_LIMIT) {}

  /**
   * Record the state after an edit. Anything previously undone is discarded,
   * which is the behaviour every editor has and users expect.
   */
  commit(label: string, clips: Clip[]): void {
    if (this.index < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.index + 1);
    }
    this.entries.push({ label, clips: snapshot(clips) });

    if (this.entries.length > this.limit) {
      this.entries.shift();
    }
    this.index = this.entries.length - 1;
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  /** Step back. Returns a fresh copy the caller owns. */
  undo(): HistoryEntry | null {
    if (!this.canUndo()) {
      return null;
    }
    this.index--;
    return this.current();
  }

  redo(): HistoryEntry | null {
    if (!this.canRedo()) {
      return null;
    }
    this.index++;
    return this.current();
  }

  /** The state at the cursor, copied so callers cannot mutate history. */
  current(): HistoryEntry | null {
    if (this.index < 0 || this.index >= this.entries.length) {
      return null;
    }
    const entry = this.entries[this.index];
    return { label: entry.label, clips: snapshot(entry.clips) };
  }

  /** Label of what undo would reverse, for the button. */
  undoLabel(): string | null {
    return this.canUndo() ? this.entries[this.index].label : null;
  }

  redoLabel(): string | null {
    return this.canRedo() ? this.entries[this.index + 1].label : null;
  }

  depth(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    this.index = -1;
  }
}
