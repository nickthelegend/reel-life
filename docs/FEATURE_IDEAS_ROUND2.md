# 100 more ideas, round 2

Round 1 is in [FEATURE_IDEAS.md](FEATURE_IDEAS.md); 32 of those are built. None
of them are repeated here.

**What changed since round 1, and why the ranking is different.** The project is
at 51% completion and the binding constraint is no longer "which feature is
missing" — it is that **a judge cannot see any of this**. There is no Lens
Studio, no device, no demo video. The most valuable thing a feature can do now
is either (a) make the work visible without hardware, or (b) deepen the one
pillar the project is actually about — animation craft — in a way that is
provable on a laptop.

Ranked by impact × feasibility × fit. `BUILT` = built and verified this run.

---

## Tier 1 — built and verified (10)

| # | Idea | Why it ranked here |
|---|---|---|
| 1 | **Exposure sheet (X-sheet)** — the traditional stop-motion planning document, generated from a take | This is the artefact animators actually work from. Generating a real X-sheet — frame numbers, held frames, pose changes, beat marks — says "this was built by someone who knows the craft" louder than any feature in round 1. Pure logic. `BUILT` |
| 2 | **Twinning detection** — flags limbs moving in identical mirrored lockstep | The single most recognisable amateur tell in character animation. An app that catches it is giving real feedback, not generic tips. `BUILT` |
| 3 | **Pose contrast scoring** — warns when consecutive keys are too similar to read | Weak pose-to-pose contrast is why hand-posed animation looks mushy. Extends the existing coaching pillar. `BUILT` |
| 4 | **Auto-cut to the beat** — split a long take at bar boundaries | Extends beat-lock, which is already a headline feature, into editing. `BUILT` |
| 5 | **Moving holds** — a "held" pose that drifts slightly instead of freezing dead | A frozen pose reads as a broken app; a moving hold reads as intent. `BUILT` |
| 6 | **Reel export / import as a file** | Makes reels portable and is the honest substitute for cloud sharing. `BUILT` |
| 7 | **Shareable reel URL** — a whole reel encoded in a link | The closest thing to "watch my demo" that exists without a video. `BUILT` |
| 8 | **Golden-file tests for the audio generator** | The audio is generated, so it needs to be pinned; otherwise a refactor silently changes every track's tempo. `BUILT` |
| 9 | **Property tests for the interpolator** | Randomised rig/keyframe fuzzing over the code that runs every frame. `BUILT` |
| 10 | **Frame-accurate step navigation** — scrub key-to-key and in film frames, not seconds | Animators count frames, not seconds. `BUILT` |

### Built, then cut: line-of-action scoring

Ranked #4 and implemented — then removed. This rig places `torso` at the same
point as `hips` and `head` at the same point as `neck`, so the spine resolves to
just two distinct world positions. A two-point chain is straight by definition,
so the metric returned "stiff" for **every possible pose**. A coaching note that
fires 100% of the time regardless of what the user does is worse than no note at
all, so it was cut rather than shipped. The reasoning is recorded in
`Logic/PoseCritique.ts` so nobody rebuilds it without first giving the rig real
spine offsets.

## Tier 2 — high value, not built this run

12. Editor API scene-builder script (one command wires all 36 inputs) — *the biggest single unlock, but unverifiable here; see the note at the end*
13. Editor API scene validator reporting missing/mistyped inputs
14. Harness presentation mode (fullscreen, no dev panels, judge-facing)
15. Scripted auto-playing demo sequence in the harness
16. Animated GIF export of a reel from the harness canvas
17. PNG snapshot export of the stage
18. Pose thumbnail rendered onto each timeline chip
19. Keyboard shortcuts for every editor operation
20. Timeline zoom
21. Real pointer drag-and-drop chip reordering in the harness
22. Canvas camera orbit to view the puppet from another angle
23. CI workflow running typecheck + tests on push
24. Spacing/velocity graph per joint
25. Auto-suggest a breakdown pose between two keys
26. Anticipation auto-insert before a big move
27. Overshoot-and-settle auto-insert after a big move
28. Per-joint ease curves rather than per-clip
29. Keyframe favouring (bias the inbetween toward one key)
30. Broken-arc detection (a kink in a joint's path)
31. Silhouette readability scoring
32. Auto-trim dead frames from a take's head and tail
33. Loop-cycle detection (is this take already nearly cyclic?)
34. Dope sheet export as CSV

## Tier 3 — real, lower priority (35–78)

**Rig & character:** 35. rig symmetry validation · 36. joint limits so knees cannot invert · 37. per-archetype rest poses instead of all-identity · 38. height presets · 39. Snap3D prompt linting · 40. prompt variants per part · 41. archetype override · 42. custom prop joints · 43. accessory as its own part · 44. multi-accessory parsing · 45. colour extraction → material tint · 46. negative-prompt construction · 47. generation time/cost estimate · 48. deterministic character seed

**Timeline:** 49. nested sequences · 50. clip markers · 51. ripple vs overwrite edits · 52. snap-to-beat while dragging · 53. multi-select chips · 54. clip grouping · 55. reel templates · 56. A/B compare two takes · 57. per-clip version history · 58. non-destructive effect stack · 59. clip colour by source · 60. duplicate clip · 61. insert at playhead · 62. global reel retime · 63. duration target ("fit 30s")

**Audio:** 64. per-clip mood · 65. stem toggles · 66. bar-aligned render to the reel's exact length · 67. ducking under captions · 68. foley variation samples · 69. pitch variation on repeats · 70. end stinger · 71. metronome count-in · 72. beat-guided capture · 73. waveform under the timeline

**Motion polish:** 74. spring physics on chip reorder · 75. playhead motion-blur trail · 76. depth-coloured onion ghosts · 77. velocity-mapped arc ribbon thickness · 78. before/after split view for follow-through

## Tier 4 — unglamorous, worth doing eventually (79–95)

79. test coverage reporting · 80. architecture doc on the Logic/engine split · 81. performance budget test for interpolation · 82. harness bundle size check · 83. schema v1→v2 migrator · 84. corrupt-storage recovery UI · 85. storage quota eviction · 86. harness error boundary · 87. accessibility pass (ARIA, focus order) · 88. headless browser checks in `npm run verify` · 89. test-count badge · 90. joint labels on hover · 91. floor grid reference · 92. whole-reel ghost trail · 93. live arc-quality meter · 94. dark/light theme · 95. i18n scaffolding for status strings

## Tier 5 — considered and rejected (96–100)

96. **Cloud reel gallery** — plumbing a judge never sees, and there is no backend credential
97. **Real-time collaborative editing** — weeks of work, splits the demo's attention
98. **AI-generated animation from a text prompt** — removes the thing the tool is for (same reason it was rejected in round 1)
99. **Physics simulation on the puppet** — fights the stop-motion premise, which is deliberately non-physical
100. **In-Lens video export** — still not a documented capability; promising it would be dishonest

---

## Note on #12, the Editor API scene builder

It is the highest-impact unbuilt idea: it would collapse a 36-input manual
setup into one command. It is not built because it cannot be *run* here — no
Lens Studio — and shipping 400 lines of unverifiable editor automation would
add exactly the kind of unproven surface this project has been removing. It is
the correct first move the moment Lens Studio is open.
