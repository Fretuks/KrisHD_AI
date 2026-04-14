const PERSONA_FIELD_LIMITS = {
    name: 200,
    pronouns: 40,
    appearance: 9000,
    background: 9000,
    details: 9000,
    exampleDialogues: 12000
};

const blockedPersonaPatterns = [
    /\b(child|children|kid|kids|minor|underage|under-aged|teenager|young girl|young boy|loli|shota)\b/i,
    /\b(nazi|hitler|third reich|kkk|ku klux klan|white power|nigger|nigga)\b/i,
    /\b(rape|rapist|sexual assault|molest|molestation|incest|bestiality|zoophilia|necrophilia)\b/i,
    /\b(self-harm|self harm|suicide fetish)\b/i
];

const normalizePersonaField = (value) => {
    const trimmed = (value || "").trim();
    return trimmed || null;
};

export function validatePersonaPayload(payload, personaType = payload?.personaType) {
    const sanitized = {
        name: (payload?.name || "").trim(),
        pronouns: normalizePersonaField(payload?.pronouns),
        appearance: normalizePersonaField(payload?.appearance),
        background: normalizePersonaField(payload?.background),
        details: normalizePersonaField(payload?.details),
        exampleDialogues: personaType === "assistant" ? normalizePersonaField(payload?.exampleDialogues) : null
    };

    if (!sanitized.name) {
        return {error: "Name is required"};
    }

    for (const [key, limit] of Object.entries(PERSONA_FIELD_LIMITS)) {
        const value = sanitized[key];
        if (value && value.length > limit) {
            return {error: `${key.charAt(0).toUpperCase() + key.slice(1)} is too long`};
        }
    }

    const combinedText = Object.values(sanitized).filter(Boolean).join("\n");
    if (blockedPersonaPatterns.some((pattern) => pattern.test(combinedText))) {
        return {error: "This persona contains disallowed content. Remove sexual content involving minors, extreme sexual violence, or hateful/extremist material."};
    }

    return {value: sanitized};
}

export function normalizeOptionalText(value) {
    const normalized = String(value || "").trim();
    return normalized || null;
}

export function clampText(value, limit = 260) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (normalized.length <= limit) return normalized;
    return `${normalized.slice(0, limit - 3).trimEnd()}...`;
}

export function summarizePersona(persona) {
    if (!persona) return "";
    return [
        persona.name ? `Name: ${persona.name}` : null,
        persona.pronouns ? `Pronouns: ${persona.pronouns}` : null,
        persona.background ? `Background: ${persona.background}` : null,
        persona.details ? `Traits: ${persona.details}` : null
    ].filter(Boolean).join(" | ");
}

export function buildPersonaPrompt(persona) {
    const lines = [
        "SYSTEM ROLE:",
        "You are the AI assistant in this conversation.",
        "You must speak, think, and respond AS the persona described below.",
        "Do NOT speak as, write for, decide for, or roleplay as the user or the user's persona.",
        "Do NOT narrate the user's dialogue, thoughts, feelings, choices, or actions.",
        "Do NOT imply what the user says next, how they feel, what they decide, or what they physically do.",
        "Never complete both sides of the exchange. Only produce the assistant character's side.",
        "Do NOT switch roles or perspectives.",
        "Always respond in-character, using first-person language where appropriate.",
        "",
        "ASSISTANT PERSONA:"
    ];
    if (persona.name) lines.push(`Name: ${persona.name}`);
    if (persona.pronouns) lines.push(`Pronouns: ${persona.pronouns}`);
    if (persona.appearance) lines.push(`Appearance: ${persona.appearance}`);
    if (persona.background) lines.push(`Background: ${persona.background}`);
    if (persona.details) lines.push(`Additional Traits: ${persona.details}`);
    if (persona.example_dialogues) {
        lines.push("", "EXAMPLE DIALOGUES:");
        lines.push("Use these examples to mirror tone, cadence, and phrasing without rigidly repeating them.");
        lines.push(persona.example_dialogues);
    }
    return lines.join("\n");
}

export function buildUserPersonaPrompt(persona) {
    const lines = [
        "USER CONTEXT:",
        "The human user is roleplaying as the persona below.",
        "This information is for context only.",
        "Do NOT speak as this character.",
        "Do NOT write this character's dialogue, thoughts, feelings, choices, or actions unless the user explicitly supplies them.",
        "Do NOT predict, script, continue, or resolve the user's side of the scene.",
        "Respond TO this persona, not AS them.",
        "",
        "USER PERSONA:"
    ];
    if (persona.name) lines.push(`Name: ${persona.name}`);
    if (persona.pronouns) lines.push(`Pronouns: ${persona.pronouns}`);
    if (persona.appearance) lines.push(`Appearance: ${persona.appearance}`);
    if (persona.background) lines.push(`Background: ${persona.background}`);
    if (persona.details) lines.push(`Additional Traits: ${persona.details}`);
    return lines.join("\n");
}

export function buildRoleplaySceneSummary(assistantPersona, userPersona, scenarioPrompt = "") {
    const assistantName = assistantPersona?.name || "The assistant";
    const userName = userPersona?.name || "the user";
    const assistantHook = assistantPersona?.details || assistantPersona?.background || "stays strongly in character";
    const userHook = userPersona?.details || userPersona?.background || "enters the scene as themselves";
    const scenarioSeed = scenarioPrompt
        ? clampText(scenarioPrompt, 180)
        : `A fitting opening grows naturally from ${assistantName}'s role, goals, and manner toward ${userName}.`;
    return clampText(`${assistantName} leads the opening. Their approach is shaped by ${assistantHook}. ${userName} is framed through ${userHook}. Scene seed: ${scenarioSeed}`, 340);
}

export function buildRoleplayDirectionPrompt({assistantPersona, userPersona, scenarioPrompt, sceneSummary}) {
    const lines = [
        "ROLEPLAY DIRECTION:",
        "Create an immersive one-on-one roleplay between the assistant persona and the user.",
        "Ground the interaction in a specific scenario, place, and immediate dramatic situation.",
        "Make the assistant's first instinct, language, and priorities fit their persona exactly.",
        "Use the user persona as interaction context so the assistant addresses them in a fitting way.",
        "Format scene description, body language, and nonverbal actions in italics using *word*.",
        "Format direct speech in double quotes like \"word\".",
        "Format shouted words, sharp emphasis, or explosive expressions in bold using **word**.",
        "Keep formatting readable and intentional instead of wrapping every sentence in markdown.",
        "Avoid generic openings, meta commentary, and requests for permission to begin.",
        "Do not write dialogue, internal thoughts, choices, reactions, or actions for the user.",
        "Never output any lines like 'User:' or 'You:'.",
        "Never narrate what the user does, says, thinks, feels, wants, decides, notices, or remembers.",
        "Never include quoted text that belongs to the user.",
        "The opening must contain only the assistant character's own spoken words and optional self-actions.",
        "Prefer a concrete opening beat over vague exposition.",
        "Include a subtle hook, tension, invitation, or problem that gives the user something to respond to.",
        "",
        `SCENE SUMMARY: ${sceneSummary}`
    ];
    if (scenarioPrompt) lines.push(`USER SCENARIO SEED: ${scenarioPrompt}`);
    if (assistantPersona) lines.push("", `ASSISTANT SNAPSHOT: ${summarizePersona(assistantPersona)}`);
    if (userPersona) lines.push(`USER SNAPSHOT: ${summarizePersona(userPersona)}`);
    return lines.join("\n");
}

export function buildRoleplayOpenerPrompt({assistantPersona, userPersona, scenarioPrompt, sceneSummary}) {
    const assistantName = assistantPersona?.name || "the assistant";
    const userName = userPersona?.name || "the user";
    const sceneSeed = scenarioPrompt
        ? `Use this scenario seed: ${scenarioPrompt}`
        : `Invent a fresh scenario that suits ${assistantName} and how they would realistically meet or confront ${userName}.`;

    return [
        `Write the first in-character message from ${assistantName}.`,
        sceneSeed,
        `Address ${userName} naturally within the scene.`,
        "The message should establish the situation immediately instead of explaining setup out of character.",
        "Use 1 to 3 short paragraphs. Sensory detail is allowed, but keep momentum.",
        "Write scene description, body language, and nonverbal actions in italics using *word*.",
        "Write direct speech in double quotes like \"word\".",
        "Use bold markdown like **word** only for loud, forceful, or strongly emphasized expressions.",
        "Write only the assistant character's words and optional self-actions.",
        "Do not write any user dialogue, quoted lines, thoughts, feelings, reactions, choices, or actions.",
        "Do not use labels such as 'User:' or 'You:'.",
        "Do not script a back-and-forth exchange. Stop before the user's reply.",
        "End with a line, question, action, or reveal that gives the user an obvious way to answer.",
        `Keep this scene continuity in mind: ${sceneSummary}`
    ].join("\n");
}

export function buildRoleplayReplyGuardPrompt() {
    return [
        "ROLEPLAY REPLY RULES:",
        "Write only the assistant character's next reply.",
        "Never speak as the user.",
        "Never write the user's dialogue.",
        "Never write the user's thoughts, feelings, reactions, decisions, or actions.",
        "Never imply what the user says or does next.",
        "Never produce labels like 'User:' or 'You:'.",
        "Stop after the assistant character's own reply."
    ].join("\n");
}

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function containsUserVoiceInRoleplayOpener(opener, userPersona) {
    const text = String(opener || "").trim();
    if (!text) return true;

    const userName = (userPersona?.name || "").trim();
    const nameParts = userName ? userName.split(/\s+/).filter(Boolean).slice(0, 2) : [];
    const tokens = ["user", "you", ...nameParts].filter(Boolean).map(escapeRegExp);
    if (!tokens.length) return false;

    if (new RegExp(`(^|\\n)\\s*(?:${tokens.join("|")})\\s*:`, "i").test(text)) return true;
    if (new RegExp(`(^|\\n)\\s*(?:\\*\\s*)?(?:${tokens.join("|")})\\s+(?:say|says|said|ask|asks|asked|reply|replies|replied|think|thinks|thought|feel|feels|felt|walk|walks|walked|step|steps|stepped|look|looks|looked|nod|nods|nodded|smile|smiles|smiled|enter|enters|entered|turn|turns|turned)\\b`, "i").test(text)) return true;
    if (new RegExp(`["“][^"”\\n]{1,240}["”]\\s*(?:,?\\s*)?(?:${tokens.join("|")})\\s*(?:say|says|said|ask|asks|asked|reply|replies|replied|murmur|murmurs|murmured|whisper|whispers|whispered)\\b`, "i").test(text)) return true;
    return new RegExp(`(?:^|\\n|[.!?]\\s+)(?:${tokens.join("|")})\\s+(?:is|was|seems|looks|feels|hesitates|freezes|flinches|nods|smiles|frowns|steps|walks|turns|glances|stares|swallows|breathes)\\b`, "i").test(text);
}
