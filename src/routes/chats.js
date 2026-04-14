import express from "express";
import {requireLogin} from "../middleware/auth.js";
import {validateBody} from "../middleware/validate.js";

const createChatValidator = (body) => ({
    value: {
        title: String(body?.title || "New chat").trim() || "New chat",
        assistantPersonaId: body?.assistantPersonaId ? Number(body.assistantPersonaId) : null
    }
});

const messageValidator = (body) => {
    const content = String(body?.content || "").trim();
    if (!content) return {error: "Message content is required"};
    return {value: {content, retryActiveIndex: body?.retryActiveIndex}};
};

const sendMessageValidator = (body) => {
    const message = String(body?.message || "").trim();
    const chatId = Number(body?.chatId);
    if (!chatId) return {error: "chatId is required"};
    if (!message) return {error: "message is required"};
    return {value: {message, chatId, model: String(body?.model || "mistral:latest")}};
};

const organizationValidator = (body) => ({
    value: {
        folderName: String(body?.folderName || "").trim() || null,
        isPinned: Boolean(body?.isPinned),
        archived: Boolean(body?.archived)
    }
});

export function createChatsRouter({repositories, chatService, modelService, config, chatRateLimiters}) {
    const router = express.Router();
    router.use(requireLogin);

    router.get("/models", async (req, res) => {
        try {
            return res.json(await modelService.listModels());
        } catch (error) {
            const mapped = modelService.mapError(error);
            return res.status(mapped.status).json(mapped.body);
        }
    });

    router.get("/chats", (req, res) => res.json({chats: repositories.listChats(req.session.user)}));
    router.get("/chats/search", (req, res) => res.json({chats: repositories.searchChats(req.session.user, req.query.q || "")}));

    router.post("/chats", validateBody(createChatValidator), (req, res) => {
        const user = req.session.user;
        const {assistantPersonaId, title} = req.validatedBody;

        if (assistantPersonaId) {
            const persona = repositories.getPersona(assistantPersonaId, user);
            if (!persona || persona.persona_type !== "assistant") {
                return res.status(404).json({error: "AI Character not found"});
            }
            const existingChat = repositories.getChatByParticipants(user, assistantPersonaId, null);
            try {
                const chat = chatService.getOrCreatePersonaChat(user, persona, null);
                return res.json({chat, existing: Boolean(existingChat)});
            } catch (error) {
                if (error.message === "CHAT_LIMIT_REACHED") {
                    return res.status(400).json({error: `Maximum of ${config.chatLimit} chats reached. Please delete an old chat to create a new one.`});
                }
                throw error;
            }
        }

        if (repositories.countChats(user) >= config.chatLimit) {
            return res.status(400).json({error: `Maximum of ${config.chatLimit} chats reached. Please delete an old chat to create a new one.`});
        }

        return res.json({chat: repositories.createChat(user, title), existing: false});
    });

    router.put("/chats/:id", validateBody((body) => {
        const title = String(body?.title || "").trim();
        return title ? {value: {title}} : {error: "Title is required"};
    }), (req, res) => {
        const chatId = Number(req.params.id);
        const result = repositories.updateChatTitle(chatId, req.session.user, req.validatedBody.title);
        if (result.changes === 0) return res.status(404).json({error: "Chat not found"});
        return res.json({chat: {id: chatId, title: req.validatedBody.title}});
    });

    router.put("/chats/:id/organization", validateBody(organizationValidator), (req, res) => {
        const chatId = Number(req.params.id);
        const chat = repositories.getChat(chatId, req.session.user);
        if (!chat) return res.status(404).json({error: "Chat not found"});
        repositories.updateChatOrganization(chatId, req.session.user, {
            folderName: req.validatedBody.folderName,
            isPinned: req.validatedBody.isPinned,
            archivedAt: req.validatedBody.archived ? new Date().toISOString() : null
        });
        return res.json({chat: repositories.getChat(chatId, req.session.user)});
    });

    router.delete("/chats/:id", (req, res) => {
        const result = repositories.deleteChat(Number(req.params.id), req.session.user);
        if (result.changes === 0) return res.status(404).json({error: "Chat not found"});
        return res.json({message: "Chat deleted"});
    });

    router.get("/chats/:id/messages", (req, res) => {
        const chatId = Number(req.params.id);
        const chat = repositories.getChat(chatId, req.session.user);
        if (!chat) return res.status(404).json({error: "Chat not found"});
        return res.json({
            messages: repositories.listChatMessages(chatId).map(chatService.formatChatMessage),
            chat
        });
    });

    router.put("/chats/:id/messages/:messageId", validateBody(messageValidator), (req, res) => {
        const chatId = Number(req.params.id);
        const messageId = Number(req.params.messageId);
        const chat = repositories.getChat(chatId, req.session.user);
        if (!chat) return res.status(404).json({error: "Chat not found"});
        const existingMessage = chatService.formatChatMessage(repositories.getChatMessage(chatId, messageId));
        if (!existingMessage) return res.status(404).json({error: "Message not found"});

        if (existingMessage.role === "bot") {
            const retryVariants = [...existingMessage.retryVariants];
            const activeIndex = Number.isInteger(Number(req.validatedBody.retryActiveIndex))
                ? Number(req.validatedBody.retryActiveIndex)
                : existingMessage.retryActiveIndex;
            retryVariants[activeIndex] = req.validatedBody.content;
            chatService.persistChatMessageRetryState({
                chatId,
                messageId,
                content: req.validatedBody.content,
                retryVariants,
                retryActiveIndex: activeIndex,
                retryRetriesUsed: existingMessage.retryRetriesUsed,
                retryPromptMessageId: existingMessage.retryPromptMessageId
            });
        } else {
            repositories.updateChatMessage(chatId, messageId, req.validatedBody.content);
        }

        repositories.touchChat(chatId, req.session.user);
        return res.json({message: chatService.formatChatMessage(repositories.getChatMessage(chatId, messageId))});
    });

    router.put("/chats/:id/messages/by-index/:index", validateBody(messageValidator), (req, res) => {
        const chatId = Number(req.params.id);
        const chat = repositories.getChat(chatId, req.session.user);
        if (!chat) return res.status(404).json({error: "Chat not found"});
        const target = chatService.getChatMessageByIndex(chatId, req.params.index);
        if (!target) return res.status(404).json({error: "Message not found"});
        const existingMessage = chatService.formatChatMessage(repositories.getChatMessage(chatId, target.id));
        if (!existingMessage) return res.status(404).json({error: "Message not found"});

        if (existingMessage.role === "bot") {
            const retryVariants = [...existingMessage.retryVariants];
            const activeIndex = Number.isInteger(Number(req.validatedBody.retryActiveIndex))
                ? Number(req.validatedBody.retryActiveIndex)
                : existingMessage.retryActiveIndex;
            retryVariants[activeIndex] = req.validatedBody.content;
            chatService.persistChatMessageRetryState({
                chatId,
                messageId: target.id,
                content: req.validatedBody.content,
                retryVariants,
                retryActiveIndex: activeIndex,
                retryRetriesUsed: existingMessage.retryRetriesUsed,
                retryPromptMessageId: existingMessage.retryPromptMessageId
            });
        } else {
            repositories.updateChatMessage(chatId, target.id, req.validatedBody.content);
        }

        repositories.touchChat(chatId, req.session.user);
        return res.json({message: chatService.formatChatMessage(repositories.getChatMessage(chatId, target.id))});
    });

    router.delete("/chats/:id/messages/:messageId", (req, res) => {
        const chatId = Number(req.params.id);
        const chat = repositories.getChat(chatId, req.session.user);
        if (!chat) return res.status(404).json({error: "Chat not found"});
        const result = repositories.deleteChatMessage(chatId, Number(req.params.messageId));
        if (result.changes === 0) return res.status(404).json({error: "Message not found"});
        repositories.touchChat(chatId, req.session.user);
        return res.json({message: "Message deleted"});
    });

    router.delete("/chats/:id/messages/by-index/:index", (req, res) => {
        const chatId = Number(req.params.id);
        const chat = repositories.getChat(chatId, req.session.user);
        if (!chat) return res.status(404).json({error: "Chat not found"});
        const target = chatService.getChatMessageByIndex(chatId, req.params.index);
        if (!target) return res.status(404).json({error: "Message not found"});
        repositories.deleteChatMessage(chatId, target.id);
        repositories.touchChat(chatId, req.session.user);
        return res.json({message: "Message deleted"});
    });

    router.post("/chats/:id/clear", (req, res) => {
        const chatId = Number(req.params.id);
        const chat = repositories.getChat(chatId, req.session.user);
        if (!chat) return res.status(404).json({error: "Chat not found"});
        repositories.clearChatMessages(chatId);
        repositories.touchChat(chatId, req.session.user);
        return res.json({message: "Chat cleared"});
    });

    router.post("/chat", ...chatRateLimiters, validateBody(sendMessageValidator), async (req, res) => {
        try {
            const result = await chatService.sendChatMessage({
                user: req.session.user,
                chatId: req.validatedBody.chatId,
                message: req.validatedBody.message,
                model: req.validatedBody.model
            });
            if (result.error) return res.status(result.status).json({error: result.error});
            return res.json({reply: result.reply});
        } catch (error) {
            const mapped = modelService.mapError(error);
            return res.status(mapped.status).json(mapped.body);
        }
    });

    router.post("/chat/stream", ...chatRateLimiters, validateBody(sendMessageValidator), async (req, res) => {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive"
        });

        const sendEvent = (event, data) => {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        try {
            const result = await chatService.streamChatMessage({
                user: req.session.user,
                chatId: req.validatedBody.chatId,
                message: req.validatedBody.message,
                model: req.validatedBody.model,
                onChunk: (chunk, fullReply) => sendEvent("chunk", {chunk, fullReply})
            });
            if (result.error) {
                sendEvent("error", {error: result.error});
            } else {
                sendEvent("done", {reply: result.reply});
            }
        } catch (error) {
            const mapped = modelService.mapError(error);
            sendEvent("error", mapped.body);
        } finally {
            res.end();
        }
    });

    router.post("/chats/:id/messages/:messageId/retry", ...chatRateLimiters, async (req, res) => {
        const chatId = Number(req.params.id);
        const messageId = Number(req.params.messageId);
        const targetMessage = repositories.getChatMessage(chatId, messageId);
        if (!targetMessage) return res.status(404).json({error: "Message not found"});
        const latestMessage = repositories.getLatestChatMessage(chatId);
        if (!latestMessage || latestMessage.id !== messageId || latestMessage.role !== "bot") {
            return res.status(400).json({error: "Only the newest assistant message can be retried"});
        }

        try {
            const result = await chatService.retryMessage({
                user: req.session.user,
                chatId,
                selectedModel: String(req.body?.model || "mistral:latest"),
                targetMessage,
                retryStyle: String(req.body?.style || "").trim() || null
            });
            if (result.error) return res.status(result.status).json({error: result.error});
            return res.json(result);
        } catch (error) {
            const mapped = modelService.mapError(error);
            return res.status(mapped.status).json(mapped.body);
        }
    });

    router.post("/chats/:id/messages/by-index/:index/retry", ...chatRateLimiters, async (req, res) => {
        const chatId = Number(req.params.id);
        const targetMessage = chatService.getChatMessageByIndex(chatId, req.params.index);
        if (!targetMessage) return res.status(404).json({error: "Message not found"});
        const latestMessage = repositories.getLatestChatMessage(chatId);
        if (!latestMessage || latestMessage.id !== targetMessage.id || latestMessage.role !== "bot") {
            return res.status(400).json({error: "Only the newest assistant message can be retried"});
        }

        try {
            const result = await chatService.retryMessage({
                user: req.session.user,
                chatId,
                selectedModel: String(req.body?.model || "mistral:latest"),
                targetMessage,
                retryStyle: String(req.body?.style || "").trim() || null
            });
            if (result.error) return res.status(result.status).json({error: result.error});
            return res.json(result);
        } catch (error) {
            const mapped = modelService.mapError(error);
            return res.status(mapped.status).json(mapped.body);
        }
    });

    router.get("/exports/chats/:id", (req, res) => {
        const chatId = Number(req.params.id);
        const format = String(req.query.format || "txt").toLowerCase();
        const chat = repositories.getChat(chatId, req.session.user);
        if (!chat) return res.status(404).json({error: "Chat not found"});
        const messages = repositories.listChatMessages(chatId).map(chatService.formatChatMessage);
        if (format === "json") {
            return res.json({chat, messages});
        }
        if (format === "md") {
            const body = [`# ${chat.title}`, "", ...messages.flatMap((message) => [`## ${message.role === "user" ? "You" : "Assistant"}`, "", message.content, ""])].join("\n");
            res.type("text/markdown");
            return res.send(body);
        }
        const body = [`Chat: ${chat.title}`, "", ...messages.flatMap((message) => [`${message.role === "user" ? "You" : "Assistant"}:`, message.content, ""])].join("\n");
        res.type("text/plain");
        return res.send(body);
    });

    router.get("/exports/workspace", (req, res) => res.json({workspace: repositories.exportWorkspace(req.session.user)}));
    router.post("/imports/workspace", (req, res) => res.json({imported: repositories.importWorkspace(req.session.user, req.body?.workspace || {})}));

    router.get("/chat/history", (req, res) => res.json({history: repositories.listChats(req.session.user)}));

    return router;
}
