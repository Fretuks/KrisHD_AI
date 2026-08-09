const VALID_PERSONA_TYPES = new Set(["assistant", "user"]);
const VALID_MESSAGE_ROLES = new Set(["user", "bot", "assistant", "system"]);

const asArray = (value) => Array.isArray(value) ? value : [];
const normalizeText = (value) => String(value ?? "").trim();
const optionalText = (value) => {
    const normalized = normalizeText(value);
    return normalized || null;
};
const normalizeKey = (value) => normalizeText(value).toLowerCase();

function countBy(items, getKey) {
    const counts = new Map();
    for (const item of items) {
        const key = getKey(item);
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function duplicateNames(items, getKey) {
    return Array.from(countBy(items, getKey).entries())
        .filter(([, count]) => count > 1)
        .map(([key]) => key);
}

function validatePersona(persona, index, errors) {
    if (!persona || typeof persona !== "object" || Array.isArray(persona)) {
        errors.push(`Persona ${index + 1} must be an object.`);
        return null;
    }
    const name = normalizeText(persona.name);
    const personaType = normalizeText(persona.persona_type || persona.personaType || "assistant");
    if (!name) errors.push(`Persona ${index + 1} is missing a name.`);
    if (!VALID_PERSONA_TYPES.has(personaType)) errors.push(`Persona ${index + 1} has invalid persona_type.`);
    return {
        name,
        pronouns: optionalText(persona.pronouns),
        appearance: optionalText(persona.appearance),
        background: optionalText(persona.background),
        details: optionalText(persona.details),
        example_dialogues: optionalText(persona.example_dialogues || persona.exampleDialogues),
        persona_type: VALID_PERSONA_TYPES.has(personaType) ? personaType : "assistant"
    };
}

function validateTemplate(template, index, errors) {
    if (!template || typeof template !== "object" || Array.isArray(template)) {
        errors.push(`Template ${index + 1} must be an object.`);
        return null;
    }
    const name = normalizeText(template.name);
    const promptText = normalizeText(template.prompt_text || template.promptText);
    if (!name) errors.push(`Template ${index + 1} is missing a name.`);
    if (!promptText) errors.push(`Template ${index + 1} is missing prompt_text.`);
    return {
        name,
        description: optionalText(template.description),
        category: optionalText(template.category),
        prompt_text: promptText,
        starter_text: optionalText(template.starter_text || template.starterText),
        is_shared: Boolean(template.is_shared || template.isShared)
    };
}

function validateMessage(message, chatIndex, messageIndex, errors) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
        errors.push(`Chat ${chatIndex + 1}, message ${messageIndex + 1} must be an object.`);
        return null;
    }
    const role = normalizeText(message.role);
    const content = normalizeText(message.content);
    if (!VALID_MESSAGE_ROLES.has(role)) errors.push(`Chat ${chatIndex + 1}, message ${messageIndex + 1} has invalid role.`);
    if (!content) errors.push(`Chat ${chatIndex + 1}, message ${messageIndex + 1} is missing content.`);
    const retryVariants = Array.isArray(message.retryVariants)
        ? message.retryVariants.map((item) => String(item ?? "")).filter(Boolean)
        : Array.isArray(message.retry_variants)
            ? message.retry_variants.map((item) => String(item ?? "")).filter(Boolean)
            : [content].filter(Boolean);
    return {
        role: role === "assistant" ? "bot" : role,
        content,
        model_name: optionalText(message.model_name || message.modelName),
        retryVariants,
        retryActiveIndex: Number.isInteger(Number(message.retryActiveIndex)) ? Number(message.retryActiveIndex) : 0,
        retryRetriesUsed: Number.isInteger(Number(message.retryRetriesUsed)) ? Number(message.retryRetriesUsed) : 0,
        retryPromptMessageId: Number.isInteger(Number(message.retryPromptMessageId)) ? Number(message.retryPromptMessageId) : null
    };
}

function validateMemory(memory, chatIndex, memoryIndex, errors) {
    if (typeof memory === "string") {
        const fact = normalizeText(memory);
        if (!fact) errors.push(`Chat ${chatIndex + 1}, memory ${memoryIndex + 1} is empty.`);
        return {fact};
    }
    if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
        errors.push(`Chat ${chatIndex + 1}, memory ${memoryIndex + 1} must be an object.`);
        return null;
    }
    const fact = normalizeText(memory.fact);
    if (!fact) errors.push(`Chat ${chatIndex + 1}, memory ${memoryIndex + 1} is missing fact.`);
    return {fact};
}

function validatePersonaState(state, chatIndex, errors) {
    if (state == null) return null;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        errors.push(`Chat ${chatIndex + 1}, persona_state must be an object.`);
        return null;
    }
    return {
        relationship_notes: optionalText(state.relationship_notes || state.relationshipNotes),
        tone: optionalText(state.tone),
        current_location: optionalText(state.current_location || state.currentLocation),
        goals: optionalText(state.goals),
        unresolved_threads: optionalText(state.unresolved_threads || state.unresolvedThreads),
        boundaries: optionalText(state.boundaries)
    };
}

function validateChat(chat, index, errors) {
    if (!chat || typeof chat !== "object" || Array.isArray(chat)) {
        errors.push(`Chat ${index + 1} must be an object.`);
        return null;
    }
    const title = normalizeText(chat.stored_title || chat.title || "Imported chat") || "Imported chat";
    const messages = asArray(chat.messages).map((message, messageIndex) => validateMessage(message, index, messageIndex, errors)).filter(Boolean);
    const memories = asArray(chat.memories).map((memory, memoryIndex) => validateMemory(memory, index, memoryIndex, errors)).filter(Boolean);
    const personaState = validatePersonaState(chat.persona_state || chat.personaChatState, index, errors);
    return {
        title,
        stored_title: title,
        folder_name: optionalText(chat.folder_name || chat.folderName),
        is_pinned: Boolean(chat.is_pinned || chat.isPinned),
        archived_at: optionalText(chat.archived_at || chat.archivedAt),
        scenario_prompt: optionalText(chat.scenario_prompt || chat.scenarioPrompt),
        scenario_summary: optionalText(chat.scenario_summary || chat.scenarioSummary),
        context_summary: optionalText(chat.context_summary || chat.contextSummary),
        context_summary_message_id: Number.isInteger(Number(chat.context_summary_message_id || chat.contextSummaryMessageId))
            ? Number(chat.context_summary_message_id || chat.contextSummaryMessageId)
            : 0,
        messages,
        memories,
        persona_state: personaState
    };
}

export function validateWorkspaceImport(workspace, existingWorkspace = null) {
    const errors = [];
    const warnings = [];

    if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
        return {
            ok: false,
            errors: ["Workspace import must be a JSON object."],
            warnings,
            preview: {personas: 0, chats: 0, messages: 0, memories: 0, templates: 0, duplicates: []},
            workspace: {personas: [], chats: [], templates: []}
        };
    }

    for (const field of ["personas", "chats", "templates"]) {
        if (workspace[field] != null && !Array.isArray(workspace[field])) {
            errors.push(`workspace.${field} must be an array.`);
        }
    }

    const sanitized = {
        personas: asArray(workspace.personas).map((persona, index) => validatePersona(persona, index, errors)).filter(Boolean),
        chats: asArray(workspace.chats).map((chat, index) => validateChat(chat, index, errors)).filter(Boolean),
        templates: asArray(workspace.templates).map((template, index) => validateTemplate(template, index, errors)).filter(Boolean)
    };

    const duplicates = [
        ...duplicateNames(sanitized.personas, (persona) => normalizeKey(`${persona.persona_type}:${persona.name}`)).map((name) => `Duplicate persona in import: ${name}`),
        ...duplicateNames(sanitized.chats, (chat) => normalizeKey(chat.title)).map((title) => `Duplicate chat title in import: ${title}`),
        ...duplicateNames(sanitized.templates, (template) => normalizeKey(template.name)).map((name) => `Duplicate template in import: ${name}`)
    ];

    if (existingWorkspace) {
        const existingPersonaKeys = new Set(asArray(existingWorkspace.personas).map((persona) => normalizeKey(`${persona.persona_type}:${persona.name}`)));
        const existingChatTitles = new Set(asArray(existingWorkspace.chats).map((chat) => normalizeKey(chat.stored_title || chat.title)));
        const existingTemplateNames = new Set(asArray(existingWorkspace.templates).map((template) => normalizeKey(template.name)));
        for (const persona of sanitized.personas) {
            if (existingPersonaKeys.has(normalizeKey(`${persona.persona_type}:${persona.name}`))) duplicates.push(`Persona already exists: ${persona.name}`);
        }
        for (const chat of sanitized.chats) {
            if (existingChatTitles.has(normalizeKey(chat.title))) duplicates.push(`Chat title already exists: ${chat.title}`);
        }
        for (const template of sanitized.templates) {
            if (existingTemplateNames.has(normalizeKey(template.name))) duplicates.push(`Template already exists: ${template.name}`);
        }
    }

    warnings.push(...duplicates);
    const preview = {
        personas: sanitized.personas.length,
        chats: sanitized.chats.length,
        messages: sanitized.chats.reduce((sum, chat) => sum + chat.messages.length, 0),
        memories: sanitized.chats.reduce((sum, chat) => sum + chat.memories.length, 0),
        templates: sanitized.templates.length,
        duplicates
    };

    if (!preview.personas && !preview.chats && !preview.templates) {
        errors.push("Workspace import does not contain any personas, chats, or templates.");
    }

    return {ok: errors.length === 0, errors, warnings, preview, workspace: sanitized};
}
