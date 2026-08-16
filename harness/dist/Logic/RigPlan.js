import { v3 } from "./Vec.js";
const MAX_PARTS = 7;
/** Default tabletop size. Small enough to sit on a real desk in AR. */
export const DEFAULT_HEIGHT_CM = 20;
const ARCHETYPE_KEYWORDS = [
    {
        archetype: "winged_biped",
        words: ["dragon", "wyvern", "griffin", "demon", "bat", "gargoyle", "fairy"],
    },
    {
        archetype: "bird",
        words: ["bird", "owl", "parrot", "chicken", "penguin", "crow", "duck", "eagle"],
    },
    {
        archetype: "quadruped",
        words: [
            "cat",
            "dog",
            "fox",
            "horse",
            "lion",
            "wolf",
            "bear",
            "cow",
            "deer",
            "tiger",
            "rabbit",
            "pig",
            "sheep",
            "lizard",
        ],
    },
    {
        archetype: "blob",
        words: ["blob", "slime", "ghost", "cloud", "jelly", "snowman", "mushroom", "pudding"],
    },
];
const STYLE_KEYWORDS = [
    "clay",
    "claymation",
    "plasticine",
    "wooden",
    "wood",
    "felt",
    "knitted",
    "yarn",
    "paper",
    "origami",
    "cardboard",
    "plush",
    "lego",
    "voxel",
    "pixel",
    "metal",
    "chrome",
    "stone",
    "glass",
    "neon",
    "cel-shaded",
    "toy",
];
/** Shared across every part so independently generated meshes still match. */
const STYLE_SUFFIX = "stop-motion puppet part, isolated single object, neutral rest pose, " +
    "matte texture, plain background, centered, no base, no stand";
// The article group requires trailing whitespace so "wearing armor" is not
// mis-parsed as article "a" + accessory "rmor".
const ACCESSORY_PATTERNS = [
    /\bwearing (?:(?:an?|the)\s+)?([^,.]+)/i,
    /\bin (?:an?|the)\s+([^,.]+)/i,
    /\bwith (?:an?|the)\s+([^,.]+)/i,
    /\bholding (?:(?:an?|the)\s+)?([^,.]+)/i,
];
/** Accessories that belong on the head rather than the body. */
const HEAD_ACCESSORIES = [
    "hat",
    "cap",
    "helmet",
    "crown",
    "glasses",
    "goggles",
    "mask",
    "horns",
    "scarf",
    "monocle",
    "headphones",
    "beanie",
    "tiara",
];
function normalize(text) {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
}
export function detectArchetype(description) {
    const text = normalize(description);
    for (const entry of ARCHETYPE_KEYWORDS) {
        for (const word of entry.words) {
            if (new RegExp(`\\b${word}s?\\b`).test(text)) {
                return entry.archetype;
            }
        }
    }
    return "biped";
}
export function detectStyleTokens(description) {
    const text = normalize(description);
    const found = [];
    for (const token of STYLE_KEYWORDS) {
        if (text.indexOf(token) !== -1 && found.indexOf(token) === -1) {
            found.push(token);
        }
    }
    // Nothing said about material: the app's own house style is claymation.
    return found.length > 0 ? found : ["clay", "claymation"];
}
export function detectAccessory(description) {
    for (const pattern of ACCESSORY_PATTERNS) {
        const match = pattern.exec(description);
        if (match && match[1]) {
            const value = match[1].trim();
            if (value.length > 0) {
                return value;
            }
        }
    }
    return null;
}
/** Description with the accessory clause removed, e.g. "a clay dragon". */
export function extractSubject(description) {
    let subject = description;
    for (const pattern of ACCESSORY_PATTERNS) {
        subject = subject.replace(pattern, "");
    }
    subject = subject.replace(/^\s*(a|an|the)\s+/i, "").replace(/[,.]+\s*$/, "");
    return normalize(subject) || normalize(description);
}
function accessoryGoesOnHead(accessory) {
    const text = normalize(accessory);
    return HEAD_ACCESSORIES.some((word) => text.indexOf(word) !== -1);
}
function skeletonFor(archetype) {
    switch (archetype) {
        case "winged_biped":
            return {
                torsoPromptName: "torso and chest",
                headPromptName: "head",
                headHeight: 0.3,
                torsoHeight: 0.4,
                neckOffset: v3(0, 8, 0),
                hipsOffset: v3(0, 0, 0),
                limbs: [
                    { jointId: "wing.L", parent: "torso", label: "Left wing", offset: v3(-4, 5, -1), promptName: "left wing", heightFraction: 0.45 },
                    { jointId: "wing.R", parent: "torso", label: "Right wing", offset: v3(4, 5, -1), promptName: "right wing", heightFraction: 0.45 },
                    { jointId: "leg.L", parent: "hips", label: "Left leg", offset: v3(-2, -1, 0), promptName: "left hind leg", heightFraction: 0.3 },
                    { jointId: "leg.R", parent: "hips", label: "Right leg", offset: v3(2, -1, 0), promptName: "right hind leg", heightFraction: 0.3 },
                    { jointId: "tail", parent: "hips", label: "Tail", offset: v3(0, 0, -3), promptName: "tail", heightFraction: 0.35 },
                ],
            };
        case "quadruped":
            return {
                torsoPromptName: "body and torso",
                headPromptName: "head",
                headHeight: 0.28,
                torsoHeight: 0.35,
                neckOffset: v3(0, 3, 5),
                hipsOffset: v3(0, 0, 0),
                limbs: [
                    { jointId: "leg.FL", parent: "torso", label: "Front left leg", offset: v3(-2.5, -2, 4), promptName: "front left leg", heightFraction: 0.4 },
                    { jointId: "leg.FR", parent: "torso", label: "Front right leg", offset: v3(2.5, -2, 4), promptName: "front right leg", heightFraction: 0.4 },
                    { jointId: "leg.BL", parent: "hips", label: "Back left leg", offset: v3(-2.5, -2, -4), promptName: "back left leg", heightFraction: 0.4 },
                    { jointId: "leg.BR", parent: "hips", label: "Back right leg", offset: v3(2.5, -2, -4), promptName: "back right leg", heightFraction: 0.4 },
                    { jointId: "tail", parent: "hips", label: "Tail", offset: v3(0, 1, -5), promptName: "tail", heightFraction: 0.3 },
                ],
            };
        case "bird":
            return {
                torsoPromptName: "body",
                headPromptName: "head and beak",
                headHeight: 0.3,
                torsoHeight: 0.4,
                neckOffset: v3(0, 7, 0),
                hipsOffset: v3(0, 0, 0),
                limbs: [
                    { jointId: "wing.L", parent: "torso", label: "Left wing", offset: v3(-3, 4, 0), promptName: "left wing", heightFraction: 0.4 },
                    { jointId: "wing.R", parent: "torso", label: "Right wing", offset: v3(3, 4, 0), promptName: "right wing", heightFraction: 0.4 },
                    { jointId: "leg.L", parent: "hips", label: "Left leg", offset: v3(-1.5, -1, 0), promptName: "left leg and foot", heightFraction: 0.25 },
                    { jointId: "leg.R", parent: "hips", label: "Right leg", offset: v3(1.5, -1, 0), promptName: "right leg and foot", heightFraction: 0.25 },
                ],
            };
        case "blob":
            return {
                torsoPromptName: "rounded body",
                headPromptName: "face",
                headHeight: 0.35,
                torsoHeight: 0.6,
                neckOffset: v3(0, 7, 0),
                hipsOffset: v3(0, 0, 0),
                limbs: [
                    { jointId: "arm.L", parent: "torso", label: "Left arm", offset: v3(-4, 4, 0), promptName: "left stubby arm", heightFraction: 0.3 },
                    { jointId: "arm.R", parent: "torso", label: "Right arm", offset: v3(4, 4, 0), promptName: "right stubby arm", heightFraction: 0.3 },
                ],
            };
        case "biped":
        default:
            return {
                torsoPromptName: "torso",
                headPromptName: "head",
                headHeight: 0.25,
                torsoHeight: 0.35,
                neckOffset: v3(0, 8, 0),
                hipsOffset: v3(0, 0, 0),
                limbs: [
                    { jointId: "arm.L", parent: "torso", label: "Left arm", offset: v3(-3.5, 6, 0), promptName: "left arm and hand", heightFraction: 0.35 },
                    { jointId: "arm.R", parent: "torso", label: "Right arm", offset: v3(3.5, 6, 0), promptName: "right arm and hand", heightFraction: 0.35 },
                    { jointId: "leg.L", parent: "hips", label: "Left leg", offset: v3(-2, -1, 0), promptName: "left leg and foot", heightFraction: 0.4 },
                    { jointId: "leg.R", parent: "hips", label: "Right leg", offset: v3(2, -1, 0), promptName: "right leg and foot", heightFraction: 0.4 },
                ],
            };
    }
}
function buildPrompt(subject, partName, styleTokens, accessory) {
    const style = styleTokens.join(" ");
    const extra = accessory ? `, ${accessory}` : "";
    return `the ${partName} of ${subject}${extra}, ${style}, ${STYLE_SUFFIX}`;
}
/**
 * Build a full rig plan from a spoken description.
 *
 * The joint tree is always rooted at `root` -> `hips` -> `torso` -> `neck` ->
 * `head`, with archetype-specific limbs hanging off `torso`/`hips`. Keeping the
 * spine names stable across archetypes means a clip recorded on a dragon still
 * partially applies to a robot.
 */
export function buildRigPlan(description, targetHeightCm = DEFAULT_HEIGHT_CM) {
    const cleaned = description.trim();
    if (cleaned.length === 0) {
        throw new Error("buildRigPlan: description is empty");
    }
    const archetype = detectArchetype(cleaned);
    const styleTokens = detectStyleTokens(cleaned);
    const accessory = detectAccessory(cleaned);
    const subject = extractSubject(cleaned);
    const skeleton = skeletonFor(archetype);
    const headAccessory = accessory && accessoryGoesOnHead(accessory) ? accessory : null;
    const bodyAccessory = accessory && !headAccessory ? accessory : null;
    const joints = [
        { id: "root", parent: null, offset: v3(0, 0, 0), poseable: false, label: "Character" },
        { id: "hips", parent: "root", offset: skeleton.hipsOffset, poseable: true, label: "Hips" },
        { id: "torso", parent: "hips", offset: v3(0, 0, 0), poseable: true, label: "Torso" },
        { id: "neck", parent: "torso", offset: skeleton.neckOffset, poseable: true, label: "Neck" },
        { id: "head", parent: "neck", offset: v3(0, 0, 0), poseable: true, label: "Head" },
    ];
    const parts = [
        {
            jointId: "torso",
            prompt: buildPrompt(subject, skeleton.torsoPromptName, styleTokens, bodyAccessory),
            heightFraction: skeleton.torsoHeight,
        },
        {
            jointId: "head",
            prompt: buildPrompt(subject, skeleton.headPromptName, styleTokens, headAccessory),
            heightFraction: skeleton.headHeight,
        },
    ];
    for (const limb of skeleton.limbs) {
        if (parts.length >= MAX_PARTS) {
            break;
        }
        joints.push({
            id: limb.jointId,
            parent: limb.parent,
            offset: limb.offset,
            poseable: true,
            label: limb.label,
        });
        parts.push({
            jointId: limb.jointId,
            prompt: buildPrompt(subject, limb.promptName, styleTokens, null),
            heightFraction: limb.heightFraction,
        });
    }
    return {
        description: cleaned,
        subject,
        accessory,
        archetype,
        styleTokens,
        joints,
        parts,
        targetHeightCm,
    };
}
export function poseableJointIds(plan) {
    return plan.joints.filter((j) => j.poseable).map((j) => j.id);
}
export function findJoint(plan, id) {
    for (const joint of plan.joints) {
        if (joint.id === id) {
            return joint;
        }
    }
    return null;
}
/**
 * Parents before children — the order joint SceneObjects must be created in.
 * Throws on a cycle or a missing parent so a malformed plan fails loudly at
 * build time instead of producing a half-attached puppet.
 */
export function jointsInBuildOrder(plan) {
    const remaining = plan.joints.slice();
    const built = {};
    const ordered = [];
    while (remaining.length > 0) {
        let progressed = false;
        for (let i = remaining.length - 1; i >= 0; i--) {
            const joint = remaining[i];
            if (joint.parent === null || built[joint.parent]) {
                ordered.push(joint);
                built[joint.id] = true;
                remaining.splice(i, 1);
                progressed = true;
            }
        }
        if (!progressed) {
            const orphans = remaining.map((j) => j.id).join(", ");
            throw new Error(`RigPlan has unreachable joints: ${orphans}`);
        }
    }
    return ordered;
}
