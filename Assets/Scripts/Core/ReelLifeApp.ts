import WorldQueryModule from "LensStudio:WorldQueryModule";

import { ReelAudio, MusicTrack } from "../Audio/ReelAudio";
import { EditHistory } from "../Logic/EditHistory";
import { IdFactory, sessionSeedFromTime } from "../Logic/Ids";
import { DEFAULT_SECONDARY_MOTION, applySecondaryMotion } from "../Logic/SecondaryMotion";
import { HealthNote, describeStats, posterFrame, reelHealth, reelStats } from "../Logic/ReelStats";
import { ShootRate, createShootRate, describeShootRate, nextShootMode } from "../Logic/Stepped";
import { VoiceCommand, isCommand, parseVoiceCommand } from "../Logic/VoiceCommands";
import { mirrorClip, shouldSuggestSmoothing, smoothClip } from "../Logic/PoseOps";
import { loopBlendClip, reverseClip } from "../Logic/ClipOps";
import { AssembledCharacter, CharacterAssembler } from "../Character/CharacterAssembler";
import { ReelStore } from "../Character/ReelStore";
import { PartProgress, Snap3DPartFactory } from "../Character/Snap3DPartFactory";
import { Clip, clipDuration } from "../Logic/Clip";
import {
  BeatGrid,
  createBeatGrid,
  quantizeClip,
  suggestBpm,
} from "../Logic/BeatGrid";
import { MOODS, MoodTag, buildMusicPrompt } from "../Logic/MusicPrompt";
import { ReelDocument, createReelDocument } from "../Logic/ReelDocument";
import { ReelTimeline } from "../Logic/ReelTimeline";
import { RigPlan, buildRigPlan, poseableJointIds } from "../Logic/RigPlan";
import { PlacementHit, SurfacePlacer } from "../Placement/SurfacePlacer";
import { ReelPlayer } from "../Playback/ReelPlayer";
import { JointHandles } from "../Puppeteer/JointHandles";
import { OnionSkin, applyPoseTo } from "../Puppeteer/OnionSkin";
import { PoseRecorder } from "../Puppeteer/PoseRecorder";
import { CaptionBillboard } from "../Timeline/CaptionBillboard";
import { TimelinePanel } from "../Timeline/TimelinePanel";
import { PanelButton } from "../UI/PanelButton";
import { VoicePromptController } from "../Voice/VoicePromptController";
import { Log, describeError, setLogLevel } from "./Log";

/**
 * Reel Life — a spatial stop-motion animation studio.
 *
 * Speak a character into existence, drop it on your table, pose it frame by
 * frame with your hands, then cut the takes together on an AR timeline and play
 * the whole thing back, scored and captioned.
 *
 * This component owns the state machine and wires the pieces together; the
 * pieces themselves are plain classes so the logic they carry can be tested
 * without the engine.
 */

type AppState =
  | "idle"
  | "listening"
  | "generating"
  | "placing"
  | "posing"
  | "playing";

const PLAYBACK_SPEEDS = [1, 2, 0.5];

@component
export class ReelLifeApp extends BaseScriptComponent {
  // --- Scene wiring -------------------------------------------------------
  @input cameraObject: SceneObject;
  @input studioRoot: SceneObject;
  @input placementReticle: SceneObject;
  @input statusText: Text;

  // --- Buttons ------------------------------------------------------------
  @input voiceButton: SceneObject;
  @input placeButton: SceneObject;
  @input capturePoseButton: SceneObject;
  @input recordPerformanceButton: SceneObject;
  @input playPreviewButton: SceneObject;
  @input playReelButton: SceneObject;
  @input onionSkinButton: SceneObject;
  @input speedButton: SceneObject;
  @input moodButton: SceneObject;
  @input newTakeButton: SceneObject;
  @input shootModeButton: SceneObject;
  @input undoButton: SceneObject;

  // --- Timeline & captions ------------------------------------------------
  @input timelineRoot: SceneObject;
  @input captionRoot: SceneObject;
  @input captionText: Text;
  @input chipMesh: RenderMesh;
  @input chipMaterial: Material;
  @input chipActiveMaterial: Material;
  @input handleMaterial: Material;
  @input playheadMaterial: Material;
  @input uiFont: Font;

  // --- Character rendering ------------------------------------------------
  @input characterMaterial: Material;
  @hint("One translucent material per onion-skin layer, most recent first.")
  @input ghostMaterials: Material[];

  // --- Audio --------------------------------------------------------------
  @input musicChannelA: AudioComponent;
  @input musicChannelB: AudioComponent;
  @input sfxStep: AudioComponent;
  @input sfxWhoosh: AudioComponent;
  @input sfxBonk: AudioComponent;
  @hint("Tracks rendered by /build-music. Keep the three arrays aligned.")
  @input musicTracks: AudioTrackAsset[];
  @input musicMoods: string[];
  @input musicBpms: number[];

  // --- Speech -------------------------------------------------------------
  @input asrModule: AsrModule;

  // --- Runtime ------------------------------------------------------------
  private log = new Log("App");
  private state: AppState = "idle";

  private store = new ReelStore();
  private timeline = new ReelTimeline();
  private previewTimeline = new ReelTimeline();
  private grid: BeatGrid = createBeatGrid();
  private mood: MoodTag = "whimsical";
  private speedIndex = 0;
  private shootRate: ShootRate = createShootRate("twos");
  private history = new EditHistory();
  private ids = new IdFactory(sessionSeedFromTime(Date.now()));
  private followThrough = true;

  private voice: VoicePromptController;
  private placer: SurfacePlacer;
  private audio: ReelAudio;
  private caption: CaptionBillboard;
  private panel: TimelinePanel;

  private character: AssembledCharacter | null = null;
  private handles: JointHandles | null = null;
  private onion: OnionSkin | null = null;
  private recorder: PoseRecorder | null = null;
  private player: ReelPlayer | null = null;
  private document: ReelDocument | null = null;

  private buttons: Record<string, PanelButton> = {};
  private partProgress: Record<string, PartProgress> = {};
  private captioningClipId: string | null = null;

  onAwake(): void {
    setLogLevel("info");
    this.createEvent("OnStartEvent").bind(() => this.onStart());
    this.createEvent("UpdateEvent").bind(() => this.onUpdate());
  }

  private onStart(): void {
    if (!this.validateInputs()) {
      return;
    }
    this.audio = new ReelAudio(
      this.musicChannelA,
      this.musicChannelB,
      {
        step: this.sfxStep,
        whoosh: this.sfxWhoosh,
        bonk: this.sfxBonk,
      },
      this.readMusicTracks()
    );

    this.caption = new CaptionBillboard(
      this.captionRoot,
      this.captionText,
      this.cameraObject
    );

    this.voice = new VoicePromptController(this.asrModule, {
      onListeningChanged: (listening) => this.audio.setDucked(listening),
      onInterim: (text) => this.setStatus(`"${text}"`),
      onFinal: (text) => this.onSpeech(text),
      onError: (message) => this.setStatus(message),
    });

    this.placer = new SurfacePlacer(
      WorldQueryModule,
      this.cameraObject,
      this.placementReticle,
      {
        onReadyChanged: () => {},
        onStatus: (message) => this.setStatus(message),
      }
    );

    this.panel = new TimelinePanel(
      this.timeline,
      {
        parent: this.timelineRoot,
        chipMesh: this.chipMesh,
        chipMaterial: this.chipMaterial,
        chipActiveMaterial: this.chipActiveMaterial,
        handleMaterial: this.handleMaterial,
        playheadMaterial: this.playheadMaterial,
        font: this.uiFont,
        chipWidthCm: 8,
        chipHeightCm: 4.5,
        gapCm: 1,
      },
      {
        onReorder: () => this.afterEdit(),
        onTrimChanged: () => this.afterEdit(),
        onSelect: (clipId) => this.setStatus(`Selected ${clipId}`),
        onRequestCaption: (clipId) => this.beginCaption(clipId),
      }
    );

    this.bindButtons();
    this.placementReticle.enabled = false;
    this.setState("idle");
    this.restoreLastReel();
  }

  /**
   * Fail loudly at startup if the scene is not wired up.
   *
   * This component has a lot of inputs. A missing one otherwise surfaces as a
   * null dereference several seconds later, in a callback, with no clue which
   * field was forgotten — which is exactly the experience of opening someone
   * else's hackathon project.
   */
  private validateInputs(): boolean {
    const required: Array<[string, unknown]> = [
      ["cameraObject", this.cameraObject],
      ["studioRoot", this.studioRoot],
      ["placementReticle", this.placementReticle],
      ["statusText", this.statusText],
      ["voiceButton", this.voiceButton],
      ["placeButton", this.placeButton],
      ["capturePoseButton", this.capturePoseButton],
      ["recordPerformanceButton", this.recordPerformanceButton],
      ["playPreviewButton", this.playPreviewButton],
      ["playReelButton", this.playReelButton],
      ["onionSkinButton", this.onionSkinButton],
      ["speedButton", this.speedButton],
      ["moodButton", this.moodButton],
      ["newTakeButton", this.newTakeButton],
      ["shootModeButton", this.shootModeButton],
      ["undoButton", this.undoButton],
      ["timelineRoot", this.timelineRoot],
      ["captionRoot", this.captionRoot],
      ["captionText", this.captionText],
      ["chipMesh", this.chipMesh],
      ["chipMaterial", this.chipMaterial],
      ["chipActiveMaterial", this.chipActiveMaterial],
      ["handleMaterial", this.handleMaterial],
      ["playheadMaterial", this.playheadMaterial],
      ["uiFont", this.uiFont],
      ["characterMaterial", this.characterMaterial],
      ["musicChannelA", this.musicChannelA],
      ["musicChannelB", this.musicChannelB],
      ["sfxStep", this.sfxStep],
      ["sfxWhoosh", this.sfxWhoosh],
      ["sfxBonk", this.sfxBonk],
      ["asrModule", this.asrModule],
    ];

    const missing = required.filter((entry) => !entry[1]).map((entry) => entry[0]);
    if (!this.ghostMaterials || this.ghostMaterials.length === 0) {
      missing.push("ghostMaterials (need at least one translucent material)");
    }

    if (missing.length > 0) {
      const message = `ReelLifeApp is missing ${missing.length} input(s): ${missing.join(", ")}`;
      this.log.error(message);
      if (this.statusText) {
        this.statusText.text = message;
      }
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  private onUpdate(): void {
    const now = getTime();
    this.audio.update(now);
    this.caption.update(now);

    if (this.state === "placing") {
      this.placer.update(now);
    }
    if (this.state === "posing" && this.recorder) {
      this.recorder.update(now);
    }
    if (this.state === "playing" && this.player) {
      this.player.update(now);
      this.panel.setPlayhead(this.player.elapsedSeconds());
    }
  }

  // -------------------------------------------------------------------------
  // Buttons
  // -------------------------------------------------------------------------

  private bindButtons(): void {
    this.buttons.voice = new PanelButton(this.voiceButton, {
      onPress: () => this.startListening(),
      onRelease: () => this.voice.stop(),
    });

    this.buttons.place = new PanelButton(this.placeButton, {
      onTap: () => this.confirmPlacement(),
    });

    this.buttons.capture = new PanelButton(this.capturePoseButton, {
      onTap: () => this.capturePose(),
    });

    this.buttons.record = new PanelButton(this.recordPerformanceButton, {
      onPress: () => this.startPerformance(),
      onRelease: () => this.stopPerformance(),
    });

    this.buttons.preview = new PanelButton(this.playPreviewButton, {
      onTap: () => this.playPreview(),
    });

    this.buttons.playReel = new PanelButton(this.playReelButton, {
      onTap: () => this.playReel(),
    });

    this.buttons.onion = new PanelButton(this.onionSkinButton, {
      onTap: () => this.toggleOnionSkin(),
    });

    this.buttons.speed = new PanelButton(this.speedButton, {
      onTap: () => this.cycleSpeed(),
    });

    this.buttons.mood = new PanelButton(this.moodButton, {
      onTap: () => this.cycleMood(),
    });

    this.buttons.newTake = new PanelButton(this.newTakeButton, {
      onTap: () => this.finishTake(),
    });

    this.buttons.shootMode = new PanelButton(this.shootModeButton, {
      onTap: () => this.cycleShootMode(),
    });

    this.buttons.undo = new PanelButton(this.undoButton, {
      onTap: () => this.undo(),
      // Hold to redo: a second button for something used once a session is not
      // worth the space on a world-space panel.
      onPress: () => {},
    });

    this.updateButtonLabels();
  }

  private updateButtonLabels(): void {
    this.buttons.speed.setText(`${PLAYBACK_SPEEDS[this.speedIndex]}x`);
    this.buttons.mood.setText(this.mood);
    this.buttons.onion.setText(
      this.onion && this.onion.isVisible() ? "Onion: on" : "Onion: off"
    );
    this.buttons.shootMode.setText(describeShootRate(this.shootRate));
    this.buttons.undo.setText(this.history.canUndo() ? "Undo" : "Undo —");
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  private setState(state: AppState): void {
    this.state = state;
    const posing = state === "posing";
    const placing = state === "placing";

    this.buttons.voice.setVisible(state === "idle" || state === "listening");
    this.buttons.place.setVisible(placing);
    this.buttons.capture.setVisible(posing);
    this.buttons.record.setVisible(posing);
    this.buttons.preview.setVisible(posing);
    this.buttons.newTake.setVisible(posing);
    this.buttons.onion.setVisible(posing);
    this.buttons.playReel.setVisible(posing || state === "playing");
    this.buttons.shootMode.setVisible(posing || state === "playing");
    this.buttons.undo.setVisible(posing);
    this.buttons.speed.setVisible(posing || state === "playing");
    this.buttons.mood.setVisible(posing || state === "playing");
    this.timelineRoot.enabled = posing || state === "playing";

    if (this.handles) {
      this.handles.setEnabled(posing);
    }
    this.log.info(`state -> ${state}`);
  }

  private setStatus(message: string): void {
    this.statusText.text = message;
  }

  // -------------------------------------------------------------------------
  // 1. Voice -> character
  // -------------------------------------------------------------------------

  private startListening(): void {
    if (this.state === "generating") {
      return;
    }
    if (this.captioningClipId) {
      this.voice.start();
      return;
    }
    this.setState("listening");
    this.setStatus("Listening — describe your character");
    this.voice.start();
  }

  private onSpeech(text: string): void {
    if (this.captioningClipId) {
      this.applyCaption(this.captioningClipId, text);
      return;
    }

    // A short known phrase is an editor command; anything else is a character
    // description. The parser is deliberately strict so "a clay dragon holding
    // a tiny stop sign" never fires the stop command.
    const command = parseVoiceCommand(text);
    if (isCommand(command) && this.character) {
      this.runCommand(command);
      return;
    }

    this.generateCharacter(text).catch((error) => {
      this.setStatus(`Generation failed: ${describeError(error)}`);
      this.setState("idle");
    });
  }

  private async generateCharacter(description: string): Promise<void> {
    let plan: RigPlan;
    try {
      plan = buildRigPlan(description);
    } catch (error) {
      this.setStatus(describeError(error));
      this.setState("idle");
      return;
    }

    this.setState("generating");
    this.partProgress = {};
    this.setStatus(`Sculpting ${plan.parts.length} parts for "${plan.subject}"...`);
    this.log.info(`music prompt for this character: ${buildMusicPrompt(this.mood, plan, this.grid.bpm, 20)}`);

    const factory = new Snap3DPartFactory(true);
    const generated = await factory.generate(plan, (progress) => {
      this.partProgress[progress.jointId] = progress;
      this.setStatus(this.describeProgress(plan));
    });

    this.store.rememberRig(plan);
    this.buildCharacter(plan, generated.assets);

    this.document = createReelDocument(this.ids.next("reel"), plan, Date.now());
    this.document.mood = this.mood;
    this.timeline.clips = [];
    this.panel.rebuild();
    this.history.clear();
    this.history.commit("new character", []);

    this.setState("placing");
    this.placer.begin();
  }

  private describeProgress(plan: RigPlan): string {
    let done = 0;
    const lines: string[] = [];
    for (const part of plan.parts) {
      const progress = this.partProgress[part.jointId];
      const stage = progress ? progress.message : "waiting";
      if (progress && progress.stage === "done") {
        done++;
      }
      lines.push(`${part.jointId}: ${stage}`);
    }
    return `Sculpting ${done}/${plan.parts.length}\n${lines.join("\n")}`;
  }

  private buildCharacter(plan: RigPlan, assets: Record<string, GltfAsset>): void {
    this.disposeCharacter();

    const assembler = new CharacterAssembler(this.characterMaterial);
    this.character = assembler.assemble(plan, assets, this.studioRoot);

    // Start a comfortable arm's length in front of the viewer until placed.
    const cameraTransform = this.cameraObject.getTransform();
    const forward = cameraTransform.forward.uniformScale(-60);
    this.character.root
      .getTransform()
      .setWorldPosition(cameraTransform.getWorldPosition().add(forward));

    this.handles = new JointHandles(this.character, {
      onGrabStart: (jointId) => this.setStatus(`Posing ${jointId}`),
      onGrabEnd: () => this.setStatus("Capture Pose when it looks right"),
      onHover: () => {},
    });
    this.handles.build();

    this.onion = new OnionSkin(plan, assets, this.studioRoot, this.ghostMaterials);
    this.onion.build();

    this.recorder = new PoseRecorder(this.character, this.ids);
    this.player = new ReelPlayer(this.character, this.timeline, {
      onClipChanged: (index) => this.panel.select(this.timeline.clips[index].id),
      onCaption: (text) => this.caption.show(text, getTime()),
      onAccent: (accent) => this.audio.triggerSfx(accent.sfxId, accent.strength, getTime()),
      onProgress: () => {},
      onFinished: () => this.onPlaybackFinished(),
    });
  }

  private disposeCharacter(): void {
    if (this.onion) {
      this.onion.destroy();
      this.onion = null;
    }
    if (this.character) {
      this.character.root.destroy();
      this.character = null;
    }
    this.handles = null;
    this.recorder = null;
    this.player = null;
  }

  // -------------------------------------------------------------------------
  // 2. Placement
  // -------------------------------------------------------------------------

  private confirmPlacement(): void {
    const hit = this.placer.confirm();
    if (!hit || !this.character) {
      return;
    }
    this.anchorCharacter(hit);
    this.setState("posing");
    this.showHealth();
  }

  private anchorCharacter(hit: PlacementHit): void {
    const transform = this.character!.root.getTransform();
    transform.setWorldPosition(hit.position);
    // Stand the puppet up on the surface rather than lying along its normal.
    transform.setWorldRotation(quat.quatIdentity());
    if (this.onion) {
      this.onion.alignTo(this.character!);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Posing
  // -------------------------------------------------------------------------

  private capturePose(): void {
    if (!this.recorder) {
      return;
    }
    const clip = this.recorder.capturePose();
    this.audio.triggerSfx("step", 0.5, getTime());
    this.refreshOnionSkin();
    this.setStatus(`${clip.keyframes.length} poses in ${clip.name}`);
  }

  private startPerformance(): void {
    if (!this.recorder || this.state !== "posing") {
      return;
    }
    this.recorder.startPerformance(getTime());
    this.setStatus("Recording — move your puppet");
  }

  private stopPerformance(): void {
    if (!this.recorder || !this.recorder.isRecording()) {
      return;
    }
    const clip = this.recorder.stopPerformance();
    this.refreshOnionSkin();
    if (clip) {
      this.setStatus(`Captured ${clip.keyframes.length} samples`);
    }
  }

  private refreshOnionSkin(): void {
    if (!this.onion || !this.recorder) {
      return;
    }
    this.onion.showPoses(this.recorder.recentPoses(this.onion.layerCount()));
  }

  private toggleOnionSkin(): void {
    if (!this.onion) {
      return;
    }
    this.onion.setVisible(!this.onion.isVisible());
    this.refreshOnionSkin();
    this.updateButtonLabels();
  }

  /** Close the current take, quantize it to the beat, and add it to the reel. */
  private finishTake(): void {
    if (!this.recorder) {
      return;
    }
    const clip = this.recorder.finishClip();
    if (!clip) {
      this.setStatus("Nothing captured in this take yet");
      return;
    }

    this.grid = createBeatGrid(this.audio.activeBpm(suggestBpm([clip])), 2);
    if (clip.source === "stopmotion") {
      // Snapping a live performance would destroy its timing; stop-motion poses
      // are deliberate, so landing them on the beat only helps.
      quantizeClip(clip, this.grid);
    }

    // Bake in follow-through: limbs trail and whip, which hand-posing cannot
    // produce because every joint is placed at the same instant.
    const finished =
      this.followThrough && this.character
        ? applySecondaryMotion(clip, this.character.plan, DEFAULT_SECONDARY_MOTION)
        : clip;

    this.timeline.add(finished);
    this.panel.rebuild();
    this.panel.select(finished.id);
    this.commitHistory(`add ${finished.name}`);

    if (
      this.character &&
      shouldSuggestSmoothing(finished, poseableJointIds(this.character.plan))
    ) {
      this.setStatus(`${finished.name} is shaky — say "smooth it" to steady it`);
      return;
    }
    this.setStatus(
      `${finished.name} added — ${clipDuration(finished).toFixed(1)}s at ${Math.round(this.grid.bpm)} BPM`
    );
  }

  // -------------------------------------------------------------------------
  // 4. Playback
  // -------------------------------------------------------------------------

  private playPreview(): void {
    if (!this.player || !this.recorder) {
      return;
    }
    const active = this.recorder.activeClip();
    const clip = active && active.keyframes.length > 0 ? active : this.selectedClip();
    if (!clip) {
      this.setStatus("Capture a couple of poses first");
      return;
    }

    this.previewTimeline.clips = [clip];
    this.previewTimeline.loop = true;
    this.previewTimeline.playbackSpeed = PLAYBACK_SPEEDS[this.speedIndex];
    this.player.setTimeline(this.previewTimeline);
    this.player.play(getTime(), true);
    this.setState("playing");
    this.setStatus(`Previewing ${clip.name}`);
  }

  private playReel(): void {
    if (!this.player) {
      return;
    }
    if (this.state === "playing") {
      this.stopPlayback();
      return;
    }
    if (this.timeline.isEmpty()) {
      this.setStatus("Add a take to the reel first (New Take)");
      return;
    }

    this.timeline.loop = false;
    this.timeline.playbackSpeed = PLAYBACK_SPEEDS[this.speedIndex];
    this.player.setTimeline(this.timeline);
    this.audio.playMood(this.mood, getTime());
    this.player.play(getTime(), true);
    this.setState("playing");
    this.setStatus(
      `Playing ${this.timeline.clips.length} takes · ${this.timeline.playbackDuration().toFixed(1)}s`
    );
  }

  private stopPlayback(): void {
    if (this.player) {
      this.player.stop();
    }
    this.audio.stopMusic();
    this.caption.hide(getTime());
    this.restorePose();
    this.setState("posing");
  }

  private onPlaybackFinished(): void {
    this.audio.stopMusic();
    this.caption.hide(getTime());
    this.setState("posing");

    if (!this.character) {
      return;
    }

    // Land on the strongest pose in the reel rather than wherever it stopped —
    // that frame is the one worth holding while the credits-equivalent shows.
    const poster = posterFrame(this.timeline, this.character.plan);
    if (poster && this.player) {
      this.player.seek(poster.globalT);
      this.panel.setPlayhead(poster.globalT);
      this.panel.select(poster.clipId);
    } else {
      this.restorePose();
    }

    const stats = reelStats(this.timeline, this.character.plan, this.grid.bpm);
    this.setStatus(describeStats(stats));
  }

  /** Leave the puppet on its last captured pose rather than mid-tween. */
  private restorePose(): void {
    if (!this.character || !this.recorder) {
      return;
    }
    const recent = this.recorder.recentPoses(1);
    if (recent.length > 0) {
      applyPoseTo(this.character, recent[0]);
    }
  }

  private cycleSpeed(): void {
    this.speedIndex = (this.speedIndex + 1) % PLAYBACK_SPEEDS.length;
    const speed = PLAYBACK_SPEEDS[this.speedIndex];
    this.timeline.playbackSpeed = speed;
    this.previewTimeline.playbackSpeed = speed;
    this.updateButtonLabels();
    this.setStatus(`Playback speed ${speed}x`);
  }

  private cycleMood(): void {
    const index = MOODS.indexOf(this.mood);
    this.mood = MOODS[(index + 1) % MOODS.length];
    const track = this.audio.playMood(this.mood, getTime());
    this.updateButtonLabels();

    if (!track) {
      this.setStatus(`No ${this.mood} track imported yet`);
      return;
    }
    this.regrid(track.bpm);
    this.setStatus(`${this.mood} · ${track.bpm} BPM — poses snapped to the beat`);
  }

  /**
   * Re-snap every stop-motion take to a new tempo. This is what makes the
   * puppet land on the beat of whichever track is playing.
   */
  private regrid(bpm: number): void {
    this.grid = createBeatGrid(bpm, 2);
    for (const clip of this.timeline.clips) {
      if (clip.source === "stopmotion") {
        quantizeClip(clip, this.grid);
      }
    }
    this.panel.refresh();
    this.saveReel();
  }

  // -------------------------------------------------------------------------
  // 5. Captions
  // -------------------------------------------------------------------------

  private beginCaption(clipId: string): void {
    this.captioningClipId = clipId;
    this.setStatus("Hold the mic button and say your caption");
    this.buttons.voice.setVisible(true);
  }

  private applyCaption(clipId: string, text: string): void {
    const clip = this.timeline.get(clipId);
    this.captioningClipId = null;
    this.buttons.voice.setVisible(this.state === "idle" || this.state === "listening");
    if (!clip) {
      return;
    }
    clip.caption = text;
    this.panel.refresh();
    this.caption.show(text, getTime());
    this.saveReel();
    this.setStatus(`Caption set: "${text}"`);
  }

  // -------------------------------------------------------------------------
  // 6. Hands-free commands
  // -------------------------------------------------------------------------

  /** Run an editor command spoken aloud while both hands hold the puppet. */
  private runCommand(command: VoiceCommand): void {
    switch (command.kind) {
      case "capture":
        this.capturePose();
        break;
      case "new_take":
        this.finishTake();
        break;
      case "play":
        this.playReel();
        break;
      case "stop":
        this.stopPlayback();
        break;
      case "undo":
        this.undo();
        break;
      case "redo":
        this.redo();
        break;
      case "delete_last":
        this.deleteLastTake();
        break;
      case "mirror":
        this.transformSelected("mirror");
        break;
      case "reverse":
        this.transformSelected("reverse");
        break;
      case "smooth":
        this.transformSelected("smooth");
        break;
      case "loop":
        this.transformSelected("loop");
        break;
      case "faster":
      case "slower":
        this.cycleSpeed();
        break;
      case "shoot_mode":
        this.cycleShootMode();
        break;
      case "next_mood":
        this.cycleMood();
        break;
      case "onion":
        this.toggleOnionSkin();
        break;
      case "none":
        break;
    }
    this.log.info(`voice command: ${command.kind} ("${command.heard}")`);
  }

  /** Apply a non-destructive transform to the selected take. */
  private transformSelected(kind: "mirror" | "reverse" | "smooth" | "loop"): void {
    const clip = this.selectedClip();
    if (!clip) {
      this.setStatus("Select a take on the timeline first");
      return;
    }

    const id = this.ids.next("clip");
    const replacement =
      kind === "mirror"
        ? mirrorClip(clip, id)
        : kind === "reverse"
          ? reverseClip(clip, id)
          : kind === "smooth"
            ? smoothClip(clip, id)
            : loopBlendClip(clip, id);

    if (!replacement) {
      this.setStatus(`${clip.name} is too short to ${kind}`);
      return;
    }

    const index = this.timeline.indexOf(clip.id);
    this.timeline.clips[index] = replacement;
    this.panel.rebuild();
    this.panel.select(replacement.id);
    this.commitHistory(`${kind} ${clip.name}`);
    this.setStatus(`${replacement.name}`);
  }

  private deleteLastTake(): void {
    if (this.timeline.isEmpty()) {
      this.setStatus("Nothing to delete");
      return;
    }
    const clip = this.timeline.clips[this.timeline.clips.length - 1];
    this.timeline.remove(clip.id);
    this.panel.rebuild();
    this.commitHistory(`delete ${clip.name}`);
    this.setStatus(`Deleted ${clip.name} — say "undo" to get it back`);
  }

  private cycleShootMode(): void {
    this.shootRate = createShootRate(nextShootMode(this.shootRate.mode));
    if (this.player) {
      this.player.setShootRate(this.shootRate);
    }
    this.updateButtonLabels();
    this.setStatus(
      this.shootRate.mode === "smooth"
        ? "Smooth playback — good for flowing motion"
        : `Shooting ${describeShootRate(this.shootRate)} — real stop-motion cadence`
    );
  }

  // -------------------------------------------------------------------------
  // 7. Undo
  // -------------------------------------------------------------------------

  private commitHistory(label: string): void {
    this.history.commit(label, this.timeline.clips);
    this.updateButtonLabels();
    this.saveReel();
  }

  private undo(): void {
    const entry = this.history.undo();
    if (!entry) {
      this.setStatus("Nothing to undo");
      return;
    }
    this.applyHistoryEntry(entry.clips);
    this.setStatus(`Undid ${this.history.redoLabel() || "that"}`);
  }

  private redo(): void {
    const entry = this.history.redo();
    if (!entry) {
      this.setStatus("Nothing to redo");
      return;
    }
    this.applyHistoryEntry(entry.clips);
    this.setStatus(`Redid ${entry.label}`);
  }

  private applyHistoryEntry(clips: Clip[]): void {
    this.timeline.clips = clips;
    this.panel.rebuild();
    this.updateButtonLabels();
    this.saveReel();
  }

  // -------------------------------------------------------------------------
  // 8. Coaching
  // -------------------------------------------------------------------------

  /**
   * Show the most useful thing the app has to say about the reel right now.
   * This is also the empty state: with nothing recorded it explains what to do.
   */
  private showHealth(): void {
    if (!this.character) {
      this.setStatus("Hold the mic and describe a character");
      return;
    }
    const notes: HealthNote[] = reelHealth(this.timeline, this.character.plan);
    if (notes.length === 0) {
      this.setStatus("Looking good — hit Play Reel");
      return;
    }
    this.setStatus(notes[0].message);
  }

  // -------------------------------------------------------------------------
  // 9. Persistence
  // -------------------------------------------------------------------------

  private afterEdit(): void {
    this.panel.refresh();
    this.saveReel();
  }

  private saveReel(): void {
    if (!this.document) {
      return;
    }
    this.document.clips = this.timeline.clips;
    this.document.bpm = this.grid.bpm;
    this.document.mood = this.mood;
    this.document.playbackSpeed = PLAYBACK_SPEEDS[this.speedIndex];
    this.store.saveReel(this.document);
  }

  /**
   * Reels persist, meshes cannot. On restart the edit is restored immediately
   * and the exact prompts are on hand to regenerate the character.
   */
  private restoreLastReel(): void {
    const doc = this.store.loadLastReel();
    if (!doc) {
      this.setStatus("Hold the mic and describe a character");
      return;
    }
    this.document = doc;
    this.mood = doc.mood;
    this.grid = createBeatGrid(doc.bpm, 2);
    this.timeline.clips = doc.clips;
    this.panel.rebuild();
    this.history.clear();
    this.history.commit("restored", doc.clips);
    for (const clip of doc.clips) {
      this.ids.observe(clip.id);
    }
    this.ids.observe(doc.id);
    this.updateButtonLabels();
    this.setStatus(
      `Restored "${doc.title}" with ${doc.clips.length} takes — hold the mic to rebuild the character`
    );
  }

  private selectedClip(): Clip | null {
    const id = this.panel.selectedClip();
    return id ? this.timeline.get(id) : null;
  }

  // -------------------------------------------------------------------------

  /** Zip the three parallel music inputs into validated track entries. */
  private readMusicTracks(): MusicTrack[] {
    const tracks: MusicTrack[] = [];
    if (!this.musicTracks) {
      return tracks;
    }
    for (let i = 0; i < this.musicTracks.length; i++) {
      const moodName = this.musicMoods && i < this.musicMoods.length ? this.musicMoods[i] : "";
      const mood = MOODS.indexOf(moodName as MoodTag) >= 0 ? (moodName as MoodTag) : null;
      const bpm = this.musicBpms && i < this.musicBpms.length ? this.musicBpms[i] : 0;

      if (!mood || bpm <= 0) {
        this.log.warn(
          `music track ${i} is missing a valid mood or BPM and will be ignored`
        );
        continue;
      }
      tracks.push({ mood, track: this.musicTracks[i], bpm });
    }
    return tracks;
  }
}
