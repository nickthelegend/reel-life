import { Clip, clipDuration } from "./Clip";
import { clamp } from "./Vec";

/** One clip's slot on the global reel, in seconds. */
export interface TimelineSegment {
  clipId: string;
  index: number;
  start: number;
  end: number;
  caption: string | null;
}

export interface TimelineCursor {
  clip: Clip;
  index: number;
  /** Seconds from the start of this clip's trimmed range. */
  localT: number;
  segment: TimelineSegment;
}

/**
 * Ordered list of clips plus the time mapping the whole reel plays back on.
 *
 * The timeline owns order and trim only — it never mutates keyframes, so
 * reordering and trimming stay lossless and instantly reversible.
 */
export class ReelTimeline {
  clips: Clip[] = [];
  playbackSpeed = 1;
  loop = true;

  add(clip: Clip): Clip {
    this.clips.push(clip);
    return clip;
  }

  remove(clipId: string): boolean {
    const index = this.indexOf(clipId);
    if (index < 0) {
      return false;
    }
    this.clips.splice(index, 1);
    return true;
  }

  indexOf(clipId: string): number {
    for (let i = 0; i < this.clips.length; i++) {
      if (this.clips[i].id === clipId) {
        return i;
      }
    }
    return -1;
  }

  get(clipId: string): Clip | null {
    const index = this.indexOf(clipId);
    return index < 0 ? null : this.clips[index];
  }

  /** Move a clip to a new slot. This is what a pinch-drag on a chip does. */
  move(from: number, to: number): boolean {
    if (this.clips.length === 0) {
      return false;
    }
    const source = clamp(Math.round(from), 0, this.clips.length - 1);
    const target = clamp(Math.round(to), 0, this.clips.length - 1);
    if (source === target) {
      return false;
    }
    const [clip] = this.clips.splice(source, 1);
    this.clips.splice(target, 0, clip);
    return true;
  }

  moveClipId(clipId: string, to: number): boolean {
    const index = this.indexOf(clipId);
    return index < 0 ? false : this.move(index, to);
  }

  segments(): TimelineSegment[] {
    const out: TimelineSegment[] = [];
    let cursor = 0;
    for (let i = 0; i < this.clips.length; i++) {
      const clip = this.clips[i];
      const duration = clipDuration(clip);
      out.push({
        clipId: clip.id,
        index: i,
        start: cursor,
        end: cursor + duration,
        caption: clip.caption,
      });
      cursor += duration;
    }
    return out;
  }

  /** Total reel length in seconds at 1x speed. */
  totalDuration(): number {
    let total = 0;
    for (const clip of this.clips) {
      total += clipDuration(clip);
    }
    return total;
  }

  /** Wall-clock length once playback speed is applied. */
  playbackDuration(): number {
    const speed = this.playbackSpeed > 0 ? this.playbackSpeed : 1;
    return this.totalDuration() / speed;
  }

  /**
   * Map a reel-global time to the clip that owns it. Returns null for an empty
   * timeline, or for a time past the end when not looping.
   */
  resolve(globalT: number): TimelineCursor | null {
    const total = this.totalDuration();
    if (this.clips.length === 0 || total <= 0) {
      return null;
    }

    let t = globalT;
    if (this.loop) {
      t = ((t % total) + total) % total;
    } else if (t >= total) {
      const last = this.clips.length - 1;
      const segments = this.segments();
      return {
        clip: this.clips[last],
        index: last,
        localT: clipDuration(this.clips[last]),
        segment: segments[last],
      };
    } else if (t < 0) {
      t = 0;
    }

    const segments = this.segments();
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (t < segment.end || i === segments.length - 1) {
        return {
          clip: this.clips[i],
          index: i,
          localT: t - segment.start,
          segment,
        };
      }
    }
    return null;
  }

  /** Caption that should be visible at a reel-global time, if any. */
  captionAt(globalT: number): string | null {
    const cursor = this.resolve(globalT);
    return cursor ? cursor.clip.caption : null;
  }

  isEmpty(): boolean {
    return this.clips.length === 0;
  }
}
