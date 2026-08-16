# 100 feature ideas, ranked

Scored on **impact** (would a judge notice) × **feasibility** (buildable for real
here) × **fit** (strengthens the pitch rather than cluttering it).

The pitch this has to strengthen: *Reel Life is a real animation tool, not a
voice-to-3D toy.* Ideas that push toward "animation craft you cannot get
anywhere else" rank above ideas that add surface area.

**Status key** — `BUILT` verified by tests that run here · `WIRED` written and
typechecked, needs Lens Studio to run · `—` not built, reason given.

---

## Tier 1 — built and verified (24)

These run in `npm test`. 220 tests, all passing.

| # | Idea | Status | Why it ranked here |
|---|---|---|---|
| 1 | **Shoot on twos/threes** — quantize playback to a film-frame grid so poses hold for N frames | BUILT | The single highest impact-per-line idea in the list. Stop-motion's whole visual signature is the 12fps stutter; smooth interpolation reads as CG. Pure logic, ~90 lines, and it changes how the entire demo looks. |
| 2 | **Follow-through and drag** — limbs trail the parent chain, then whip and settle | BUILT | Hand-posing physically cannot produce this: you place every joint at the same instant. Computing it is the difference between "moving an object" and "animation". |
| 3 | **Undo / redo across all edits** | BUILT | One mis-tapped trim during a live demo otherwise means re-recording the take on camera. Also the #1 thing that separates "finished" from "demo-ware". |
| 4 | **Voice commands** — "capture", "undo that", "on twos", "smooth it" | BUILT | Your hands are holding a puppet; reaching for a button means letting go of the pose. The hard part is the inverse of recognition — a character description must never fire a command. |
| 5 | **Performance retargeting** — replay a take on a different character | BUILT | The "wait, it can do *that*?" moment. A dragon's wing drives a robot's arm. Only possible because poses are keyed by joint name; transfers delta-from-rest scaled by height so limbs stay attached. |
| 6 | **Motion arcs** — forward kinematics + the path a joint traces in space | BUILT | The third pillar of animation craft after onion skins and follow-through. Drawing the actual arc at actual size in the room is something only an AR tool can do. |
| 7 | **Health coaching / real empty states** | BUILT | Replaces a dead empty state with something that teaches: flags single-pose takes, shaky takes, and limbs travelling in dead straight lines. |
| 8 | **Tremor smoothing + auto-detect** | BUILT | Every live take carries hand shake. Detection uses peak per-joint jitter, not the average — nine still limbs would otherwise hide one shaking hand. Defaults are tied to the threshold by a test so suggest→smooth→re-suggest provably converges. |
| 9 | **Mirror a pose or take** | BUILT | Symmetry by hand in AR is genuinely hard. Uses proper improper-transform conjugation, not naive angle negation. |
| 10 | **Split a take** | BUILT | Turns "record it again" into "fix the one you have". |
| 11 | **Merge two takes** | BUILT | Same. Also handles the source-type question so a live take never gets beat-quantized. |
| 12 | **Reverse a take** | BUILT | Cheap, and instantly readable on camera. |
| 13 | **Ping-pong a take** | BUILT | One capture becomes a loop. Doesn't repeat the turnaround pose, so there's no pause at the top of the swing. |
| 14 | **Loop-close a cycle** | BUILT | Without it a looping clip snaps from last pose to first, which reads as a glitch. |
| 15 | **Reel stats card** | BUILT | Takes, poses, duration, BPM, joints animated, distance travelled. Numbers a judge can read off the screen. |
| 16 | **Poster frame** — auto-pick the most extreme pose | BUILT | Playback lands on the strongest frame instead of wherever it stopped. |
| 17 | **Retime a take** | BUILT | Speed a take up without touching its poses. |
| 18 | **Copy / paste a pose** | BUILT | Return-to-pose is the most common stop-motion move there is. |
| 19 | **Hold the closing pose** | BUILT | A take that cuts away the instant it lands reads as a mistake. |
| 20 | **Deterministic ids** | BUILT | Replaced `Date.now()+Math.random()`. Saved reels diff cleanly and a recorded demo replays identically. |
| 21 | **Clamped scrubbing** | BUILT | Found via a failing test: seeking to a moment at the exact end of a looping reel wrapped to the start. Right for playback, wrong for everything else. |
| 22 | **Arc-quality readout** | BUILT | Reports how curved a limb's path is. A ratio near 1.0 means mechanical motion. |
| 23 | **Overlong-take guard** | BUILT | A 40-second take kills a 2-minute demo. |
| 24 | **Extremity detection** | BUILT | Works out which joints are limb tips, so arcs are drawn only where they mean something. |

## Tier 2 — built and wired into the Lens, needs the editor to run (8)

Typechecked, not executed — no Lens Studio on this machine.

| # | Idea | Status | Note |
|---|---|---|---|
| 25 | Shoot-mode button cycling twos → threes → ones → smooth | WIRED | Player quantizes sample time before interpolating. |
| 26 | Voice commands routed through the live ASR path | WIRED | Falls through to character generation when it isn't a command. |
| 27 | Follow-through applied automatically when a take is completed | WIRED | Non-destructive; the raw take is still in history. |
| 28 | Undo button with live label ("Undo" / "Undo —") | WIRED | |
| 29 | Coaching line replacing the fixed status string | WIRED | |
| 30 | Reel ends on the poster frame with the stats line | WIRED | |
| 31 | Shaky-take smoothing offer after recording | WIRED | |
| 32 | **Startup input validation naming every missing field** | WIRED | 32 inputs; a missing one otherwise surfaces as a null deref in a callback seconds later. This is the difference between someone else opening the repo successfully or not. |

## Tier 3 — ranked, not built

Ordered by score. Reason given for each.

**Would build next (33–45)** — high impact, blocked only on time or the editor.

33. Onion-ghost colour coding (past blue / future orange) — animation convention, needs editor materials
34. Motion-arc ribbon rendering in-scene — logic is BUILT (#6), only the mesh drawing is missing
35. Film-leader countdown before Play Reel — pure cinema, cheap, needs scene work
36. Timeline chips spring-stagger in on rebuild — needs editor
37. Per-keyframe ease (anticipation on individual poses) — logic-feasible, ran out of time
38. Additive layer recording (animate one limb over an existing take) — big, needed more design
39. Root motion (puppet travels across the table) — needs anchor rework
40. Idle "breathing" when not being posed — logic-feasible, cut for time
41. Squash and stretch on impact accents — needs non-uniform scale on joints
42. Trim handles previewing the pose at that keyframe — needs editor
43. Playhead scrub-by-drag with audio scrubbing — needs editor
44. Clapperboard slate on record start — charming, pure scene work
45. Reel library browser (load a previous reel) — store layer exists, UI doesn't

**Genuinely good, lower priority (46–70)**

46. Part re-roll (regenerate just the head) · 47. Progressive base-mesh display then refined swap · 48. Image-to-3D from a drawing on paper · 49. LLM prompt expansion before Snap3D · 50. Pose library saved across characters · 51. Two-character scenes · 52. Joint-collision accents between puppets · 53. Camera "shots" recorded as viewpoints · 54. Depth-based occlusion · 55. Persistent spatial anchors across sessions · 56. Foot-contact snapping to the surface · 57. Per-joint keyframe locking · 58. Solo/mute a take · 59. Kinetic caption typography · 60. "Take N" title cards between clips · 61. Film grain + vignette during playback only · 62. Beat-pulse on timeline ticks · 63. Shadow blob grounding the puppet · 64. Spawn-puff VFX · 65. Rim-light pulse on the grabbed joint · 66. Capture shutter flash + camera clack · 67. Distinct UI sounds per action · 68. Generation progress arranged in the shape of the body · 69. Character materializes part-by-part as jobs land · 70. Ambient soundscape per mood

**Real but marginal (71–90)**

71. Storage quota eviction · 72. Schema v1→v2 migration path · 73. Offline detection with a specific message · 74. Missing-token detection with the exact fix · 75. Delete-with-confirm · 76. Session timing analytics for demo prep · 77. Diagnostics panel · 78. Ghost-layer reduction under low frame rate · 79. Reduced-motion mode · 80. Larger-text accessibility mode · 81. Localization scaffolding · 82. On-device log overlay · 83. Onboarding coach marks · 84. Demo mode with a pre-loaded reel · 85. Tutorial reel on first launch · 86. Reel export as a shareable JSON string · 87. QR code of the reel data · 88. In-app prompt-log export · 89. Shot-list overlay during recording · 90. Director's commentary audio track

**Considered and rejected (91–100)** — these would have *hurt* the pitch

91. Colocated multiplayer co-puppeteering — weeks of work, and splits the demo's attention
92. Cloud save / share via Snap Cloud — plumbing a judge never sees
93. Leaderboards — wrong genre entirely
94. Full physics simulation on the puppet — fights the stop-motion premise, which is deliberately not physical
95. Rigged-skeleton (Tier 1 Blender) characters — the jointed-armature approach is *more* stop-motion-authentic, not a compromise
96. Real-time voice conversation with the character — impressive, unrelated
97. In-Lens video export — not a documented capability; promising it would be dishonest
98. Auto-generated animation from a text prompt — removes the thing the tool is *for*
99. Gesture shortcuts (clap to capture) — false positives while your hands are posing
100. Style transfer across generated parts — Snap3D consistency is already handled by the shared style string

---

## What the ranking is actually saying

The top of this list is not a grab bag. Ideas 1, 2, 6, 8 and 9 are the same
idea from five angles: **make the AR puppet behave like a real animation
instrument.** Shoot-on-twos gives it the medium's cadence, follow-through gives
it weight, arcs give it craft feedback, smoothing removes the human hand's
limits, mirroring removes another.

That coherence is the point. A judge who watches the demo should come away able
to say what the tool *is* in one sentence — and 100 disconnected features would
have made that harder, not easier.
