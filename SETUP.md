# Setup

## 1. Create the SPECS project

1. Install **Lens Studio 5.22+** — https://ar.snap.com/download
2. Lens Studio home → **SPECS** → **Base Template** → `File > Save As`.
3. Copy `Assets/Scripts/` from this repo into the new project's `Assets/` folder.

Do not copy `tsconfig.check.json`, `tsconfig.test.json`, `typings/`, `tests/`, or
`package.json` into the Lens project — Lens Studio generates its own TypeScript
config, and the vendored typings would fight the real ones. They live outside
`Assets/` for exactly this reason.

## 2. Install the packages

From the Asset Library (Spectacles section):

- **Spectacles Interaction Kit** → lands at `Assets/SpectaclesInteractionKit.lspkg/`
- **Remote Service Gateway** → lands at `Assets/Remote Service Gateway.lspkg/`

If either package folder is named differently in your version, update the import
paths at the top of:

- `Assets/Scripts/Puppeteer/JointHandles.ts`
- `Assets/Scripts/Timeline/TimelinePanel.ts`
- `Assets/Scripts/UI/PanelButton.ts`
- `Assets/Scripts/Character/Snap3DPartFactory.ts`

## 3. Tokens

`Windows > Remote Service Gateway Token` → generate a **Snap token** (covers
Snap3D) and paste it into the `RemoteServiceGatewayCredentials` component in the
scene. Tokens do not expire and work across projects.

Nothing else in this project needs a credential.

## 4. Scene objects to create

Create these under a `CharacterStudio` root, then assign them to the matching
inputs on the `ReelLifeApp` component:

| Input | What it is |
|---|---|
| `cameraObject` | The scene camera object |
| `studioRoot` | Empty object the character and ghosts are parented to |
| `placementReticle` | A flat disc/decal that follows the surface hit |
| `statusText` | A `Text` component for status messages |
| `voiceButton` … `newTakeButton` | 10 world-space quads with `Text` labels |
| `timelineRoot` | Empty object the timeline chips are laid out under |
| `captionRoot` / `captionText` | Empty object + `Text` for the floating caption |
| `chipMesh` | A **unit plane** mesh (1×1) — chips are scaled copies of it |
| `chipMaterial`, `chipActiveMaterial`, `handleMaterial`, `playheadMaterial` | Unlit materials for the timeline |
| `uiFont` | Any font asset |
| `characterMaterial` | The material generated parts are instantiated with |
| `ghostMaterials` | 2 translucent materials, most recent ghost first (e.g. 35% and 15% alpha) |
| `musicChannelA` / `musicChannelB` | Two `AudioComponent`s (two channels so mood changes crossfade) |
| `sfxStep` / `sfxWhoosh` / `sfxBonk` | Three `AudioComponent`s |
| `musicTracks` / `musicMoods` / `musicBpms` | Parallel arrays — see below |
| `asrModule` | An **ASR Module** asset |

Buttons only need a quad + collider; `PanelButton` attaches the SIK `Interactable`
itself if one isn't already there.

## 5. Music

Generate tracks with `/build-music` (Lyria), import them, then fill the three
parallel arrays:

| `musicTracks` | `musicMoods` | `musicBpms` |
|---|---|---|
| whimsical.mp3 | `whimsical` | `150` |
| epic.mp3 | `epic` | `120` |
| spooky.mp3 | `spooky` | `90` |
| bouncy.mp3 | `bouncy` | `140` |

**The BPM value matters.** It is the grid the app snaps your poses to, so it must
be the tempo the track was actually rendered at. A track with the wrong BPM
recorded against it will make the puppet miss the beat.

Valid moods are exactly `whimsical`, `epic`, `spooky`, `bouncy`. Rows with an
unrecognised mood or a non-positive BPM are logged and skipped rather than
silently mis-sequenced.

To generate a track tailored to a character you already made: run the Lens, look
in the Logger for the `music prompt for this character:` line, and feed that
string to `/build-music`. It already contains the subject, mood, tempo and length.

## 6. SFX

`/build-sfx` with the three prompts from `buildSfxPrompts()` in
`Logic/MusicPrompt.ts` — they inherit the character's material, so a wooden
puppet gets wooden footsteps. Assign the results to the three SFX audio
components.

## 7. Check it compiles

Lens Studio will report TypeScript errors in its own Logger. If you want to check
before opening the editor:

```bash
npm install && npm run verify
```

That typechecks against the vendored API subset in `typings/` and runs the test
suite. It cannot catch a mismatch between `typings/` and your installed package
versions — for that, the editor's own compile is the source of truth.
