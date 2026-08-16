import { clipDuration } from "./Clip.js";
import { clamp } from "./Vec.js";
/**
 * Ordered list of clips plus the time mapping the whole reel plays back on.
 *
 * The timeline owns order and trim only — it never mutates keyframes, so
 * reordering and trimming stay lossless and instantly reversible.
 */
export class ReelTimeline {
    constructor() {
        this.clips = [];
        this.playbackSpeed = 1;
        this.loop = true;
    }
    add(clip) {
        this.clips.push(clip);
        return clip;
    }
    remove(clipId) {
        const index = this.indexOf(clipId);
        if (index < 0) {
            return false;
        }
        this.clips.splice(index, 1);
        return true;
    }
    indexOf(clipId) {
        for (let i = 0; i < this.clips.length; i++) {
            if (this.clips[i].id === clipId) {
                return i;
            }
        }
        return -1;
    }
    get(clipId) {
        const index = this.indexOf(clipId);
        return index < 0 ? null : this.clips[index];
    }
    /** Move a clip to a new slot. This is what a pinch-drag on a chip does. */
    move(from, to) {
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
    moveClipId(clipId, to) {
        const index = this.indexOf(clipId);
        return index < 0 ? false : this.move(index, to);
    }
    segments() {
        const out = [];
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
    totalDuration() {
        let total = 0;
        for (const clip of this.clips) {
            total += clipDuration(clip);
        }
        return total;
    }
    /** Wall-clock length once playback speed is applied. */
    playbackDuration() {
        const speed = this.playbackSpeed > 0 ? this.playbackSpeed : 1;
        return this.totalDuration() / speed;
    }
    /**
     * Map a reel-global time to the clip that owns it. Returns null for an empty
     * timeline, or for a time past the end when not looping.
     */
    resolve(globalT) {
        const total = this.totalDuration();
        if (this.clips.length === 0 || total <= 0) {
            return null;
        }
        let t = globalT;
        if (this.loop) {
            t = ((t % total) + total) % total;
        }
        else if (t >= total) {
            const last = this.clips.length - 1;
            const segments = this.segments();
            return {
                clip: this.clips[last],
                index: last,
                localT: clipDuration(this.clips[last]),
                segment: segments[last],
            };
        }
        else if (t < 0) {
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
    /**
     * Like `resolve`, but never wraps: time past the end holds the final pose
     * even on a looping timeline.
     *
     * Scrubbing and seeking need this. Seeking to a moment that happens to sit
     * exactly at the end of a looping reel would otherwise jump to the start —
     * which is right for playback and wrong for every other use.
     */
    resolveClamped(globalT) {
        const wasLooping = this.loop;
        this.loop = false;
        const cursor = this.resolve(globalT);
        this.loop = wasLooping;
        return cursor;
    }
    /** Caption that should be visible at a reel-global time, if any. */
    captionAt(globalT) {
        const cursor = this.resolve(globalT);
        return cursor ? cursor.clip.caption : null;
    }
    isEmpty() {
        return this.clips.length === 0;
    }
}
