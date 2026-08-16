# Reel Life — test plan

## What is being tested, and how

Reel Life is a Snap Spectacles Lens. It has no web pages, no HTTP API, and no
smart contracts. So "the real product in a real browser" needs a definition:

- **`harness/`** is a real browser application that imports the **actual
  shipping modules** from `Assets/Scripts/Logic/` — the same files the Lens
  compiles. Nothing is reimplemented for the browser. Persistence goes through
  the real `ReelStore` class against a `localStorage`-backed
  `persistentStorageSystem`, which is a genuinely persisted store that survives
  reload.
- **Engine-layer components** (Snap3D generation, SIK hand interaction, ASR,
  World Query placement, scene assembly, audio playback) cannot execute outside
  Lens Studio on Spectacles hardware. They are listed below and marked
  `UNTESTABLE HERE` with the specific missing dependency. They are not marked
  PASS.

Every item below states the exact expected result. Console and network are
checked on every item; any error anywhere fails that item.

---

## RESULTS — final run

**76 / 76 testable items PASS. 10 items untestable here (Section M), explicitly not marked PASS.**

Executed against the running harness in Chrome, driving the real UI. Console and
network checked throughout: **zero `console.error`, zero failed requests**, all
23 real modules served 200 OK. The only two console *warnings* in the whole run
are the app's own refusal messages, produced on purpose by negative tests A9
("description is empty") and D10 ("nothing to play") — they are the evidence
those guards work.

### Defects found and fixed during the run

| Item | Defect | Root-cause fix |
|---|---|---|
| B2 | Live performance recorded 6 samples at 1000ms gaps instead of ~12Hz | The 12Hz sampling policy was trapped inside the engine-bound `PoseRecorder`, so it could neither be reused nor unit-tested, and the harness had reimplemented it with `setInterval` (throttled to 1Hz in a background tab). Extracted the real policy to `Logic/SampleGate.ts`; `PoseRecorder` now delegates to it and the harness drives the same class. **+12 unit tests.** |
| K5 | The poster frame's own `globalT` did not seek back to the pose it names | A clip's last keyframe sits exactly on its segment's end, which segment lookup assigns to the *next* clip. Added `timeInsideSegment()` in `ReelStats.ts` to keep the time strictly inside its own segment. **+1 regression test.** |
| D10 | `play()` on an emptied timeline refused but left `playing` set, stranding the player advancing against a timeline that can never resolve | `ReelPlayer.play()` now calls `stop()` before refusing. **+1 regression test.** |

### Plan corrections (drafting errors in Phase 1, not product defects)

- **A6** originally expected 3 parts for a blob; the design is 4 (body + face +
  2 stubby arms). Corrected the plan rather than deleting a limb to match a typo.
- **D1/D2/D3/D3b/D4/D5** were first measured with windows that crossed a clip
  boundary or a single x-coordinate that happened to be constant. Re-measured
  with full-pose signatures inside a single take. Stepping is exact: 13 distinct
  poses per second on twos (12fps), 9 on threes (8fps), 25 on ones (24fps).

### Verification harness

`harness/` imports the **real shipping modules** from `Assets/Scripts/` compiled
to browser ESM — nothing is reimplemented. Persistence runs through the real
`ReelStore` against `localStorage`. The only host shim is `harness/platform.js`,
which supplies `print()` and `persistentStorageSystem` and no application logic.

Note on the frame clock: an automated browser tab reports `document.hidden`,
where `requestAnimationFrame` is paused outright and `setInterval` throttles to
1Hz. The harness therefore drives its logic frame from a `MessageChannel` pump.
That is a clock only — `SampleGate` still decides what is recorded and
`ReelTimeline` still decides what is played.

---

## A. Character definition (Logic/RigPlan)

| # | Item | Correct means |
|---|---|---|
| A1 | Describe "a clay dragon in a top hat" | archetype `winged_biped`; exactly 7 parts; subject `clay dragon`; accessory `top hat`; style tokens include `clay` |
| A2 | Accessory routing | The `head` part prompt contains "top hat"; the `torso` prompt does not |
| A3 | Shared style across parts | All 7 part prompts contain `clay` AND `isolated single object` |
| A4 | Archetype: quadruped | "a felt fox" → `quadruped`, 7 parts, joints include `leg.FL`/`leg.BR`/`tail` |
| A5 | Archetype: bird | "a paper owl" → `bird`, 6 parts, joints include `wing.L`, no `tail` |
| A6 | Archetype: blob | "a green slime" → `blob`, 4 parts (body + face + 2 stubby arms) — *plan corrected during the run; it originally said 3, which was a drafting error, not a defect* |
| A7 | Archetype: default biped | "a tiny knight" → `biped`, 6 parts, style defaults to clay/claymation |
| A8 | Joint tree integrity | Every part's `jointId` exists in the joint list; build order is parents-first; root not poseable |
| A9 | Empty description | Throws "description is empty"; UI shows the error; no partial rig is created |
| A10 | Part budget | No description produces more than 7 parts |

## B. Recording (Logic/Clip, PoseRecorder semantics)

| # | Item | Correct means |
|---|---|---|
| B1 | Capture 4 stop-motion poses | 4 keyframes at t = 0, 0.4, 0.8, 1.2; trimOut = 3 |
| B2 | Record a live performance | Keyframes at ~1/12s spacing; times strictly increasing; source `performance` |
| B3 | Monotonic time enforcement | Appending an out-of-order time still yields strictly increasing timestamps |
| B4 | Undo last pose | Keyframe count drops by exactly 1; trimOut follows; a second undo drops another |
| B5 | Empty take | Finishing a take with 0 keyframes adds nothing to the timeline and reports it |

## C. Timeline editing (Logic/ReelTimeline, ClipOps)

| # | Item | Correct means |
|---|---|---|
| C1 | Three takes lay end to end | Segments abut exactly: [0,d1], [d1,d1+d2], … ; total = sum |
| C2 | Reorder by drag | Order changes; total duration unchanged; segments recomputed |
| C3 | Trim in/out | Trimmed duration shrinks; raw keyframe count unchanged (non-destructive) |
| C4 | Trim handles cannot cross | trimIn ≤ trimOut always, whatever order they are dragged |
| C5 | Reset trim | Restores the full keyframe range |
| C6 | Split | Two halves; both start at t=0; cut pose appears as last of first / first of second |
| C7 | Split at an endpoint | Refused; timeline unchanged; UI states why |
| C8 | Merge | Single take; second half offset by first duration + gap; times ordered |
| C9 | Reverse | Poses in opposite order; identical duration |
| C10 | Ping-pong | Out and back; turnaround pose not duplicated; duration exactly 2× |
| C11 | Loop-close | Final pose equals opening pose; `isLoopClosed` true |
| C12 | Retime ×2 | Duration halves; poses byte-identical |
| C13 | Delete a take | Removed; remaining segments close the gap with no hole |
| C14 | Caption a take | Caption shows only within that take's time window, null elsewhere |
| C15 | Empty timeline | `resolve` returns null; duration 0; no exception; UI shows the empty state |

## D. Playback (Logic/PoseInterpolator, Stepped, AccentTrack)

| # | Item | Correct means |
|---|---|---|
| D1 | Interpolation endpoints | Sampling at t=0 and t=duration returns exactly the first/last poses |
| D2 | No popping | Across 240 samples of a 4-pose take, no single step moves a joint more than a fraction of total travel; no NaN |
| D3 | Shoot on twos | Pose is byte-identical across a whole 1/12s window and changes at the boundary; exactly 13 distinct poses in 1s |
| D4 | Shoot on threes | 8 updates per second |
| D5 | Smooth mode | Time passes through unquantized; every sample distinct |
| D6 | Playback speed | 0.5× / 1× / 2× changes wall-clock duration only, never total timeline duration |
| D7 | Loop wrap | Time past the end wraps to the start during playback |
| D8 | Scrub does not wrap | `resolveClamped` at exactly total duration holds the final clip, and leaves `loop` unchanged |
| D9 | Accents fire once | Each notable transition fires exactly one foley event per pass, deterministic across replays |
| D10 | Playback of an empty reel | Refused with a message; no exception |

## E. Beat grid (Logic/BeatGrid)

| # | Item | Correct means |
|---|---|---|
| E1 | Tempo inferred from cadence | 0.4s stop-motion spacing → 150 BPM |
| E2 | Performance rate not read as tempo | 12 Hz sampling yields a BPM inside 60–180, not 720 |
| E3 | Quantize to grid | Every keyframe within 1ms of a grid line; order preserved; take starts at 0 |
| E4 | Collapse prevention | Three poses 20ms apart become 0, 0.25, 0.5 at 120 BPM — never one frame |
| E5 | Re-grid to a new tempo | All keyframes land on the new grid; still ordered |
| E6 | Live takes are never quantized | A `performance` take's timestamps are untouched by a mood change |

## F. Motion craft (Logic/SecondaryMotion, Kinematics, PoseOps)

| # | Item | Correct means |
|---|---|---|
| F1 | Follow-through creates motion | A take that rotates ONLY the torso produces non-identity wing rotations in ≥2 keyframes |
| F2 | Opening pose preserved | Keyframe 0 is byte-identical before and after follow-through |
| F3 | Anchors untouched | root/hips/torso rotations unchanged |
| F4 | Depth scaling | Head (depth 4) deviates ≥ neck (depth 3) |
| F5 | Purity | The source take is byte-identical after the operation |
| F6 | Still take stays still | No invented motion |
| F7 | Forward kinematics at rest | Head world Y = sum of hips + neck offsets |
| F8 | FK responds to rotation | Rotating the torso moves the head >1cm in world space |
| F9 | Motion arc | A swinging joint yields a path with length > 0 and arcRatio > 1.02 |
| F10 | Straight-line detection | A joint moved in a straight line yields arcRatio ≈ 1.0 |
| F11 | Mirror | Limb ids swap; x negated; rotation reflected; mirroring twice is identity |
| F12 | Smoothing | Jitter drops >75%; first/last poses pinned; travel preserved |
| F13 | Smoothing convergence | A flagged take, after default smoothing, is no longer flagged |
| F14 | Copy/paste pose | Pasted pose matches source and is a deep copy |

## G. Retargeting (Logic/Retarget)

| # | Item | Correct means |
|---|---|---|
| G1 | Dragon → robot | wing.L drives arm.L; spine maps exactly; tail reported dropped |
| G2 | Dragon → fox | wing.L drives leg.FL |
| G3 | Rest pose in, rest pose out | Every joint sits at the TARGET's rest offset, not the source's |
| G4 | Delta transfer | A 5cm lift from rest transfers as 5cm × height scale |
| G5 | Scale | 20cm → 40cm character doubles the transferred offset |
| G6 | No silent collisions | No two source joints write the same target joint |
| G7 | Identity | Retargeting onto the same rig changes nothing |
| G8 | Fidelity report | Reports % carried over; 100% for identity, <100% dragon→robot |

## H. Undo / redo (Logic/EditHistory)

| # | Item | Correct means |
|---|---|---|
| H1 | Undo an edit | Timeline returns to the exact prior state including trim values |
| H2 | Redo | Restores the undone state |
| H3 | Redo tail discarded | Committing after an undo makes redo unavailable |
| H4 | Isolation | Mutating the returned clips does not corrupt history |
| H5 | Bounded | Stack caps at its limit and drops oldest |
| H6 | Labels | Undo/redo labels name the actual operation |
| H7 | Undo across every operation type | split/merge/reverse/mirror/smooth/delete all undo correctly |

## I. Voice commands (Logic/VoiceCommands)

| # | Item | Correct means |
|---|---|---|
| I1 | Recognised commands | All 18 listed phrases parse to their kind with confidence ≥ 0.6 |
| I2 | Descriptions are never commands | 8 character descriptions containing command words all parse to `none` |
| I3 | Length guard | Any utterance > 5 words parses to `none` |
| I4 | Punctuation/casing | "Undo, that!" parses to `undo` |
| I5 | Empty input | Parses to `none`, no exception |
| I6 | Command executes | Speaking "reverse it" actually reverses the selected take in the timeline |
| I7 | Help list accuracy | Every example phrase shown to the user parses to the kind it is advertised as |

## J. Persistence (Logic/ReelDocument + Character/ReelStore, real localStorage)

| # | Item | Correct means |
|---|---|---|
| J1 | Save and reload | After page reload, the reel returns with identical clips, trims, captions, BPM, mood |
| J2 | Float fidelity | Quaternion and position values round-trip exactly |
| J3 | Reel index | Saved reels appear in the library list with correct title and clip count |
| J4 | Delete | Removes both the reel and its index entry |
| J5 | Corrupt data | Hand-corrupted stored JSON is rejected with a specific reason and dropped, not partially loaded |
| J6 | Future schema version | A reel written by a newer version is refused |
| J7 | Non-finite values | `null` in a position field is caught as "not a finite number" |
| J8 | Trim clamping on load | Out-of-range stored trims clamp into range |
| J9 | Unknown enum values | Unknown mood/ease fall back rather than breaking playback |
| J10 | Recent characters | Last 3 rig plans persist across reload, most recent first, no duplicates |

## K. Stats and coaching (Logic/ReelStats)

| # | Item | Correct means |
|---|---|---|
| K1 | Stats accuracy | takes/poses/keptPoses/captions/BPM/longest take all match the timeline exactly |
| K2 | Trimmed vs recorded | keptPoses < poses after a trim; poses unchanged |
| K3 | Joints animated | Counts only joints whose transform actually changes |
| K4 | Empty reel | Zeroes, not NaN; longestTakeName null |
| K5 | Poster frame | Picks the most extreme pose; its globalT seeks to the right clip |
| K6 | Empty state coaching | An empty reel shows actionable guidance, not a blank panel |
| K7 | Single-pose warning | A 1-pose take is flagged as a warning |
| K8 | Shaky take tip | A tremored performance is flagged with the smooth fix |
| K9 | Straight-line arc tip | A linear limb path is flagged |
| K10 | Severity ordering | Warnings sort above tips |
| K11 | Stable ids | Health note ids are stable and unique across repeated calls |

## L. Cross-cutting

| # | Item | Correct means |
|---|---|---|
| L1 | Zero console errors | No error or warning in the console across the entire run |
| L2 | Zero failed network requests | Every request 200s; no 404s for modules or assets |
| L3 | Reload mid-flow | Reloading the page mid-edit restores the last saved state cleanly |
| L4 | No mocks in tested surface | Every module under test is the real shipping file from `Assets/Scripts/Logic/` |
| L5 | Full end-to-end | Describe → record 3 takes → quantize → reorder → trim → caption → save → reload → play, all correct |

---

## M. Engine layer — cannot be executed in a browser

Listed for completeness. Each requires Lens Studio and/or Spectacles hardware.
None of these are marked PASS anywhere in this run.

| # | Component | Missing dependency |
|---|---|---|
| M1 | Snap3D part generation | Remote Service Gateway token + Lens Studio runtime |
| M2 | Character assembly from GLB | Lens Studio scene graph + `GltfAsset.tryInstantiate` |
| M3 | SIK joint grab/rotate | Spectacles Interaction Kit + hand tracking |
| M4 | ASR hold-to-talk | Lens Studio `AsrModule` |
| M5 | World Query surface placement | Depth data on device |
| M6 | Onion-skin ghost rendering | Lens Studio materials + scene graph |
| M7 | Timeline chip rendering / pinch-drag | Lens Studio meshes + SIK |
| M8 | Audio playback and crossfade | Lens Studio `AudioComponent` |
| M9 | Caption billboard | Lens Studio `Text` + camera transform |
| M10 | Startup input validation | Requires an actual Lens scene with inputs to omit |
