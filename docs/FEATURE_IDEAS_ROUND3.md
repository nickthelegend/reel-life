# 100 more ideas, round 3

Rounds [1](FEATURE_IDEAS.md) and [2](FEATURE_IDEAS_ROUND2.md) hold 200 ideas,
~42 built. Nothing here repeats them.

## The honest framing for this round

Two rounds of ranking put the same thing at or near the top and left it unbuilt:
**there is no artefact a judge can watch.** No Lens Studio, no Spectacles, no
demo video. Meanwhile the project has grown to 26 Logic modules and 343 tests —
all of it real, none of it visible.

A third hundred features on that same layer would make the imbalance worse, not
better. So this round is ranked almost entirely on one question: *does this put
something on a screen that a judge can look at?* The animation-craft ideas are
still here and still good, but they rank below output this time.

`BUILT` = built and verified this run.

---

## Tier 1 — built and verified

| # | Idea | Why it ranked first |
|---|---|---|
| 1 | **Animated GIF export of a reel** — a real GIF89a encoder, no dependencies | This is the missing deliverable. A GIF of the puppet performing, rendered from real reel data, is the closest thing to a demo video that exists without hardware — and it is something you can drop straight into a submission, a README, or a chat window. `BUILT` |
| 2 | **Contact sheet export** — every exposure as one grid image | The traditional way animators review timing at a glance, and a single still that shows an entire performance. `BUILT` |
| 3 | **Frame ruler and beat overlay on the timeline** | Makes the beat-lock feature *visible* rather than something you have to be told about. `BUILT` |
| 4 | **CI workflow** — typecheck + full suite on every push | 343 tests nobody runs automatically is a liability, not an asset. `BUILT` |

## Tier 2 — output and judge-facing artefacts (5–20)

5. APNG export (true colour, unlike GIF's 256) · 6. sprite-sheet export for game engines · 7. SVG/SMIL animation export · 8. Lottie JSON export · 9. WebCodecs MP4 export where available · 10. PNG frame sequence as a ZIP · 11. character turnaround sheet · 12. model sheet · 13. animated README thumbnail · 14. single-file HTML demo with everything inlined · 15. QR code for the shareable reel link · 16. generated docs site · 17. interactive architecture diagram · 18. Logic-layer dependency graph · 19. metrics dashboard (LOC, coverage, module count) · 20. "what to look at first" guided tour

## Tier 3 — animation craft still untapped (21–40)

21. spacing charts drawn along the arc · 22. breakdown-pose auto-generation · 23. slow-in/slow-out tick visualiser · 24. overlapping action with per-limb offsets · 25. successive breaking of joints · 26. path-of-action editing (drag the arc, not the joint) · 27. pose blending between two takes · 28. time-warp curve editor · 29. cycle phase offset · 30. motion trail labelled with frame numbers · 31. pose-to-pose vs straight-ahead indicator · 32. key/breakdown/inbetween classification · 33. animation-principles scorecard per take · 34. weight and momentum estimation · 35. contact/down/passing/up detection for walk cycles · 36. secondary-motion strength per limb · 37. drag ordering along a chain · 38. arc smoothing (fix a kinked path) · 39. pose mirroring across time (palindrome) · 40. automatic squash axis from travel direction

## Tier 4 — interaction depth (41–55)

41. two-handed whole-puppet scale · 42. joint pinning (hold a foot while posing the body) · 43. IK chain so dragging a hand bends the elbow · 44. snap joints to a grid · 45. live symmetry mode · 46. per-axis pose locking · 47. numeric pose entry · 48. gesture macros · 49. per-joint undo · 50. onion-skin scrubbing · 51. pose library across characters · 52. copy a limb's animation to another limb · 53. constrain a joint to a plane · 54. proportional editing (nearby joints follow) · 55. pose search ("find the frame where the arm is up")

## Tier 5 — audio (56–65)

56. live waveform of the playing track · 57. audio-reactive puppet scale · 58. tap-tempo · 59. time signatures beyond 4/4 · 60. swing/shuffle quantization · 61. per-take volume automation · 62. foley auto-assignment by joint type · 63. silence detection in a take · 64. music-driven keyframe suggestions · 65. stem toggles

## Tier 6 — motion polish (66–80)

66. easing curves drawn in the UI · 67. chip hover elevation · 68. selection ring pulse · 69. playhead snapping to exposures · 70. ghost fade-in on capture · 71. capture flash on the canvas · 72. counting-up numeric readouts · 73. joint size by hierarchy depth · 74. tapered bones · 75. contact shadow under the puppet · 76. depth cue via line width · 77. colour-coded limbs · 78. motion blur on fast joints · 79. stage vignette · 80. spring physics on chip reorder

## Tier 7 — robustness (81–92)

81. schema v1→v2 migrator · 82. LRU storage eviction · 83. import with a diff preview · 84. import conflict resolution · 85. autosave throttling · 86. partial-write crash recovery · 87. storage self-heal · 88. cross-version import · 89. clipboard integration for reel links · 90. duplicate-id collision handling · 91. pre-commit hook · 92. bundle size budget

## Tier 8 — rejected on merit (93–100)

93. **Mutation testing** — the suite is already the strongest part of the project; this is polishing the polished
94. **Semantic version tagging** — a hackathon project has one version
95. **Issue/PR templates** — no contributors
96. **Real-time multiplayer editing** — rejected in rounds 1 and 2 for the same reason: weeks of work, splits the demo
97. **Cloud gallery** — no backend credential exists
98. **Blockchain provenance for reels** — there is no chain in this project and bolting one on would be pure theatre
99. **AI-generated animation from a prompt** — removes the thing the tool is for
100. **In-Lens video export** — still not a documented capability

---

## A note on rounds 2 and 3 agreeing

Round 2 ranked the Editor API scene builder first and did not build it, because
it cannot be *run* here. That is still true. What changed is the recognition
that "make the work visible" had a second, buildable answer — render the
performance to an image format directly — and that answer does not need Lens
Studio at all.
