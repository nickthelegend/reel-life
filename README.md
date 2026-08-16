# Reel Life

**A spatial stop-motion animation studio for Snap Spectacles.**

Speak a character into existence. Drop it on your kitchen table. Pose it with your
hands, frame by frame, with translucent onion-skin ghosts of your last poses
standing behind it. Cut your takes together on a timeline that floats in the air,
snap every pose to the beat of the score, and play the whole thing back as a reel.

Built with [CLAD](https://developers.specs.com/docs/clad/overview-section/agents-and-skills)
for the SPECS hackathon.

---

## What it does

| Step | How it works |
|---|---|
| **Speak a character** | Hold the mic button, describe it ("a clay dragon in a top hat"). ASR transcribes it. |
| **It gets sculpted as a puppet** | The description is decomposed into 6–7 body parts, each generated separately by Snap3D and hung off empty joint objects — a jointed armature, not a skinned mesh. |
| **Drop it on a real surface** | World Query ray-casts to your table. Point, pause, pinch. |
| **Pose it** | Every joint is independently grabbable. Tap **Capture Pose** for stop-motion, or hold **Record** for a live performance sampled at 12 Hz. |
| **See what you're building** | Onion-skin ghosts of your previous poses stay on screen while you work. |
| **Cut it together** | A world-space timeline: one chip per take. Pinch-drag to reorder, drag the edge handles to trim, tap the tab to speak a caption. |
| **Play it back** | Custom runtime interpolator tweens between poses with an ease curve, scored, with foley on the big transitions and captions floating above the puppet. |

"Play Reel" plays the sequence **live in AR**. There is no in-Lens video export —
you capture a shareable file the same way every Spectacles demo does, by screen
recording the preview or using the device capture button. The UI says so plainly.

## The two features I'd point a judge at

**1. Onion skinning.** Translucent ghosts of your last two captured poses stay
standing where you left them while you pose the next one. It's the tool real
stop-motion animators live by, it's never existed in AR before, and it turns
"fiddling with a toy" into "animating" — you can see the arc you're building
instead of holding it in your head. `Puppeteer/OnionSkin.ts`

**2. Beat-locked puppeteering.** The app measures the tempo you actually posed
at, then snaps every stop-motion keyframe onto the beat grid of the track that's
playing. Switch mood mid-session and the whole reel re-grids to the new tempo —
the puppet lands its poses on the beat, every time. A wobbly hand-posed
performance suddenly reads as choreography. `Logic/BeatGrid.ts`

## Layout

```
Assets/Scripts/
  Logic/          engine-agnostic core — runs and is unit tested in plain Node
    Vec, Easing, PoseTypes, RigPlan, Clip, PoseInterpolator,
    ReelTimeline, BeatGrid, AccentTrack, MusicPrompt, ReelDocument
  Core/           app orchestrator, engine<->logic conversion, logging
  Character/      Snap3D generation, rig assembly, persistent storage
  Voice/          hold-to-talk ASR
  Placement/      World Query surface placement
  Puppeteer/      joint handles, pose recording, onion skin
  Playback/       reel player
  Timeline/       timeline chips, caption billboard
  Audio/          score + foley
  UI/             world-space buttons
typings/          vendored subset of the Lens Studio / SIK / RSG APIs, for
                  offline typechecking only — the editor never sees these
tests/            83 tests over the Logic layer, incl. a full flow rehearsal
```

The split is deliberate: everything that can be decided without a scene graph —
interpolation, trimming, reordering, tempo, persistence, rig planning — lives in
`Logic/` as plain TypeScript, so it is provable on a laptop. The engine layer is
a thin shell over it.

## Verify it

```bash
npm run verify
```

Runs a typecheck of the whole Lens source tree against the vendored API
declarations, then the 83-test suite. `tests/flow.test.ts` is the end-to-end
rehearsal: build a rig from a sentence, record three takes, quantize to the beat,
reorder, trim, caption, save, reload, and play back frame by frame asserting the
pose is finite at every frame, clips play in the edited order, captions appear
only in their own window, and foley fires on the right transitions.

## Running it on hardware

See [SETUP.md](SETUP.md). Short version: create a SPECS project in Lens Studio
5.22+, copy `Assets/Scripts/` in, install the SIK and Remote Service Gateway
packages, paste your gateway tokens, and wire the inputs on `ReelLifeApp`.

## Honest status

- **Verified here:** the whole `Logic/` layer (83 tests, all passing) and a
  typecheck of every Lens source file.
- **Not verified here:** anything requiring the editor. Lens Studio is not
  installed on the machine this was built on, so no scene was assembled, no
  preview was run, and no live Snap3D call was made. The Snap3D and SIK call
  sites are written against the documented package APIs and mirrored in
  `typings/` — check them against your installed package versions first
  (SETUP.md says how).
- **Deviation from the original plan:** captions are spoken, not typed. The
  original plan called for the AR keyboard; ASR was already wired for character
  prompts, it needs no extra package, and typing a caption on an AR keyboard is
  slower than saying it. Keyboard support is an easy addition, not a
  prerequisite.
- **No fallbacks anywhere.** If Snap3D cannot generate a part after one retry,
  generation fails with that part named. There is no stand-in cube, no fake
  progress, no mock character.
