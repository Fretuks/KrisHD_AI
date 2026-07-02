import {
    buildPersonaPrompt,
    buildRoleplayDirectionPrompt,
    buildRoleplayOpenerPrompt,
    buildRoleplayReplyGuardPrompt,
    buildRoleplaySceneSummary,
    buildUserPersonaPrompt,
    containsUserVoiceInRoleplayOpener
} from "./personaService.js";

export function createChatService(repositories, modelService, config) {
    const retryStylePrompts = {
        shorter: "Rewrite the assistant reply to be shorter and tighter while preserving its meaning.",
        direct: "Rewrite the assistant reply to be more direct and less padded.",
        emotional: "Rewrite the assistant reply to be more emotionally expressive without changing the core meaning.",
        "stay-in-character": "Rewrite the assistant reply to stay more strongly in character and voice.",
        dialogue: "Rewrite the assistant reply as dialogue only. Remove narration unless required for clarity."
    };

    const clampRetryActiveIndex = (index, variants) => {
        const numeric = Number(index);
        if (!Number.isInteger(numeric) || numeric < 0) return 0;
        return Math.min(numeric, Math.max(0, variants.length - 1));
    };

    const parseRetryVariants = (rawValue, content) => {
        if (!rawValue) return [content || ""];
        try {
            const parsed = JSON.parse(rawValue);
            if (Array.isArray(parsed)) {
                const normalized = parsed.map((item) => String(item || "").trim()).filter(Boolean);
                if (normalized.length) return normalized;
            }
        } catch {
            return [content || ""];
        }
        return [content || ""];
    };

    const formatChatMessage = (row) => {
        if (!row) return null;
        const retryVariants = parseRetryVariants(row.retry_variants, row.content);
        const retryActiveIndex = clampRetryActiveIndex(row.retry_active_index, retryVariants);
        return {
            id: row.id,
            role: row.role,
            content: row.content,
            modelName: row.model_name || null,
            retryVariants,
            retryActiveIndex,
            retryRetriesUsed: Number(row.retry_retries_used || 0),
            retryPromptMessageId: row.retry_prompt_message_id ?? null
        };
    };

    const insertChatMessage = (chatId, role, content, retryState = null, modelName = null) => {
        const normalizedContent = String(content || "");
        const payload = retryState
            ? {
                retryVariants: Array.isArray(retryState.retryVariants) && retryState.retryVariants.length ? retryState.retryVariants : [normalizedContent],
                retryActiveIndex: clampRetryActiveIndex(retryState.retryActiveIndex ?? 0, retryState.retryVariants || [normalizedContent]),
                retryRetriesUsed: Number(retryState.retryRetriesUsed || 0),
                retryPromptMessageId: retryState.retryPromptMessageId ?? null
            }
            : {
                retryVariants: [normalizedContent],
                retryActiveIndex: 0,
                retryRetriesUsed: 0,
                retryPromptMessageId: null
            };
        repositories.insertChatMessage(chatId, role, normalizedContent, payload, modelName);
    };

    const persistChatMessageRetryState = ({chatId, messageId, content, retryVariants, retryActiveIndex, retryRetriesUsed, retryPromptMessageId}) => {
        repositories.updateChatMessageRetryState(chatId, messageId, {
            content,
            retryVariants: retryVariants || [content || ""],
            retryActiveIndex: clampRetryActiveIndex(retryActiveIndex, retryVariants || [content || ""]),
            retryRetriesUsed: Number(retryRetriesUsed || 0),
            retryPromptMessageId: retryPromptMessageId ?? null
        });
    };

    const getChatMessageByIndex = (chatId, index) => {
        const safeIndex = Number(index);
        if (!Number.isInteger(safeIndex) || safeIndex < 0) return null;
        return repositories.getChatMessageByIndex(chatId, safeIndex) || null;
    };

    const buildMemoryPrompt = (memories) => {
        const facts = (memories || [])
            .map((memory) => String(memory.fact || "").trim())
            .filter(Boolean)
            .slice(0, 30);
        if (!facts.length) return null;
        return [
            "LONG-TERM MEMORY:",
            "These are durable facts the assistant should remember for this chat/persona context.",
            "Use them for continuity, but do not mention them unless relevant.",
            ...facts.map((fact, index) => `${index + 1}. ${fact}`)
        ].join("\n");
    };

    const clampSummary = (value) => {
        const normalized = String(value || "").trim();
        if (normalized.length <= config.chatSummaryMaxChars) return normalized;
        return `${normalized.slice(0, Math.max(0, config.chatSummaryMaxChars - 3)).trimEnd()}...`;
    };

    const buildContextSummaryPrompt = (summary) => {
        if (!summary) return null;
        return [
            "CONVERSATION SUMMARY:",
            "This is compressed background context from earlier messages in this chat.",
            "Use it for continuity. Recent raw messages below are more authoritative.",
            summary
        ].join("\n");
    };

    const formatMessagesForSummary = (messages) => messages.map((message) => {
        const speaker = message.role === "bot" ? "Assistant" : message.role === "user" ? "User" : message.role;
        return `${speaker}: ${String(message.content || "").trim()}`;
    }).join("\n\n");

    const maybeUpdateContextSummary = async ({user, chatId, selectedModel}) => {
        if (config.chatSummaryUpdateEveryMessages <= 0) return;
        const session = repositories.getChat(chatId, user);
        if (!session) return;
        const allMessages = repositories.listChatMessages(chatId);
        const keepRecent = Math.max(0, config.chatHistoryLimit);
        const cutoffIndex = allMessages.length - keepRecent - 1;
        if (cutoffIndex < 0) return;
        const cutoffMessage = allMessages[cutoffIndex];
        const summarizable = allMessages
            .filter((message) => message.id > Number(session.context_summary_message_id || 0) && message.id <= cutoffMessage.id);
        if (summarizable.length < config.chatSummaryUpdateEveryMessages) return;

        const previousSummary = String(session.context_summary || "").trim();
        const summary = await modelService.generateReply(selectedModel, [
            {
                role: "system",
                content: [
                    "You maintain a compact running summary for a chat application.",
                    "Merge the previous summary and new transcript into one concise continuity summary.",
                    "Preserve durable facts, decisions, goals, relationships, unresolved threads, locations, preferences, and roleplay continuity.",
                    "Do not invent details. Do not include generic filler. Keep it under 12 bullet points."
                ].join("\n")
            },
            {
                role: "user",
                content: [
                    previousSummary ? `Previous summary:\n${previousSummary}` : "Previous summary: none",
                    "",
                    "New transcript to compress:",
                    formatMessagesForSummary(summarizable)
                ].join("\n")
            }
        ]);

        const latestSummarized = summarizable[summarizable.length - 1];
        if (!latestSummarized || !summary) return;
        repositories.updateChatContextSummary(chatId, user, clampSummary(summary), latestSummarized.id);
    };

    const updateContextSummaryWithoutBreakingReply = async ({user, chatId, selectedModel}) => {
        try {
            await maybeUpdateContextSummary({user, chatId, selectedModel});
        } catch (error) {
            console.warn("CHAT SUMMARY UPDATE FAILED", chatId, error?.message || error);
        }
    };

    const getOrCreatePersonaChat = (user, persona, userPersonaId = null, scenarioPrompt = null, scenarioSummary = null) => {
        const existing = repositories.getChatByParticipants(user, persona.id, userPersonaId);
        if (existing) return existing;
        if (repositories.countChats(user) >= config.chatLimit) {
            throw new Error("CHAT_LIMIT_REACHED");
        }
        return repositories.createChat(user, persona.name, persona.id, userPersonaId, scenarioPrompt, scenarioSummary);
    };

    const generateRoleplayOpener = async ({selectedModel = "mistral:latest", assistantPersona, userPersona, scenarioPrompt, sceneSummary}) => {
        const baseMessages = [
            {role: "system", content: buildPersonaPrompt(assistantPersona)},
            ...(userPersona ? [{role: "system", content: buildUserPersonaPrompt(userPersona)}] : []),
            {role: "system", content: buildRoleplayDirectionPrompt({assistantPersona, userPersona, scenarioPrompt, sceneSummary})},
            {role: "user", content: buildRoleplayOpenerPrompt({assistantPersona, userPersona, scenarioPrompt, sceneSummary})}
        ];

        let opener = await modelService.generateReply(selectedModel, baseMessages);
        if (!containsUserVoiceInRoleplayOpener(opener, userPersona)) {
            return opener;
        }

        return modelService.generateReply(selectedModel, [
            ...baseMessages,
            {role: "assistant", content: opener || ""},
            {
                role: "user",
                content: "Rewrite this opening. Hard rule: only the assistant character may speak or act. Never write or imply user speech, thoughts, feelings, reactions, decisions, actions, or labels like 'User:'/'You:'. Stop before the user's reply."
            }
        ]);
    };

    const generateValidatedRoleplayReply = async ({selectedModel, messagesPayload, userPersona}) => {
        let reply = await modelService.generateReply(selectedModel, messagesPayload);
        if (reply && !containsUserVoiceInRoleplayOpener(reply, userPersona)) {
            return reply;
        }

        reply = await modelService.generateReply(selectedModel, [
            ...messagesPayload,
            {role: "assistant", content: reply || ""},
            {
                role: "user",
                content: "Rewrite your last reply. Hard rule: only the assistant character may speak or act. Never write or imply user speech, thoughts, feelings, reactions, decisions, or actions. Stop before the user's reply."
            }
        ]);

        if (!reply || containsUserVoiceInRoleplayOpener(reply, userPersona)) {
            return null;
        }
        return reply;
    };

    const appendRetryStyleInstruction = (messagesPayload, retryStyle) => {
        if (!retryStyle || !retryStylePrompts[retryStyle]) return messagesPayload;
        return [...messagesPayload, {role: "user", content: retryStylePrompts[retryStyle]}];
    };

    const buildRetryPayload = async ({chatId, user, session, selectedModel, targetMessage, retryStyle = null}) => {
        const activePersona = repositories.getAssistantPersonaForChat(chatId, user);
        const activeUserPersona = repositories.getUserPersonaForChat(chatId, user) || repositories.getActiveUserPersona(user);
        const promptMessage = repositories.getPreviousUserMessage(chatId, targetMessage.id);
        const memoryPrompt = buildMemoryPrompt(repositories.listChatMemories(chatId, user));

        if (!promptMessage) {
            if (!activePersona || !session.scenario_summary) {
                return {error: "No previous user prompt found for retry"};
            }
            const opener = await generateRoleplayOpener({
                selectedModel,
                assistantPersona: activePersona,
                userPersona: activeUserPersona,
                scenarioPrompt: session.scenario_prompt,
                sceneSummary: session.scenario_summary
            });
            if (!opener || containsUserVoiceInRoleplayOpener(opener, activeUserPersona)) {
                return {error: "Failed to regenerate message"};
            }
            return {fullReply: opener, promptMessageId: null};
        }

        const conversation = repositories.getRecentChatMessagesUpToId(chatId, promptMessage.id).reverse();
        const messagesPayload = [];
        if (activePersona) messagesPayload.push({role: "system", content: buildPersonaPrompt(activePersona)});
        if (activeUserPersona) messagesPayload.push({role: "system", content: buildUserPersonaPrompt(activeUserPersona)});
        if (activePersona && session.scenario_summary) {
            messagesPayload.push({
                role: "system",
                content: buildRoleplayDirectionPrompt({
                    assistantPersona: activePersona,
                    userPersona: activeUserPersona,
                    scenarioPrompt: session.scenario_prompt,
                    sceneSummary: session.scenario_summary
                })
            });
        }
        const contextSummaryPrompt = buildContextSummaryPrompt(session.context_summary);
        if (contextSummaryPrompt) messagesPayload.push({role: "system", content: contextSummaryPrompt});
        if (memoryPrompt) messagesPayload.push({role: "system", content: memoryPrompt});
        messagesPayload.push(...conversation.map((message) => ({
            role: message.role === "bot" ? "assistant" : "user",
            content: message.content
        })));
        if (activePersona) messagesPayload.push({role: "system", content: buildRoleplayReplyGuardPrompt()});

        const styledPayload = appendRetryStyleInstruction(messagesPayload, retryStyle);
        const fullReply = activePersona
            ? await generateValidatedRoleplayReply({selectedModel, messagesPayload: styledPayload, userPersona: activeUserPersona})
            : await modelService.generateReply(selectedModel, styledPayload);

        if (!fullReply) return {error: "Failed to regenerate message"};
        return {fullReply, promptMessageId: promptMessage.id};
    };

    return {
        formatChatMessage,
        getChatMessageByIndex,
        getOrCreatePersonaChat,
        buildRoleplaySceneSummary,
        generateRoleplayOpener,
        insertChatMessage,
        containsUserVoiceInRoleplayOpener,
        persistChatMessageRetryState,
        buildMessagesPayload({user, chatId, message}) {
            const session = repositories.getChat(chatId, user);
            if (!session) return null;
            const activePersona = repositories.getAssistantPersonaForChat(chatId, user);
            const activeUserPersona = repositories.getUserPersonaForChat(chatId, user) || repositories.getActiveUserPersona(user);
            const history = repositories.getRecentChatMessages(chatId).reverse();
            const conversation = [...history, {role: "user", content: message}];
            const messagesPayload = [];
            if (activePersona) messagesPayload.push({role: "system", content: buildPersonaPrompt(activePersona)});
            if (activeUserPersona) messagesPayload.push({role: "system", content: buildUserPersonaPrompt(activeUserPersona)});
            if (activePersona && session.scenario_summary) {
                messagesPayload.push({
                    role: "system",
                    content: buildRoleplayDirectionPrompt({
                        assistantPersona: activePersona,
                        userPersona: activeUserPersona,
                        scenarioPrompt: session.scenario_prompt,
                        sceneSummary: session.scenario_summary
                    })
                });
            }
            const contextSummaryPrompt = buildContextSummaryPrompt(session.context_summary);
            if (contextSummaryPrompt) messagesPayload.push({role: "system", content: contextSummaryPrompt});
            const memoryPrompt = buildMemoryPrompt(repositories.listChatMemories(chatId, user));
            if (memoryPrompt) messagesPayload.push({role: "system", content: memoryPrompt});
            messagesPayload.push(...conversation.map((entry) => ({
                role: entry.role === "bot" ? "assistant" : "user",
                content: entry.content
            })));
            if (activePersona) messagesPayload.push({role: "system", content: buildRoleplayReplyGuardPrompt()});
            return {session, activePersona, activeUserPersona, messagesPayload};
        },
        async sendChatMessage({user, chatId, message, model}) {
            const session = repositories.getChat(chatId, user);
            if (!session) return {error: "Chat not found", status: 404};

            const payload = this.buildMessagesPayload({user, chatId, message});

            insertChatMessage(chatId, "user", message);
            repositories.touchChat(chatId, user);
            const activePersona = payload.activePersona;
            const activeUserPersona = payload.activeUserPersona;
            const messagesPayload = payload.messagesPayload;

            const fullReply = activePersona
                ? await generateValidatedRoleplayReply({selectedModel: model, messagesPayload, userPersona: activeUserPersona})
                : await modelService.generateReply(model, messagesPayload);

            if (!fullReply) return {error: "Failed to generate a valid character reply", status: 500};

            insertChatMessage(chatId, "bot", fullReply, {
                retryVariants: [fullReply],
                retryActiveIndex: 0,
                retryRetriesUsed: 0,
                retryPromptMessageId: null
            }, model);
            repositories.touchChat(chatId, user);
            await updateContextSummaryWithoutBreakingReply({user, chatId, selectedModel: model});
            return {reply: fullReply};
        },
        async streamChatMessage({user, chatId, message, model, onChunk}) {
            const session = repositories.getChat(chatId, user);
            if (!session) return {error: "Chat not found", status: 404};

            const payload = this.buildMessagesPayload({user, chatId, message});

            insertChatMessage(chatId, "user", message);
            repositories.touchChat(chatId, user);
            const activePersona = payload.activePersona;
            const activeUserPersona = payload.activeUserPersona;
            const messagesPayload = payload.messagesPayload;

            const fullReply = activePersona
                ? await modelService.streamReply(model, messagesPayload, onChunk)
                : await modelService.streamReply(model, messagesPayload, onChunk);

            if (!fullReply) return {error: "Failed to generate a valid character reply", status: 500};
            if (activePersona && containsUserVoiceInRoleplayOpener(fullReply, activeUserPersona)) {
                return {error: "Failed to generate a valid character reply", status: 500};
            }
            insertChatMessage(chatId, "bot", fullReply, {
                retryVariants: [fullReply],
                retryActiveIndex: 0,
                retryRetriesUsed: 0,
                retryPromptMessageId: null
            }, model);
            repositories.touchChat(chatId, user);
            await updateContextSummaryWithoutBreakingReply({user, chatId, selectedModel: model});
            return {reply: fullReply};
        },
        async retryMessage({user, chatId, selectedModel, targetMessage, retryStyle = null}) {
            const session = repositories.getChat(chatId, user);
            if (!session) return {error: "Chat not found", status: 404};

            const retryResult = await buildRetryPayload({chatId, user, session, selectedModel, targetMessage, retryStyle});
            if (retryResult.error) return {error: retryResult.error, status: 400};

            const existingMessage = formatChatMessage(targetMessage);
            const retryVariants = [...existingMessage.retryVariants, retryResult.fullReply];
            persistChatMessageRetryState({
                chatId,
                messageId: targetMessage.id,
                content: retryResult.fullReply,
                retryVariants,
                retryActiveIndex: retryVariants.length - 1,
                retryRetriesUsed: existingMessage.retryRetriesUsed + 1,
                retryPromptMessageId: retryResult.promptMessageId
            });
            repositories.touchChat(chatId, user);
            return {
                message: formatChatMessage(repositories.getChatMessage(chatId, targetMessage.id)),
                promptMessageId: retryResult.promptMessageId,
                retryStyle
            };
        }
    };
}
