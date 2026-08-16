export const MOODS = ["whimsical", "epic", "spooky", "bouncy"];
/** Lyria renders in bounded takes; longer reels loop or crossfade two takes. */
export const MAX_MUSIC_SECONDS = 30;
const MOOD_PROFILES = {
    whimsical: {
        adjectives: "playful, light-hearted, curious",
        instruments: "pizzicato strings, celesta, muted xylophone, brushed percussion",
        feel: "storybook, gentle swing",
    },
    epic: {
        adjectives: "heroic, sweeping, cinematic",
        instruments: "full strings, french horns, taiko drums, choir pads",
        feel: "rising, triumphant",
    },
    spooky: {
        adjectives: "eerie, creaking, mischievous",
        instruments: "toy piano, bowed saw, low clarinet, creaky woodblock",
        feel: "waltzing, off-kilter",
    },
    bouncy: {
        adjectives: "bright, springy, comic",
        instruments: "tuba, banjo, slap bass, hand percussion",
        feel: "cartoon chase, tight groove",
    },
};
export function moodProfile(mood) {
    return MOOD_PROFILES[mood] || MOOD_PROFILES.whimsical;
}
export function buildMusicPrompt(mood, rig, bpm, durationSeconds) {
    const profile = moodProfile(mood);
    const seconds = Math.min(Math.max(Math.round(durationSeconds), 4), MAX_MUSIC_SECONDS);
    return [
        `${profile.adjectives} instrumental theme for ${rig.subject}, a stop-motion puppet`,
        `${profile.instruments}`,
        `${profile.feel}`,
        `${Math.round(bpm)} BPM`,
        `${seconds} seconds`,
        "no vocals, seamless loop, clean tail",
    ].join(", ");
}
/**
 * Three foley sounds per character, generated once and reused for every accent
 * in the reel. Keeping the set small keeps generation time off the demo path.
 */
export function buildSfxPrompts(rig) {
    const material = rig.styleTokens[0] || "clay";
    return [
        {
            id: "step",
            prompt: `short soft ${material} footstep tap on a wooden table, dry, close mic, 0.3 seconds`,
        },
        {
            id: "whoosh",
            prompt: `quick light whoosh of a small ${material} puppet limb swinging, 0.4 seconds, no reverb tail`,
        },
        {
            id: "bonk",
            prompt: `comedic hollow bonk impact on ${material}, cartoon foley, 0.4 seconds`,
        },
    ];
}
/** Deterministic accent-to-sound mapping, so replays sound identical. */
export function sfxForAccent(jointId, positionDelta) {
    if (jointId && jointId.indexOf("leg") === 0) {
        return "step";
    }
    if (positionDelta > 6) {
        return "bonk";
    }
    return "whoosh";
}
/** How many music takes a reel of this length needs. */
export function musicTakeCount(durationSeconds) {
    if (durationSeconds <= MAX_MUSIC_SECONDS) {
        return 1;
    }
    return Math.min(2, Math.ceil(durationSeconds / MAX_MUSIC_SECONDS));
}
