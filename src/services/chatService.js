import {
    buildPersonaPrompt,
    buildRoleplayDirectionPrompt,
    buildRoleplayOpenerPrompt,
    buildRoleplayReplyGuardPrompt,
    buildRoleplaySceneSummary,
    buildUserPersonaPrompt,
    containsUserVoiceInRoleplayOpener
} from "./personaService.js";
import {
    buildContextSummaryPrompt,
    buildMemoryPrompt,
    buildPersonaStatePrompt,
    clampRetryActiveIndex,
    formatChatMessage,
    formatMessagesForSummary,
    retryStylePrompts
} from "./chatMessageHelpers.js";

export function createChatService(repositories, modelService, config) {
    const chatGenerationQueues = new Map();
    const summaryQueues = new Map();
    const activeGenerations = new Map();
    const maxRetries = Number(config.chatMaxRetries ?? 5);

    const insertChatMessage = (chatId, role, content, retryState = null, modelName = null, deliveryStatus = "complete", errorMessage = null) => {
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
        return repositories.insertChatMessage(chatId, role, normalizedContent, payload, modelName, deliveryStatus, errorMessage);
    };

    const withChatGenerationLock = (chatId, operation) => {
        const previous = chatGenerationQueues.get(chatId) || Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);
        chatGenerationQueues.set(chatId, current);
        return current.finally(() => {
            if (chatGenerationQueues.get(chatId) === current) chatGenerationQueues.delete(chatId);
        });
    };

    const withActiveGeneration = async (chatId, externalSignal, operation) => {
        const controller = new AbortController();
        const abortFromCaller = () => controller.abort(externalSignal?.reason);
        if (externalSignal?.aborted) abortFromCaller();
        else externalSignal?.addEventListener("abort", abortFromCaller, {once: true});
        activeGenerations.set(chatId, controller);
        try {
            return await operation(controller.signal);
        } finally {
            if (activeGenerations.get(chatId) === controller) activeGenerations.delete(chatId);
            externalSignal?.removeEventListener("abort", abortFromCaller);
        }
    };

    const getGenerationSettings = (session, requestedModel) => ({
        model: session.preferred_model || requestedModel || "mistral:latest",
        generation: {
            temperature: session.temperature ?? undefined,
            contextLength: session.context_length ?? undefined,
            responseLength: session.response_length ?? undefined
        }
    });

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

    const clampSummary = (value) => {
        const normalized = String(value || "").trim();
        if (normalized.length <= config.chatSummaryMaxChars) return normalized;
        return `${normalized.slice(0, Math.max(0, config.chatSummaryMaxChars - 3)).trimEnd()}...`;
    };

    const maybeUpdateContextSummary = async ({user, chatId, selectedModel}) => {
        if (config.chatSummaryUpdateEveryMessages <= 0) return;
        const session = repositories.getChat(chatId, user);
        if (!session) return;
        const allMessages = repositories.listActiveBranchMessages(chatId)
            .filter((message) => !message.delivery_status || message.delivery_status === "complete");
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

    const scheduleContextSummaryUpdate = ({user, chatId, selectedModel}) => {
        const previous = summaryQueues.get(chatId) || Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(() => updateContextSummaryWithoutBreakingReply({user, chatId, selectedModel}));
        summaryQueues.set(chatId, current);
        void current.finally(() => {
            if (summaryQueues.get(chatId) === current) summaryQueues.delete(chatId);
        });
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

    const generateValidatedRoleplayReply = async ({selectedModel, messagesPayload, userPersona, signal = null, generation = {}}) => {
        let reply = await modelService.generateReply(selectedModel, messagesPayload, {signal, generation});
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
        ], {signal, generation});

        if (!reply || containsUserVoiceInRoleplayOpener(reply, userPersona)) {
            return null;
        }
        return reply;
    };

    const appendRetryStyleInstruction = (messagesPayload, retryStyle) => {
        if (!retryStyle || !retryStylePrompts[retryStyle]) return messagesPayload;
        return [...messagesPayload, {role: "user", content: retryStylePrompts[retryStyle]}];
    };

    const getUserPersonaForSession = (chatId, user, session, activePersona) => {
        const chatPersona = repositories.getUserPersonaForChat(chatId, user);
        if (chatPersona || activePersona) return chatPersona || null;
        return repositories.getActiveUserPersona(user);
    };

    const buildConversationContext = ({user, chatId, session = null, message, upToMessageId = null}) => {
        const activeSession = session || repositories.getChat(chatId, user);
        if (!activeSession) return null;
        const activePersona = repositories.getAssistantPersonaForChat(chatId, user);
        const activeUserPersona = getUserPersonaForSession(chatId, user, activeSession, activePersona);
        const history = upToMessageId == null
            ? repositories.getRecentChatMessages(chatId).reverse()
            : repositories.getRecentChatMessagesUpToId(chatId, upToMessageId).reverse();
        const conversation = message == null ? history : [...history, {role: "user", content: message}];
        const messagesPayload = [];
        if (activeSession.system_instruction) {
            messagesPayload.push({role: "system", content: `CHAT-SPECIFIC INSTRUCTIONS:\n${activeSession.system_instruction}`});
        }
        if (activePersona) messagesPayload.push({role: "system", content: buildPersonaPrompt(activePersona)});
        if (activeUserPersona) messagesPayload.push({role: "system", content: buildUserPersonaPrompt(activeUserPersona)});
        if (activePersona && activeSession.scenario_summary) {
            messagesPayload.push({
                role: "system",
                content: buildRoleplayDirectionPrompt({
                    assistantPersona: activePersona,
                    userPersona: activeUserPersona,
                    scenarioPrompt: activeSession.scenario_prompt,
                    sceneSummary: activeSession.scenario_summary
                })
            });
        }
        const contextSummaryPrompt = buildContextSummaryPrompt(upToMessageId == null ? activeSession.context_summary : null);
        if (contextSummaryPrompt) messagesPayload.push({role: "system", content: contextSummaryPrompt});
        const memoryPrompt = buildMemoryPrompt(repositories.listChatMemories(chatId, user));
        if (memoryPrompt) messagesPayload.push({role: "system", content: memoryPrompt});
        const personaStatePrompt = buildPersonaStatePrompt(repositories.getPersonaChatState(chatId, user));
        if (personaStatePrompt) messagesPayload.push({role: "system", content: personaStatePrompt});
        messagesPayload.push(...conversation.map((entry) => ({
            role: entry.role === "bot" ? "assistant" : "user",
            content: entry.content
        })));
        if (activePersona) messagesPayload.push({role: "system", content: buildRoleplayReplyGuardPrompt()});
        return {session: activeSession, activePersona, activeUserPersona, messagesPayload};
    };

    const buildRetryPayload = async ({chatId, user, session, selectedModel, targetMessage, retryStyle = null, signal = null, generation = {}}) => {
        const parentMessage = targetMessage.parent_message_id
            ? repositories.getChatMessage(chatId, targetMessage.parent_message_id)
            : null;
        const promptMessage = parentMessage?.role === "user"
            ? parentMessage
            : repositories.getPreviousUserMessage(chatId, targetMessage.id);
        const activePersona = repositories.getAssistantPersonaForChat(chatId, user);
        const activeUserPersona = getUserPersonaForSession(chatId, user, session, activePersona);

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

        const {messagesPayload} = buildConversationContext({
            user,
            chatId,
            session,
            message: null,
            upToMessageId: promptMessage.id
        });

        const styledPayload = appendRetryStyleInstruction(messagesPayload, retryStyle);
        const fullReply = activePersona
            ? await generateValidatedRoleplayReply({selectedModel, messagesPayload: styledPayload, userPersona: activeUserPersona, signal, generation})
            : await modelService.generateReply(selectedModel, styledPayload, {signal, generation});

        if (!fullReply) return {error: "Failed to regenerate message"};
        return {fullReply, promptMessageId: promptMessage.id};
    };

    const generateChatTurn = ({user, chatId, message, model, onChunk = null, signal = null, parentMessageId = undefined}) =>
        withChatGenerationLock(chatId, async () => {
            await (summaryQueues.get(chatId) || Promise.resolve());
            const session = repositories.getChat(chatId, user);
            if (!session) return {error: "Chat not found", status: 404};
            if (parentMessageId !== undefined) {
                repositories.updateChatContextSummary(chatId, user, null, 0);
                session.context_summary = null;
                session.context_summary_message_id = 0;
            }
            const effectiveParentId = parentMessageId === undefined
                ? session.active_leaf_message_id ?? repositories.getLatestChatMessage(chatId)?.id ?? null
                : parentMessageId;
            if (effectiveParentId != null && !repositories.getChatMessage(chatId, effectiveParentId)) {
                return {error: "Branch point not found", status: 404};
            }
            const {model: effectiveModel, generation} = getGenerationSettings(session, model);
            const inserted = repositories.insertBranchChatMessage(chatId, "user", message, null, null, "pending", null, effectiveParentId);
            const userMessageId = Number(inserted?.lastInsertRowid);
            try {
                const payload = buildConversationContext({user, chatId, session, message: null});
                const fullReply = await withActiveGeneration(chatId, signal, (activeSignal) => payload.activePersona
                    ? generateValidatedRoleplayReply({
                        selectedModel: effectiveModel,
                        messagesPayload: payload.messagesPayload,
                        userPersona: payload.activeUserPersona,
                        signal: activeSignal,
                        generation
                    })
                    : onChunk
                        ? modelService.streamReply(effectiveModel, payload.messagesPayload, onChunk, {signal: activeSignal, generation})
                        : modelService.generateReply(effectiveModel, payload.messagesPayload, {signal: activeSignal, generation}));

                if (!fullReply) {
                    repositories.failChatTurn(chatId, userMessageId, "Failed to generate a valid character reply", effectiveParentId);
                    return {error: "Failed to generate a valid character reply", status: 500};
                }
                if (payload.activePersona && onChunk) onChunk(fullReply, fullReply);

                const retryState = {
                    retryVariants: [fullReply],
                    retryActiveIndex: 0,
                    retryRetriesUsed: 0,
                    retryPromptMessageId: null
                };
                repositories.completeChatTurn(chatId, userMessageId, fullReply, retryState, effectiveModel);
                repositories.touchChat(chatId, user);
                scheduleContextSummaryUpdate({user, chatId, selectedModel: effectiveModel});
                return {reply: fullReply, userMessageId};
            } catch (error) {
                repositories.failChatTurn(chatId, userMessageId, String(error?.message || "Model request failed").slice(0, 500), effectiveParentId);
                repositories.touchChat(chatId, user);
                throw error;
            }
        });

    const listActiveBranchMessages = (chatId) => repositories.listActiveBranchMessages(chatId).map((row) => {
        const message = formatChatMessage(row);
        const siblings = repositories.listSiblingChatMessages(chatId, row.role, row.parent_message_id);
        const siblingIndex = siblings.findIndex((sibling) => sibling.id === row.id);
        return {
            ...message,
            siblingIndex,
            siblingCount: siblings.length,
            previousSiblingId: siblingIndex > 0 ? siblings[siblingIndex - 1].id : null,
            nextSiblingId: siblingIndex >= 0 && siblingIndex < siblings.length - 1 ? siblings[siblingIndex + 1].id : null
        };
    });

    const cloneChatThroughMessage = ({user, sourceChat, messageId = null}) => {
        if (repositories.countChats(user) >= config.chatLimit) {
            return {error: `Maximum of ${config.chatLimit} chats reached. Please delete an old chat to create a new one.`, status: 400};
        }

        const sourceMessages = messageId == null
            ? []
            : repositories.listChatBranchThroughMessage(sourceChat.id, messageId);
        if (messageId != null && !sourceMessages.some((message) => message.id === messageId)) {
            return {error: "Message not found", status: 404};
        }

        const sourceTitle = String(sourceChat.stored_title || sourceChat.title || "Chat").trim();
        const clonedChat = repositories.createChat(
            user,
            `${sourceTitle} (branch)`,
            sourceChat.assistant_persona_id ?? null,
            sourceChat.user_persona_id ?? null,
            sourceChat.scenario_prompt ?? null,
            sourceChat.scenario_summary ?? null,
            {folderName: sourceChat.folder_name ?? null}
        );

        try {
            repositories.updateChatGenerationSettings(clonedChat.id, user, {
                preferredModel: sourceChat.preferred_model ?? null,
                temperature: sourceChat.temperature ?? null,
                contextLength: sourceChat.context_length ?? null,
                responseLength: sourceChat.response_length ?? null,
                systemInstruction: sourceChat.system_instruction ?? null
            });

            let parentMessageId = null;
            for (const sourceMessage of sourceMessages) {
                const inserted = repositories.insertBranchChatMessage(
                    clonedChat.id,
                    sourceMessage.role,
                    sourceMessage.content,
                    {
                        retryVariants: [sourceMessage.content],
                        retryActiveIndex: 0,
                        retryRetriesUsed: 0,
                        retryPromptMessageId: null
                    },
                    sourceMessage.model_name ?? null,
                    "complete",
                    null,
                    parentMessageId
                );
                parentMessageId = Number(inserted.lastInsertRowid);
            }
        } catch (error) {
            repositories.deleteChat(clonedChat.id, user);
            throw error;
        }

        return {
            chat: repositories.getChat(clonedChat.id, user),
            messages: listActiveBranchMessages(clonedChat.id),
            sourceChatId: sourceChat.id,
            branchedFromMessageId: messageId
        };
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
        buildMessagesPayload: buildConversationContext,
        async sendChatMessage({user, chatId, message, model}) {
            return generateChatTurn({user, chatId, message, model});
        },
        async streamChatMessage({user, chatId, message, model, onChunk, signal = null}) {
            return generateChatTurn({user, chatId, message, model, onChunk, signal});
        },
        async retryMessage({user, chatId, selectedModel, targetMessage, retryStyle = null}) {
            return withChatGenerationLock(chatId, async () => {
                const session = repositories.getChat(chatId, user);
                if (!session) return {error: "Chat not found", status: 404};

                const freshTarget = repositories.getChatMessage(chatId, targetMessage.id);
                const existingMessage = formatChatMessage(freshTarget);
                if (!existingMessage) return {error: "Message not found", status: 404};
                if (existingMessage.role !== "bot") return {error: "Only assistant messages can be regenerated", status: 400};
                const siblings = repositories.listSiblingChatMessages(chatId, "bot", freshTarget.parent_message_id);
                if (siblings.length - 1 >= maxRetries) {
                    return {error: `Maximum of ${maxRetries} retries reached`, status: 400};
                }
                const {model, generation} = getGenerationSettings(session, selectedModel);
                return withActiveGeneration(chatId, null, async (activeSignal) => {
                    const retryResult = await buildRetryPayload({
                        chatId, user, session, selectedModel: model, targetMessage: freshTarget, retryStyle,
                        signal: activeSignal, generation
                    });
                    if (retryResult.error) return {error: retryResult.error, status: 400};
                    const retryVariants = [...siblings.map((sibling) => sibling.content), retryResult.fullReply];
                    const retryState = {
                        retryVariants,
                        retryActiveIndex: retryVariants.length - 1,
                        retryRetriesUsed: siblings.length,
                        retryPromptMessageId: retryResult.promptMessageId
                    };
                    const inserted = repositories.insertBranchChatMessage(
                        chatId, "bot", retryResult.fullReply, retryState, model, "complete", null, freshTarget.parent_message_id
                    );
                    repositories.updateChatContextSummary(chatId, user, null, 0);
                    repositories.touchChat(chatId, user);
                    const message = formatChatMessage(repositories.getChatMessage(chatId, Number(inserted.lastInsertRowid)));
                    return {message, promptMessageId: retryResult.promptMessageId, retryStyle, branchedFromMessageId: freshTarget.id};
                });
            });
        },
        async editAndResendMessage({user, chatId, targetMessage, content, model, onChunk = null, signal = null}) {
            if (!targetMessage || targetMessage.role !== "user") return {error: "Only user messages can be edited and resent", status: 400};
            const sourceChat = repositories.getChat(chatId, user);
            if (!sourceChat) return {error: "Chat not found", status: 404};
            const cloned = cloneChatThroughMessage({
                user,
                sourceChat,
                messageId: targetMessage.parent_message_id ?? null
            });
            if (cloned.error) return cloned;

            const generated = await generateChatTurn({
                user,
                chatId: cloned.chat.id,
                message: content,
                model,
                onChunk,
                signal
            });
            if (generated.error) return {...generated, chat: cloned.chat};
            return {
                ...generated,
                chat: repositories.getChat(cloned.chat.id, user),
                messages: listActiveBranchMessages(cloned.chat.id),
                sourceChatId: chatId,
                branchedFromMessageId: targetMessage.id
            };
        },
        createBranchedChat({user, chatId, messageId}) {
            const sourceChat = repositories.getChat(chatId, user);
            if (!sourceChat) return {error: "Chat not found", status: 404};
            if (!repositories.getChatMessage(chatId, messageId)) return {error: "Message not found", status: 404};
            return cloneChatThroughMessage({user, sourceChat, messageId});
        },
        activateBranch({user, chatId, messageId, includeDescendants = false}) {
            const session = repositories.getChat(chatId, user);
            if (!session) return {error: "Chat not found", status: 404};
            const message = repositories.getChatMessage(chatId, messageId);
            if (!message) return {error: "Message not found", status: 404};
            const leaf = includeDescendants ? repositories.getLatestDescendantMessage(chatId, messageId) : message;
            repositories.updateChatActiveLeaf(chatId, user, leaf?.id || messageId);
            repositories.updateChatContextSummary(chatId, user, null, 0);
            return {messages: listActiveBranchMessages(chatId)};
        },
        listActiveBranchMessages,
        stopGeneration({user, chatId}) {
            if (!repositories.getChat(chatId, user)) return {error: "Chat not found", status: 404};
            const controller = activeGenerations.get(chatId);
            if (!controller) return {stopped: false};
            controller.abort();
            return {stopped: true};
        }
    };
}
