import { Log } from "../Core/Log";

/**
 * Hold-to-talk character prompting.
 *
 * One button: press and hold, describe the character, release. Interim results
 * stream to the label so the user can see they are being heard, and the final
 * transcription is what gets turned into a rig.
 */

export interface VoicePromptCallbacks {
  onListeningChanged: (listening: boolean) => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

const ASR_ERRORS: Record<number, string> = {
  0: "Speech recognition hit an internal error",
  1: "Speech recognition is not authenticated — check the Lens permissions",
  2: "Speech recognition needs an internet connection",
};

export class VoicePromptController {
  private log = new Log("Voice");
  private listening = false;
  private latest = "";

  constructor(
    private asrModule: AsrModule,
    private callbacks: VoicePromptCallbacks
  ) {}

  isListening(): boolean {
    return this.listening;
  }

  start(): void {
    if (this.listening) {
      return;
    }
    this.latest = "";
    this.listening = true;
    this.callbacks.onListeningChanged(true);

    const options = AsrModule.AsrTranscriptionOptions.create();
    options.mode = AsrModule.AsrMode.HighAccuracy;
    // Long enough that a thoughtful pause mid-description is not treated as the
    // end of the sentence.
    options.silenceUntilTerminationMs = 1200;

    options.onTranscriptionUpdateEvent.add((event) => {
      if (!this.listening) {
        return;
      }
      const text = (event.text || "").trim();
      if (text.length > 0) {
        this.latest = text;
      }
      if (event.isFinal) {
        this.finish();
      } else {
        this.callbacks.onInterim(text);
      }
    });

    options.onTranscriptionErrorEvent.add((code) => {
      const message = ASR_ERRORS[code] || `Speech recognition failed (code ${code})`;
      this.log.error(message);
      this.listening = false;
      this.callbacks.onListeningChanged(false);
      this.callbacks.onError(message);
    });

    this.asrModule.startTranscribing(options);
    this.log.info("listening");
  }

  /** Called on button release: stop the mic and use whatever was heard. */
  stop(): void {
    if (!this.listening) {
      return;
    }
    this.asrModule.stopTranscribing();
    this.finish();
  }

  private finish(): void {
    if (!this.listening) {
      return;
    }
    this.listening = false;
    this.callbacks.onListeningChanged(false);

    const text = this.latest.trim();
    if (text.length === 0) {
      this.callbacks.onError("I didn't catch that — hold the button and describe a character");
      return;
    }
    this.log.info(`heard: "${text}"`);
    this.callbacks.onFinal(text);
  }
}
