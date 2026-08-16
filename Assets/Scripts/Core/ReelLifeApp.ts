import WorldQueryModule from "LensStudio:WorldQueryModule";

import { ReelAudio, MusicTrack } from "../Audio/ReelAudio";
import { AssembledCharacter, CharacterAssembler } from "../Character/CharacterAssembler";
import { ReelStore, newId } from "../Character/ReelStore";
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
import { RigPlan, buildRigPlan } from "../Logic/RigPlan";
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

    this.updateButtonLabels();
  }

  private updateButtonLabels(): void {
    this.buttons.speed.setText(`${PLAYBACK_SPEEDS[this.speedIndex]}x`);
    this.buttons.mood.setText(this.mood);
    this.buttons.onion.setText(
      this.onion && this.onion.isVisible() ? "Onion: on" : "Onion: off"
    );
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

    this.document = createReelDocument(newId("reel"), plan, Date.now());
    this.document.mood = this.mood;
    this.timeline.clips = [];
    this.panel.rebuild();

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

    this.recorder = new PoseRecorder(this.character);
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
    this.setStatus("Pose a limb, then Capture Pose");
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

    this.timeline.add(clip);
    this.panel.rebuild();
    this.panel.select(clip.id);
    this.saveReel();
    this.setStatus(
      `${clip.name} added — ${clipDuration(clip).toFixed(1)}s at ${Math.round(this.grid.bpm)} BPM`
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
    this.setStatus("That's your reel — hit Play Reel again to re-record it");
    this.restorePose();
    this.setState("posing");
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
  // 6. Persistence
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
