import express from "express";
import {requireLogin} from "../middleware/auth.js";
import {validateBody} from "../middleware/validate.js";
import {normalizeOptionalText, validatePersonaPayload} from "../services/personaService.js";

const personaBodyValidator = (body) => {
    const personaType = String(body?.personaType || "assistant").trim();
    if (!["assistant", "user"].includes(personaType)) {
        return {error: "Invalid persona type"};
    }
    const validated = validatePersonaPayload(body, personaType);
    if (validated.error) return validated;
    return {value: {personaType, payload: validated.value}};
};

const roleplayStartValidator = (body) => {
    const assistantPersonaId = Number(body?.assistantPersonaId);
    if (!assistantPersonaId) return {error: "assistantPersonaId is required"};
    return {
        value: {
            assistantPersonaId,
            userPersonaId: body?.userPersonaId ? Number(body.userPersonaId) : null,
            scenarioPrompt: normalizeOptionalText(body?.scenarioPrompt),
            model: String(body?.model || "mistral:latest")
        }
    };
};

const templateValidator = (body) => {
    const name = String(body?.name || "").trim();
    const promptText = String(body?.promptText || "").trim();
    if (!name || !promptText) return {error: "Template name and prompt text are required"};
    return {
        value: {
            personaId: body?.personaId ? Number(body.personaId) : null,
            name,
            description: normalizeOptionalText(body?.description),
            category: normalizeOptionalText(body?.category),
            promptText,
            starterText: normalizeOptionalText(body?.starterText),
            isShared: Boolean(body?.isShared)
        }
    };
};

export function createPersonasRouter({repositories, chatService, modelService, config}) {
    const router = express.Router();
    router.use(requireLogin);
    const isAdmin = (req) => req.session.user === "admin";
    const parseMarketPersonaType = (value) => ["assistant", "user"].includes(value) ? value : null;

    router.get("/personas", (req, res) => {
        const user = req.session.user;
        const active = repositories.getActivePersonaIds(user);
        return res.json({
            assistantPersonas: repositories.listPersonasByType(user, "assistant"),
            userPersonas: repositories.listPersonasByType(user, "user"),
            activeUserPersonaId: active.active_user_persona_id ?? null,
            publishedPersonaIds: repositories.listPublishedPersonaIds(user)
        });
    });

    router.post("/personas", validateBody(personaBodyValidator), (req, res) => {
        return res.json({
            persona: repositories.createPersona(req.session.user, req.validatedBody.payload, req.validatedBody.personaType)
        });
    });

    router.put("/personas/:id", validateBody(personaBodyValidator), (req, res) => {
        const personaId = Number(req.params.id);
        const result = repositories.updatePersona(personaId, req.session.user, req.validatedBody.payload);
        if (result.changes === 0) return res.status(404).json({error: "Persona not found"});
        return res.json({persona: repositories.getPersona(personaId, req.session.user)});
    });

    router.post("/personas/:id/clone", (req, res) => {
        const persona = repositories.clonePersona(Number(req.params.id), req.session.user);
        if (!persona) return res.status(404).json({error: "Persona not found"});
        return res.json({persona});
    });

    router.get("/personas/:id/versions", (req, res) => {
        const personaId = Number(req.params.id);
        const persona = repositories.getPersona(personaId, req.session.user);
        if (!persona) return res.status(404).json({error: "Persona not found"});
        return res.json({versions: repositories.listPersonaVersions(personaId, req.session.user)});
    });

    router.post("/personas/:id/versions/:versionId/restore", (req, res) => {
        const persona = repositories.restorePersonaVersion(Number(req.params.id), Number(req.params.versionId), req.session.user);
        if (!persona) return res.status(404).json({error: "Version not found"});
        return res.json({persona});
    });

    router.delete("/personas/:id", (req, res) => {
        const personaId = Number(req.params.id);
        const active = repositories.getActivePersonaIds(req.session.user);
        const result = repositories.deletePersona(personaId, req.session.user);
        if (result.changes === 0) return res.status(404).json({error: "Persona not found"});
        if (active.active_user_persona_id === personaId) {
            repositories.setActiveUserPersona(req.session.user, null);
        }
        repositories.clearPersonaReferences(req.session.user, personaId);
        return res.json({message: "Persona deleted"});
    });

    router.post("/personas/:id/chat", (req, res) => {
        const user = req.session.user;
        const personaId = Number(req.params.id);
        const userPersonaId = req.body?.userPersonaId ? Number(req.body.userPersonaId) : null;
        const persona = repositories.getPersona(personaId, user);
        if (!persona || persona.persona_type !== "assistant") return res.status(404).json({error: "Persona not found"});
        if (userPersonaId) {
            const userPersona = repositories.getPersona(userPersonaId, user);
            if (!userPersona || userPersona.persona_type !== "user") return res.status(404).json({error: "User persona not found"});
        }
        try {
            return res.json({chat: chatService.getOrCreatePersonaChat(user, persona, userPersonaId, null, null)});
        } catch (error) {
            if (error.message === "CHAT_LIMIT_REACHED") {
                return res.status(400).json({error: `Maximum of ${config.chatLimit} chats reached. Please delete an old chat to create a new one.`});
            }
            throw error;
        }
    });

    router.post("/personas/:id/equip-user", (req, res) => {
        const persona = repositories.getPersona(Number(req.params.id), req.session.user);
        if (!persona || persona.persona_type !== "user") return res.status(404).json({error: "Persona not found"});
        repositories.setActiveUserPersona(req.session.user, persona.id);
        return res.json({activeUserPersonaId: persona.id});
    });

    router.post("/personas/user/clear", (req, res) => {
        repositories.setActiveUserPersona(req.session.user, null);
        return res.json({activeUserPersonaId: null});
    });

    router.get("/personas/market", (req, res) => {
        return res.json({
            personas: repositories.listMarketPersonas({
                admin: isAdmin(req),
                username: req.session.user,
                personaType: parseMarketPersonaType(String(req.query.personaType || "").trim()),
                sort: String(req.query.sort || "best").trim()
            })
        });
    });

    router.get("/dashboard/summary", (req, res) => {
        return res.json({username: req.session.user, stats: repositories.getDashboardSummary(req.session.user)});
    });

    router.post("/personas/:id/publish", (req, res) => {
        const persona = repositories.getPersona(Number(req.params.id), req.session.user);
        if (!persona) return res.status(404).json({error: "Persona not found"});
        if (persona.source_market_id) return res.status(403).json({error: "Collected personas cannot be published."});
        const tags = Array.isArray(req.body?.tags) ? req.body.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 8) : [];
        return res.json({persona: repositories.upsertMarketPersona(persona.id, req.session.user, persona, tags)});
    });

    router.post("/personas/:id/unpublish", (req, res) => {
        const persona = repositories.getPersona(Number(req.params.id), req.session.user);
        if (!persona) return res.status(404).json({error: "Persona not found"});
        if (persona.source_market_id) return res.status(403).json({error: "Collected personas cannot be unpublished."});
        const result = repositories.deletePublishedPersona(persona.id, req.session.user);
        if (result.changes === 0) return res.status(404).json({error: "Persona is not published."});
        return res.json({message: "Persona unpublished"});
    });

    router.post("/personas/market/:id/collect", (req, res) => {
        const user = req.session.user;
        const marketPersona = repositories.getMarketPersona(Number(req.params.id));
        if (!marketPersona || marketPersona.soft_deleted_at || marketPersona.moderation_status === "rejected") return res.status(404).json({error: "Market persona not found"});
        if (marketPersona.creator_username === user) return res.status(400).json({error: "You already own this persona."});
        if (repositories.getPersonaBySourceMarket(user, marketPersona.id)) return res.status(400).json({error: "You already collected this persona."});
        const persona = repositories.collectMarketPersona(user, marketPersona);
        repositories.incrementMarketUsageCount(marketPersona.id);
        let activeUserPersonaId = null;
        if (req.body?.equip && marketPersona.persona_type === "user") {
            repositories.setActiveUserPersona(user, persona.id);
            activeUserPersonaId = persona.id;
        }
        return res.json({persona, activeUserPersonaId});
    });

    router.post("/personas/market/:id/favorite", (req, res) => {
        const marketId = Number(req.params.id);
        const persona = repositories.getMarketPersona(marketId);
        if (!persona) return res.status(404).json({error: "Market persona not found"});
        const active = repositories.toggleMarketFavorite(marketId, req.session.user);
        return res.json({favorite: active, persona: repositories.getMarketPersona(marketId)});
    });

    router.post("/personas/market/:id/rate", (req, res) => {
        const marketId = Number(req.params.id);
        const rating = Number(req.body?.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({error: "Rating must be between 1 and 5"});
        const persona = repositories.getMarketPersona(marketId);
        if (!persona) return res.status(404).json({error: "Market persona not found"});
        return res.json({persona: repositories.rateMarketPersona(marketId, req.session.user, rating)});
    });

    router.post("/personas/market/:id/report", (req, res) => {
        const marketId = Number(req.params.id);
        const reason = String(req.body?.reason || "").trim();
        if (!reason) return res.status(400).json({error: "Reason is required"});
        const persona = repositories.getMarketPersona(marketId);
        if (!persona) return res.status(404).json({error: "Market persona not found"});
        repositories.reportMarketPersona(marketId, req.session.user, reason, normalizeOptionalText(req.body?.details));
        return res.json({message: "Report submitted"});
    });

    router.post("/personas/market/:id/chat", async (req, res) => {
        const user = req.session.user;
        const marketPersona = repositories.getMarketPersona(Number(req.params.id));
        const userPersonaId = req.body?.userPersonaId ? Number(req.body.userPersonaId) : null;
        if (!marketPersona || marketPersona.persona_type !== "assistant") {
            return res.status(404).json({error: "Market AI Character not found"});
        }

        let userPersona = null;
        if (userPersonaId) {
            userPersona = repositories.getPersona(userPersonaId, user);
            if (!userPersona || userPersona.persona_type !== "user") {
                return res.status(404).json({error: "User persona not found"});
            }
        }

        const existingPersona = repositories.getPersonaBySourceMarket(user, marketPersona.id);
        const persona = existingPersona
            ? repositories.getPersona(existingPersona.id, user)
            : repositories.collectMarketPersona(user, marketPersona);
        if (!existingPersona) {
            repositories.incrementMarketUsageCount(marketPersona.id);
        }

        const scenarioPrompt = normalizeOptionalText(req.body?.scenarioPrompt);
        const sceneSummary = chatService.buildRoleplaySceneSummary(persona, userPersona, scenarioPrompt);
        let chat;
        try {
            chat = chatService.getOrCreatePersonaChat(user, persona, userPersonaId, scenarioPrompt, sceneSummary);
        } catch (error) {
            if (error.message === "CHAT_LIMIT_REACHED") {
                return res.status(400).json({error: `Maximum of ${config.chatLimit} chats reached. Please delete an old chat to create a new one.`});
            }
            throw error;
        }

        if (repositories.listChatMessages(chat.id).length > 0) {
            return res.json({persona, chat, existing: true, generatedInitialMessage: false});
        }

        repositories.updateChatScene(chat.id, user, scenarioPrompt, sceneSummary);
        chat = repositories.getChat(chat.id, user);
        try {
            const opener = await chatService.generateRoleplayOpener({
                selectedModel: "mistral:latest",
                assistantPersona: persona,
                userPersona,
                scenarioPrompt,
                sceneSummary
            });
            if (!opener || chatService.containsUserVoiceInRoleplayOpener(opener, userPersona)) {
                return res.json({persona, chat, existing: false, generatedInitialMessage: false});
            }
            chatService.insertChatMessage(chat.id, "bot", opener, {
                retryVariants: [opener],
                retryActiveIndex: 0,
                retryRetriesUsed: 0,
                retryPromptMessageId: null
            });
            repositories.touchChat(chat.id, user);
            return res.json({persona, chat: repositories.getChat(chat.id, user), existing: false, generatedInitialMessage: true, opener});
        } catch {
            return res.json({persona, chat, existing: false, generatedInitialMessage: false, degraded: true});
        }
    });

    router.post("/roleplays/start", validateBody(roleplayStartValidator), async (req, res) => {
        const user = req.session.user;
        const {assistantPersonaId, userPersonaId, scenarioPrompt, model} = req.validatedBody;
        const assistantPersona = repositories.getPersona(assistantPersonaId, user);
        if (!assistantPersona || assistantPersona.persona_type !== "assistant") return res.status(404).json({error: "Character not found"});
        let userPersona = null;
        if (userPersonaId) {
            userPersona = repositories.getPersona(userPersonaId, user);
            if (!userPersona || userPersona.persona_type !== "user") return res.status(404).json({error: "User persona not found"});
        }

        const sceneSummary = chatService.buildRoleplaySceneSummary(assistantPersona, userPersona, scenarioPrompt);
        let chat;
        try {
            chat = chatService.getOrCreatePersonaChat(user, assistantPersona, userPersonaId, scenarioPrompt, sceneSummary);
        } catch (error) {
            if (error.message === "CHAT_LIMIT_REACHED") {
                return res.status(400).json({error: `Maximum of ${config.chatLimit} chats reached. Please delete an old chat to create a new one.`});
            }
            throw error;
        }

        if (repositories.listChatMessages(chat.id).length > 0) {
            return res.json({chat, existing: true, generatedInitialMessage: false});
        }

        repositories.updateChatScene(chat.id, user, scenarioPrompt, sceneSummary);
        chat = repositories.getChat(chat.id, user);

        try {
            const opener = await chatService.generateRoleplayOpener({
                selectedModel: model,
                assistantPersona,
                userPersona,
                scenarioPrompt,
                sceneSummary
            });
            if (!opener) return res.status(500).json({error: "Failed to generate the character opener"});
            chatService.insertChatMessage(chat.id, "bot", opener, {
                retryVariants: [opener],
                retryActiveIndex: 0,
                retryRetriesUsed: 0,
                retryPromptMessageId: null
            });
            repositories.touchChat(chat.id, user);
            return res.json({chat: repositories.getChat(chat.id, user), existing: false, generatedInitialMessage: true, opener});
        } catch (error) {
            const mapped = modelService.mapError(error);
            return res.status(mapped.status).json(mapped.body);
        }
    });

    router.get("/templates", (req, res) => {
        const personaId = req.query.personaId ? Number(req.query.personaId) : null;
        return res.json({templates: repositories.listPromptTemplatesForPersona(req.session.user, personaId)});
    });

    router.post("/templates", validateBody(templateValidator), (req, res) => {
        return res.json({template: repositories.createPromptTemplate(req.session.user, req.validatedBody)});
    });

    router.put("/templates/:id", validateBody(templateValidator), (req, res) => {
        const result = repositories.updatePromptTemplate(Number(req.params.id), req.session.user, req.validatedBody);
        if (result.changes === 0) return res.status(404).json({error: "Template not found"});
        return res.json({template: repositories.getPromptTemplate(Number(req.params.id))});
    });

    router.delete("/templates/:id", (req, res) => {
        const result = repositories.deletePromptTemplate(Number(req.params.id), req.session.user);
        if (result.changes === 0) return res.status(404).json({error: "Template not found"});
        return res.json({message: "Template deleted"});
    });

    router.get("/admin/reports", (req, res) => {
        if (!isAdmin(req)) return res.status(403).json({error: "Admin only"});
        return res.json({reports: repositories.listMarketReports(), personas: repositories.listMarketPersonas({admin: true, username: req.session.user})});
    });

    router.post("/admin/reports/:id", (req, res) => {
        if (!isAdmin(req)) return res.status(403).json({error: "Admin only"});
        const status = String(req.body?.status || "").trim() || "reviewed";
        repositories.updateMarketReportStatus(Number(req.params.id), status);
        return res.json({message: "Report updated"});
    });

    router.post("/admin/personas/market/:id/moderate", (req, res) => {
        if (!isAdmin(req)) return res.status(403).json({error: "Admin only"});
        const status = String(req.body?.status || "").trim() || "approved";
        repositories.updateMarketModeration(Number(req.params.id), {
            status,
            notes: normalizeOptionalText(req.body?.notes),
            softDelete: Boolean(req.body?.softDelete)
        });
        return res.json({persona: repositories.getMarketPersona(Number(req.params.id))});
    });

    return router;
}
