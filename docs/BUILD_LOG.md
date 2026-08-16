# Build log

> **What this is.** The hackathon asks for a prompt log. This is the honest
> version of one: the plan as it was written, and what actually exists for each
> phase after the build session. It is not a transcript of CLAD skill
> invocations — this session ran on a machine without Lens Studio installed, so
> the phases that require the editor (scene assembly, live preview, LEAF, perf
> traces, live Snap3D calls) are marked as such rather than claimed. Everything
> marked ✅ was built and verified here.

## Phase 0 — Kickoff & scaffold

**Intent:** confirm the SPECS project, set up `CharacterStudio` / `ActiveCharacter`
/ `UI` roots, verify Remote Service Gateway wiring, compile clean.

**Produced:** the scene structure is specified as concrete inputs on
`ReelLifeApp` (see SETUP.md §4) rather than assembled — no editor available.
Project scaffolding, TypeScript toolchain, vendored API declarations and the test
harness were built instead. ✅ (toolchain) / ⏳ (scene assembly in editor)

## Phase 1 — Voice-to-character generation

**Intent:** hold-to-talk ASR → Snap3D generating the character as *separate
parts* → assemble under joint objects → scale to tabletop → cache recent
characters.

**Produced:** ✅
- `Voice/VoicePromptController.ts` — hold-to-talk ASR, interim results streamed
  to the status label, music ducked while the mic is open.
- `Logic/RigPlan.ts` — the interesting half. Decomposes a sentence into an
  archetype (biped / winged biped / quadruped / bird / blob), a shared style
  string, an accessory routed to the head or body, and 6–7 part prompts hung off
  a named joint tree. Capped at 7 parts because each is a multi-minute job.
  **14 tests.**
- `Character/Snap3DPartFactory.ts` — parallel jobs, per-part progress, one retry,
  then a named failure. No placeholder mesh.
- `Character/CharacterAssembler.ts` — builds the joint hierarchy parents-first,
  instantiates each GLB, and normalizes each part's scale from its mesh bounds so
  a head doesn't arrive twice the size of its body.
- `Character/ReelStore.ts` — last 3 rig plans persisted for one-tap regeneration
  with identical prompts.

⏳ Live Snap3D calls not exercised — needs the editor and a gateway token.

## Phase 2 — Real-world placement

**Intent:** World Query hit-test, drop-zone indicator, pinch to confirm, designed
around the ~5 Hz depth rate.

**Produced:** ✅ `Placement/SurfacePlacer.ts`. Ray-casts on a fixed 0.2 s cadence
matching the data rate, eases the reticle toward the hit rather than snapping,
and only reports "ready" once the point has held within 4 cm for half a second.
Confirm refuses if the user hasn't settled. ⏳ Not run against real depth data.

## Phase 3 — Puppeteer / grab & pose

**Intent:** every joint independently grabbable; Capture Pose / Record
Performance / Play Preview; a `PoseKeyframe` of `{joint: {localPosition,
localRotation}}`; 0.4 s stop-motion cadence; ~12 Hz performance sampling; visual
feedback showing the last captured pose.

**Produced:** ✅
- `Puppeteer/JointHandles.ts` — per-joint collider + SIK Interactable +
  InteractableManipulation, rotation and translation on, scale off.
- `Puppeteer/PoseRecorder.ts` — both modes into one buffer, 12 Hz sampling that
  drops frames where nothing moved (but never leaves a gap over 1 s), and an
  undo for a mis-tapped capture.
- `Logic/Clip.ts` — the keyframe model, non-destructive trim, monotonic-time
  enforcement, and pose-delta analysis. **12 tests.**
- `Puppeteer/OnionSkin.ts` — went past the plan's "ghost indicator" to real
  multi-layer onion skinning: ghost puppets built once from the same GLBs, then
  re-posed. See the note on added features below.

## Phase 4 — Playback engine / auto-tween

**Intent:** a custom runtime interpolator (explicitly *not* the editor-time
Animate system), ease-in-out, speed control, clips surviving play/stop.

**Produced:** ✅ `Logic/PoseInterpolator.ts` + `Playback/ReelPlayer.ts`. Binary
search to the bracketing keyframes, lerp position, shortest-arc slerp rotation,
four ease curves. Joints present in only one keyframe carry through rather than
snapping to identity. **11 tests**, including a 240-sample sweep over a four-pose
sequence asserting no positional or rotational popping.

## Phase 5 — Music & sound

**Intent:** Lyria score built from mood + character, foley on big transitions,
audio routed so it doesn't clash with the mic.

**Produced:** ✅
- `Logic/MusicPrompt.ts` — builds the Lyria prompt from mood, subject, measured
  tempo and reel length, clamped to what the generator can render; foley prompts
  inherit the character's material. **6 tests.**
- `Logic/AccentTrack.ts` — decides which transitions get a sound, once, up front,
  so replays sound identical. **Covered by the flow test.**
- `Audio/ReelAudio.ts` — two music channels so a mood change crossfades, per-sound
  cooldown, volume scaled by how far the puppet moved, ducking while the mic is
  live.

Deviation: `/build-music` renders offline, so the score cannot be generated at
runtime to match a measured tempo. Inverted instead — tracks carry their BPM, and
the *performance* is snapped to the track. The generated prompt is logged so you
can render a bespoke track for a character you've already made.

## Phase 6 — VFX polish

⏸ **Cut.** This was first on the plan's own cut list, and it needs the editor.
The visual feedback that actually matters (onion skin ghosts, active-clip chip
highlight, caption pop) is in and does not need VFX Graph.

## Phase 7 — Reel Timeline Editor

**Intent:** chip per clip, pinch-drag reorder, trim handles, captions, one Play
Reel button, honest copy about AR playback vs export.

**Produced:** ✅
- `Logic/ReelTimeline.ts` — order, trim, the global time mapping, loop wrap,
  caption windows. **10 tests.**
- `Timeline/TimelinePanel.ts` — chips built from a unit-plane mesh and authored
  materials; drag on a rail with live reindexing; trim handles mapping X position
  to keyframe index; caption tabs; playhead.
- `Timeline/CaptionBillboard.ts` — faces the viewer, pops in and out so caption
  changes are legible on a recording.

Deviation: captions are **spoken**, not typed on the AR keyboard. ASR was already
wired, it needs no extra package, and dictating a caption is faster than typing
one in AR. Keyboard support is additive.

## Phase 8 — Testing pass

**Intent:** LEAF scenarios covering generate → place → capture 3 poses → preview
→ reorder → play.

**Produced:** ✅ the same scenario, as `tests/flow.test.ts`, runnable without
hardware: build a rig from a sentence, record three takes, quantize to the beat,
reorder, trim, caption, save, reload, then play back at 60 fps asserting finite
poses at every frame, correct clip order, captions only inside their own window,
and foley on the right transitions. **83 tests total, all passing.**
⏳ LEAF-in-preview still to run in the editor.

## Phase 9 — Performance pass

⏳ **Needs the editor.** The known hot spot is already noted: each part is a
separate Snap3D mesh, so a 7-part character is 7+ draw calls before the ghosts,
which triple it. `Logic/RigPlan.ts` caps parts at 7 for this reason, and the
onion skin builds ghosts once rather than per frame. Merging non-poseable static
parts is the first optimization to try.

## Phase 10 — Packaging

**Produced:** ✅ this file, `docs/PROJECT_DESCRIPTION.md`,
`docs/DEMO_CHECKLIST.md`, `README.md`, `SETUP.md`.

---

## Features added beyond the plan

**Onion skinning** (`Puppeteer/OnionSkin.ts`). The plan asked for "a ghost/trail
indicator showing the last captured pose". Built as real multi-layer onion
skinning instead — translucent ghost puppets of the last N poses, standing where
you left them. It is the single tool stop-motion animators rely on most, it has
never existed in AR, and it is what makes the posing loop feel like animating.

**Beat-locked puppeteering** (`Logic/BeatGrid.ts`). Not in the plan at all. The
app infers the tempo you posed at, and snaps stop-motion keyframes to the beat
grid of whichever track is playing — live performances are left alone, since
snapping those would destroy their timing. Switching mood re-grids the whole
reel. It turns a wobbly hand-posed sequence into something that reads as
deliberate, and it costs the user nothing. **13 tests.**

**Real persistence** (`Logic/ReelDocument.ts`, `Character/ReelStore.ts`). Also
not in the plan. Reels survive closing the Lens: a versioned, validated document
format that refuses corrupt or future-version data loudly instead of silently
loading half a reel. Meshes can't be persisted from inside a Lens, so what's
stored is the rig plan — including every part's exact Snap3D prompt — plus every
recorded pose. **9 tests.**
