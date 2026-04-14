const parseJsonArray = (value) => {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const buildPersonaSnapshot = (persona) => JSON.stringify({
    name: persona.name,
    pronouns: persona.pronouns,
    appearance: persona.appearance,
    background: persona.background,
    details: persona.details,
    example_dialogues: persona.example_dialogues,
    persona_type: persona.persona_type,
    source_market_id: persona.source_market_id ?? null,
    source_creator_username: persona.source_creator_username ?? null
});

const MARKET_SORT_ORDERS = {
    best: "pm.favorite_count DESC, rating_average DESC, pm.usage_count DESC, datetime(pm.created_at) DESC, pm.id DESC",
    newest: "datetime(pm.created_at) DESC, pm.id DESC",
    most_favorited: "pm.favorite_count DESC, rating_average DESC, pm.usage_count DESC, datetime(pm.created_at) DESC, pm.id DESC",
    most_popular: "pm.usage_count DESC, pm.favorite_count DESC, rating_average DESC, datetime(pm.created_at) DESC, pm.id DESC",
    top_rated: "rating_average DESC, pm.rating_count DESC, pm.favorite_count DESC, datetime(pm.created_at) DESC, pm.id DESC",
    alphabetical: "LOWER(pm.name) ASC, datetime(pm.created_at) DESC, pm.id DESC"
};

function normalizeMarketSort(sort) {
    const normalized = String(sort || "best").trim().toLowerCase().replace(/-/g, "_");
    return MARKET_SORT_ORDERS[normalized] ? normalized : "best";
}

function normalizeMarketPersonaType(personaType) {
    return ["assistant", "user"].includes(personaType) ? personaType : null;
}

export function createRepositories(db, config) {
    const statements = {
        insertUser: db.prepare("INSERT INTO users (username, password) VALUES (?, ?)"),
        getUser: db.prepare("SELECT username, password FROM users WHERE username = ?"),
        updateUsername: db.prepare("UPDATE users SET username = ? WHERE username = ?"),
        updatePassword: db.prepare("UPDATE users SET password = ? WHERE username = ?"),
        insertChatSession: db.prepare(
            "INSERT INTO chat_sessions (username, title, assistant_persona_id, user_persona_id, folder_name, is_pinned, archived_at, scenario_prompt, scenario_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ),
        listChatSessions: db.prepare(`
            SELECT cs.id,
                   CASE
                       WHEN cs.assistant_persona_id IS NOT NULL THEN COALESCE(p.name, cs.title)
                       ELSE cs.title
                       END AS title,
                   cs.title AS stored_title,
                   cs.assistant_persona_id,
                   p.name AS assistant_persona_name,
                   cs.user_persona_id,
                   up.name AS user_persona_name,
                   cs.folder_name,
                   cs.is_pinned,
                   cs.archived_at,
                   cs.scenario_prompt,
                   cs.scenario_summary,
                   cs.created_at,
                   cs.updated_at
            FROM chat_sessions cs
                     LEFT JOIN personas p ON p.id = cs.assistant_persona_id
                     LEFT JOIN personas up ON up.id = cs.user_persona_id
            WHERE cs.username = ?
            ORDER BY cs.is_pinned DESC, datetime(cs.updated_at) DESC
        `),
        countChatSessions: db.prepare("SELECT COUNT(*) as count FROM chat_sessions WHERE username = ?"),
        getChatSession: db.prepare(`
            SELECT cs.id,
                   CASE
                       WHEN cs.assistant_persona_id IS NOT NULL THEN COALESCE(p.name, cs.title)
                       ELSE cs.title
                       END AS title,
                   cs.title AS stored_title,
                   cs.assistant_persona_id,
                   p.name AS assistant_persona_name,
                   cs.user_persona_id,
                   up.name AS user_persona_name,
                   cs.folder_name,
                   cs.is_pinned,
                   cs.archived_at,
                   cs.scenario_prompt,
                   cs.scenario_summary,
                   cs.created_at,
                   cs.updated_at
            FROM chat_sessions cs
                     LEFT JOIN personas p ON p.id = cs.assistant_persona_id
                     LEFT JOIN personas up ON up.id = cs.user_persona_id
            WHERE cs.id = ?
              AND cs.username = ?
        `),
        getChatSessionByParticipants: db.prepare(`
            SELECT cs.id,
                   CASE
                       WHEN cs.assistant_persona_id IS NOT NULL THEN COALESCE(p.name, cs.title)
                       ELSE cs.title
                       END AS title,
                   cs.title AS stored_title,
                   cs.assistant_persona_id,
                   p.name AS assistant_persona_name,
                   cs.user_persona_id,
                   up.name AS user_persona_name,
                   cs.folder_name,
                   cs.is_pinned,
                   cs.archived_at,
                   cs.scenario_prompt,
                   cs.scenario_summary,
                   cs.created_at,
                   cs.updated_at
            FROM chat_sessions cs
                     LEFT JOIN personas p ON p.id = cs.assistant_persona_id
                     LEFT JOIN personas up ON up.id = cs.user_persona_id
            WHERE cs.username = ?
              AND cs.assistant_persona_id = ?
              AND ((cs.user_persona_id IS NULL AND ? IS NULL) OR cs.user_persona_id = ?)
            ORDER BY cs.is_pinned DESC, datetime(cs.updated_at) DESC
            LIMIT 1
        `),
        updateChatSessionTitle: db.prepare("UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?"),
        updateChatSessionScene: db.prepare("UPDATE chat_sessions SET scenario_prompt = ?, scenario_summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?"),
        updateChatSessionOrganization: db.prepare(`
            UPDATE chat_sessions
            SET folder_name = ?,
                is_pinned = ?,
                archived_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND username = ?
        `),
        touchChatSession: db.prepare("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?"),
        deleteChatSession: db.prepare("DELETE FROM chat_sessions WHERE id = ? AND username = ?"),
        clearAssistantPersonaFromChats: db.prepare(`
            UPDATE chat_sessions
            SET assistant_persona_id = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE username = ?
              AND assistant_persona_id = ?
        `),
        clearUserPersonaFromChats: db.prepare(`
            UPDATE chat_sessions
            SET user_persona_id = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE username = ?
              AND user_persona_id = ?
        `),
        insertChatMessage: db.prepare("INSERT INTO chat_messages (chat_id, role, content, model_name, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
        getChatMessages: db.prepare(`
            SELECT id, role, content, model_name, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id, created_at
            FROM chat_messages
            WHERE chat_id = ?
            ORDER BY id
        `),
        getRecentChatMessages: db.prepare(`
            SELECT role, content
            FROM chat_messages
            WHERE chat_id = ?
            ORDER BY id DESC
            LIMIT ?
        `),
        getRecentChatMessagesUpToId: db.prepare(`
            SELECT role, content
            FROM chat_messages
            WHERE chat_id = ?
              AND id <= ?
            ORDER BY id DESC
            LIMIT ?
        `),
        getChatMessageById: db.prepare(`
            SELECT id, role, content, model_name, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id, created_at
            FROM chat_messages
            WHERE id = ?
              AND chat_id = ?
        `),
        getChatMessageByIndex: db.prepare(`
            SELECT id, role, content, model_name, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id, created_at
            FROM chat_messages
            WHERE chat_id = ?
            ORDER BY id
            LIMIT 1 OFFSET ?
        `),
        getLatestChatMessage: db.prepare(`
            SELECT id, role, content, model_name, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id, created_at
            FROM chat_messages
            WHERE chat_id = ?
            ORDER BY id DESC
            LIMIT 1
        `),
        getPreviousUserMessage: db.prepare(`
            SELECT id, role, content, model_name, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id, created_at
            FROM chat_messages
            WHERE chat_id = ?
              AND role = 'user'
              AND id < ?
            ORDER BY id DESC
            LIMIT 1
        `),
        updateChatMessage: db.prepare("UPDATE chat_messages SET content = ? WHERE id = ? AND chat_id = ?"),
        updateChatMessageWithRetryState: db.prepare("UPDATE chat_messages SET content = ?, retry_variants = ?, retry_active_index = ?, retry_retries_used = ?, retry_prompt_message_id = ? WHERE id = ? AND chat_id = ?"),
        deleteChatMessage: db.prepare("DELETE FROM chat_messages WHERE id = ? AND chat_id = ?"),
        deleteChatMessages: db.prepare("DELETE FROM chat_messages WHERE chat_id = ?"),
        searchChats: db.prepare(`
            SELECT DISTINCT cs.id,
                            CASE
                                WHEN cs.assistant_persona_id IS NOT NULL THEN COALESCE(p.name, cs.title)
                                ELSE cs.title
                                END AS title,
                            cs.title AS stored_title,
                            cs.assistant_persona_id,
                            p.name AS assistant_persona_name,
                            cs.user_persona_id,
                            up.name AS user_persona_name,
                            cs.folder_name,
                            cs.is_pinned,
                            cs.archived_at,
                            cs.scenario_prompt,
                            cs.scenario_summary,
                            cs.created_at,
                            cs.updated_at,
                            cm.content AS matched_content
            FROM chat_sessions cs
                     LEFT JOIN personas p ON p.id = cs.assistant_persona_id
                     LEFT JOIN personas up ON up.id = cs.user_persona_id
                     LEFT JOIN chat_messages cm ON cm.chat_id = cs.id
            WHERE cs.username = ?
              AND (
                LOWER(CASE
                          WHEN cs.assistant_persona_id IS NOT NULL THEN COALESCE(p.name, cs.title)
                          ELSE cs.title
                    END) LIKE ?
                    OR LOWER(COALESCE(cm.content, '')) LIKE ?
              )
            ORDER BY cs.is_pinned DESC, datetime(cs.updated_at) DESC
        `),
        listPersonasByType: db.prepare(`
            SELECT id, name, pronouns, appearance, background, details, example_dialogues, persona_type,
                   source_market_id, source_creator_username, created_at, updated_at
            FROM personas
            WHERE username = ?
              AND persona_type = ?
            ORDER BY datetime(updated_at) DESC
        `),
        listAllPersonas: db.prepare(`
            SELECT id, username, name, pronouns, appearance, background, details, example_dialogues, persona_type,
                   source_market_id, source_creator_username, created_at, updated_at
            FROM personas
            WHERE username = ?
            ORDER BY datetime(updated_at) DESC
        `),
        getPersona: db.prepare(`
            SELECT id, name, pronouns, appearance, background, details, example_dialogues, persona_type,
                   source_market_id, source_creator_username, created_at, updated_at
            FROM personas
            WHERE id = ?
              AND username = ?
        `),
        insertPersona: db.prepare("INSERT INTO personas (username, name, pronouns, appearance, background, details, example_dialogues, persona_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
        insertMarketPersona: db.prepare("INSERT INTO personas (username, name, pronouns, appearance, background, details, example_dialogues, persona_type, source_market_id, source_creator_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
        getPersonaBySourceMarket: db.prepare(`
            SELECT id
            FROM personas
            WHERE username = ?
              AND source_market_id = ?
        `),
        updatePersona: db.prepare(`
            UPDATE personas
            SET name = ?,
                pronouns = ?,
                appearance = ?,
                background = ?,
                details = ?,
                example_dialogues = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND username = ?
        `),
        deletePersona: db.prepare("DELETE FROM personas WHERE id = ? AND username = ?"),
        getNextPersonaVersionNumber: db.prepare("SELECT COALESCE(MAX(version_number), 0) + 1 AS nextVersion FROM persona_versions WHERE persona_id = ?"),
        insertPersonaVersion: db.prepare("INSERT INTO persona_versions (persona_id, username, version_number, snapshot_json) VALUES (?, ?, ?, ?)"),
        listPersonaVersions: db.prepare(`
            SELECT id, persona_id, username, version_number, snapshot_json, created_at
            FROM persona_versions
            WHERE persona_id = ?
              AND username = ?
            ORDER BY version_number DESC
        `),
        getPersonaVersion: db.prepare(`
            SELECT id, persona_id, username, version_number, snapshot_json, created_at
            FROM persona_versions
            WHERE id = ?
              AND persona_id = ?
              AND username = ?
        `),
        getActivePersonaId: db.prepare("SELECT active_persona_id, active_user_persona_id FROM user_settings WHERE username = ?"),
        setActiveUserPersona: db.prepare(`
            INSERT INTO user_settings (username, active_user_persona_id)
            VALUES (?, ?)
            ON CONFLICT(username) DO UPDATE SET active_user_persona_id = excluded.active_user_persona_id
        `),
        getActiveUserPersona: db.prepare(`
            SELECT p.id, p.name, p.pronouns, p.appearance, p.background, p.details, p.example_dialogues
            FROM user_settings us
                     JOIN personas p ON p.id = us.active_user_persona_id
            WHERE us.username = ?
        `),
        getAssistantPersonaForChat: db.prepare(`
            SELECT p.id, p.name, p.pronouns, p.appearance, p.background, p.details, p.example_dialogues
            FROM chat_sessions cs
                     JOIN personas p ON p.id = cs.assistant_persona_id
            WHERE cs.id = ?
              AND cs.username = ?
        `),
        getUserPersonaForChat: db.prepare(`
            SELECT p.id, p.name, p.pronouns, p.appearance, p.background, p.details, p.example_dialogues
            FROM chat_sessions cs
                     JOIN personas p ON p.id = cs.user_persona_id
            WHERE cs.id = ?
              AND cs.username = ?
        `),
        listMarketPersonas: db.prepare(`
            SELECT pm.id, pm.persona_id, pm.creator_username, pm.name, pm.pronouns, pm.appearance, pm.background, pm.details,
                   pm.example_dialogues, pm.persona_type, pm.tags, pm.usage_count, pm.favorite_count, pm.rating_total, pm.rating_count,
                   pm.moderation_status, pm.moderation_notes, pm.created_at, pm.updated_at, pm.soft_deleted_at,
                   CASE WHEN pm.rating_count > 0 THEN CAST(pm.rating_total AS REAL) / pm.rating_count ELSE 0 END AS rating_average
            FROM persona_market pm
            WHERE pm.soft_deleted_at IS NULL
              AND pm.moderation_status != 'rejected'
            ORDER BY pm.favorite_count DESC, rating_average DESC, datetime(pm.updated_at) DESC
        `),
        listMarketPersonasAdmin: db.prepare(`
            SELECT pm.id, pm.persona_id, pm.creator_username, pm.name, pm.pronouns, pm.appearance, pm.background, pm.details,
                   pm.example_dialogues, pm.persona_type, pm.tags, pm.usage_count, pm.favorite_count, pm.rating_total, pm.rating_count,
                   pm.moderation_status, pm.moderation_notes, pm.created_at, pm.updated_at, pm.soft_deleted_at,
                   CASE WHEN pm.rating_count > 0 THEN CAST(pm.rating_total AS REAL) / pm.rating_count ELSE 0 END AS rating_average
            FROM persona_market pm
            ORDER BY datetime(pm.updated_at) DESC
        `),
        getMarketPersona: db.prepare(`
            SELECT pm.id, pm.persona_id, pm.creator_username, pm.name, pm.pronouns, pm.appearance, pm.background, pm.details,
                   pm.example_dialogues, pm.persona_type, pm.tags, pm.usage_count, pm.favorite_count, pm.rating_total, pm.rating_count,
                   pm.moderation_status, pm.moderation_notes, pm.soft_deleted_at,
                   CASE WHEN pm.rating_count > 0 THEN CAST(pm.rating_total AS REAL) / pm.rating_count ELSE 0 END AS rating_average
            FROM persona_market pm
            WHERE pm.id = ?
        `),
        getMarketPersonaByPersonaId: db.prepare(`
            SELECT id, persona_id, creator_username, name, pronouns, appearance, background, details,
                   example_dialogues, persona_type, tags, usage_count, favorite_count, rating_total, rating_count,
                   moderation_status, moderation_notes, soft_deleted_at
            FROM persona_market
            WHERE persona_id = ?
              AND creator_username = ?
        `),
        upsertMarketPersona: db.prepare(`
            INSERT INTO persona_market (persona_id, creator_username, name, pronouns, appearance, background, details, example_dialogues, persona_type, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(persona_id, creator_username) DO UPDATE SET
                name = excluded.name,
                pronouns = excluded.pronouns,
                appearance = excluded.appearance,
                background = excluded.background,
                details = excluded.details,
                example_dialogues = excluded.example_dialogues,
                persona_type = excluded.persona_type,
                tags = excluded.tags,
                moderation_status = 'approved',
                moderation_notes = NULL,
                soft_deleted_at = NULL,
                updated_at = CURRENT_TIMESTAMP
        `),
        listPublishedPersonaIds: db.prepare("SELECT persona_id FROM persona_market WHERE creator_username = ? AND soft_deleted_at IS NULL"),
        insertMarketFavorite: db.prepare("INSERT OR IGNORE INTO persona_market_favorites (market_id, username) VALUES (?, ?)"),
        deleteMarketFavorite: db.prepare("DELETE FROM persona_market_favorites WHERE market_id = ? AND username = ?"),
        isMarketFavorite: db.prepare("SELECT 1 AS favorite FROM persona_market_favorites WHERE market_id = ? AND username = ?"),
        recountMarketFavorites: db.prepare("UPDATE persona_market SET favorite_count = (SELECT COUNT(*) FROM persona_market_favorites WHERE market_id = ?) WHERE id = ?"),
        upsertMarketRating: db.prepare(`
            INSERT INTO persona_market_ratings (market_id, username, rating)
            VALUES (?, ?, ?)
            ON CONFLICT(market_id, username) DO UPDATE SET
                rating = excluded.rating,
                updated_at = CURRENT_TIMESTAMP
        `),
        recountMarketRatings: db.prepare(`
            UPDATE persona_market
            SET rating_total = COALESCE((SELECT SUM(rating) FROM persona_market_ratings WHERE market_id = ?), 0),
                rating_count = COALESCE((SELECT COUNT(*) FROM persona_market_ratings WHERE market_id = ?), 0)
            WHERE id = ?
        `),
        insertMarketReport: db.prepare("INSERT INTO persona_market_reports (market_id, reporter_username, reason, details) VALUES (?, ?, ?, ?)"),
        listMarketReports: db.prepare(`
            SELECT id, market_id, reporter_username, reason, details, status, created_at, updated_at
            FROM persona_market_reports
            ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, datetime(created_at) DESC
        `),
        updateMarketReportStatus: db.prepare("UPDATE persona_market_reports SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"),
        updateMarketModeration: db.prepare(`
            UPDATE persona_market
            SET moderation_status = ?,
                moderation_notes = ?,
                soft_deleted_at = CASE WHEN ? THEN COALESCE(soft_deleted_at, CURRENT_TIMESTAMP) ELSE NULL END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `),
        insertPromptTemplate: db.prepare(`
            INSERT INTO prompt_templates (username, persona_id, name, description, category, prompt_text, starter_text, is_shared)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `),
        getPromptTemplate: db.prepare(`
            SELECT id, username, persona_id, name, description, category, prompt_text, starter_text, is_shared, created_at, updated_at
            FROM prompt_templates
            WHERE id = ?
        `),
        updatePromptTemplate: db.prepare(`
            UPDATE prompt_templates
            SET name = ?,
                description = ?,
                category = ?,
                prompt_text = ?,
                starter_text = ?,
                is_shared = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND (username = ? OR (username IS NULL AND ? = 'system'))
        `),
        deletePromptTemplate: db.prepare("DELETE FROM prompt_templates WHERE id = ? AND username = ?"),
        listPromptTemplates: db.prepare(`
            SELECT id, username, persona_id, name, description, category, prompt_text, starter_text, is_shared, created_at, updated_at
            FROM prompt_templates
            WHERE username = ?
               OR (is_shared = 1)
               OR (username IS NULL)
            ORDER BY is_shared DESC, datetime(updated_at) DESC
        `),
        listPersonaPromptTemplates: db.prepare(`
            SELECT id, username, persona_id, name, description, category, prompt_text, starter_text, is_shared, created_at, updated_at
            FROM prompt_templates
            WHERE (persona_id = ? AND (username = ? OR username IS NULL OR is_shared = 1))
               OR (persona_id IS NULL AND (username = ? OR username IS NULL OR is_shared = 1))
            ORDER BY is_shared DESC, datetime(updated_at) DESC
        `),
        getChatMessageCountForUser: db.prepare(`
            SELECT COUNT(*) as count
            FROM chat_messages cm
                     JOIN chat_sessions cs ON cs.id = cm.chat_id
            WHERE cs.username = ?
        `),
        getPersonaCountForUser: db.prepare("SELECT COUNT(*) as count FROM personas WHERE username = ?"),
        getPublishedPersonaCountForUser: db.prepare("SELECT COUNT(*) as count FROM persona_market WHERE creator_username = ? AND soft_deleted_at IS NULL"),
        getRecentActivity: db.prepare(`
            SELECT cs.id AS chat_id,
                   cs.title,
                   MAX(cm.created_at) AS last_message_at,
                   COUNT(cm.id) AS message_count
            FROM chat_sessions cs
                     LEFT JOIN chat_messages cm ON cm.chat_id = cs.id
            WHERE cs.username = ?
            GROUP BY cs.id
            ORDER BY datetime(MAX(COALESCE(cm.created_at, cs.updated_at))) DESC
            LIMIT 5
        `),
        getMostUsedPersonas: db.prepare(`
            SELECT p.id, p.name, COUNT(cs.id) AS usage_count
            FROM personas p
                     LEFT JOIN chat_sessions cs ON cs.assistant_persona_id = p.id OR cs.user_persona_id = p.id
            WHERE p.username = ?
            GROUP BY p.id
            ORDER BY usage_count DESC, datetime(p.updated_at) DESC
            LIMIT 5
        `),
        getAverageChatLength: db.prepare(`
            SELECT AVG(message_count) AS average_length
            FROM (
                     SELECT COUNT(cm.id) AS message_count
                     FROM chat_sessions cs
                              LEFT JOIN chat_messages cm ON cm.chat_id = cs.id
                     WHERE cs.username = ?
                     GROUP BY cs.id
                 )
        `),
        getFavoriteModel: db.prepare(`
            SELECT model_name, COUNT(*) AS usage_count
            FROM chat_messages cm
                     JOIN chat_sessions cs ON cs.id = cm.chat_id
            WHERE cs.username = ?
              AND cm.model_name IS NOT NULL
            GROUP BY model_name
            ORDER BY usage_count DESC
            LIMIT 1
        `),
        getCollectedPersonaCount: db.prepare("SELECT COUNT(*) AS count FROM personas WHERE username = ? AND source_market_id IS NOT NULL"),
        getPublishedPersonaUsage: db.prepare(`
            SELECT COUNT(*) AS published_count, COALESCE(SUM(usage_count), 0) AS usage_total
            FROM persona_market
            WHERE creator_username = ?
              AND soft_deleted_at IS NULL
        `),
        updateChatSessionsUsername: db.prepare("UPDATE chat_sessions SET username = ? WHERE username = ?"),
        updatePersonasUsername: db.prepare("UPDATE personas SET username = ? WHERE username = ?"),
        updatePersonasSourceCreator: db.prepare("UPDATE personas SET source_creator_username = ? WHERE source_creator_username = ?"),
        updateUserSettingsUsername: db.prepare("UPDATE user_settings SET username = ? WHERE username = ?"),
        updatePersonaMarketCreator: db.prepare("UPDATE persona_market SET creator_username = ? WHERE creator_username = ?"),
        updatePersonaVersionsUsername: db.prepare("UPDATE persona_versions SET username = ? WHERE username = ?"),
        updatePromptTemplatesUsername: db.prepare("UPDATE prompt_templates SET username = ? WHERE username = ?"),
        updateMarketFavoritesUsername: db.prepare("UPDATE persona_market_favorites SET username = ? WHERE username = ?"),
        updateMarketRatingsUsername: db.prepare("UPDATE persona_market_ratings SET username = ? WHERE username = ?"),
        updateMarketReportsUsername: db.prepare("UPDATE persona_market_reports SET reporter_username = ? WHERE reporter_username = ?"),
        deleteMarketPersonaByPersonaId: db.prepare("DELETE FROM persona_market WHERE persona_id = ? AND creator_username = ?"),
        incrementMarketUsageCount: db.prepare("UPDATE persona_market SET usage_count = usage_count + 1 WHERE id = ?")
    };

    const renameUserTransaction = db.transaction((currentUsername, nextUsername) => {
        statements.updateUsername.run(nextUsername, currentUsername);
        statements.updateChatSessionsUsername.run(nextUsername, currentUsername);
        statements.updatePersonasUsername.run(nextUsername, currentUsername);
        statements.updatePersonasSourceCreator.run(nextUsername, currentUsername);
        statements.updateUserSettingsUsername.run(nextUsername, currentUsername);
        statements.updatePersonaMarketCreator.run(nextUsername, currentUsername);
        statements.updatePersonaVersionsUsername.run(nextUsername, currentUsername);
        statements.updatePromptTemplatesUsername.run(nextUsername, currentUsername);
        statements.updateMarketFavoritesUsername.run(nextUsername, currentUsername);
        statements.updateMarketRatingsUsername.run(nextUsername, currentUsername);
        statements.updateMarketReportsUsername.run(nextUsername, currentUsername);
    });

    const savePersonaVersion = db.transaction((personaId, username) => {
        const persona = statements.getPersona.get(personaId, username);
        if (!persona) return null;
        const versionNumber = statements.getNextPersonaVersionNumber.get(personaId).nextVersion;
        statements.insertPersonaVersion.run(personaId, username, versionNumber, buildPersonaSnapshot(persona));
        return versionNumber;
    });

    const clonePersonaTransaction = db.transaction((personaId, username) => {
        const source = statements.getPersona.get(personaId, username);
        if (!source) return null;
        const cloneId = statements.insertPersona.run(
            username,
            `${source.name} Copy`,
            source.pronouns,
            source.appearance,
            source.background,
            source.details,
            source.example_dialogues,
            source.persona_type
        ).lastInsertRowid;
        const clone = statements.getPersona.get(cloneId, username);
        statements.insertPersonaVersion.run(cloneId, username, 1, buildPersonaSnapshot(clone));
        return clone;
    });

    const importWorkspaceTransaction = db.transaction((username, workspace) => {
        const imported = {personas: 0, chats: 0, templates: 0};
        for (const persona of workspace.personas || []) {
            const personaId = statements.insertPersona.run(
                username,
                persona.name,
                persona.pronouns ?? null,
                persona.appearance ?? null,
                persona.background ?? null,
                persona.details ?? null,
                persona.example_dialogues ?? null,
                persona.persona_type || "assistant"
            ).lastInsertRowid;
            statements.insertPersonaVersion.run(personaId, username, 1, JSON.stringify(persona));
            imported.personas += 1;
        }

        for (const template of workspace.templates || []) {
            statements.insertPromptTemplate.run(
                username,
                null,
                template.name,
                template.description ?? null,
                template.category ?? null,
                template.prompt_text,
                template.starter_text ?? null,
                template.is_shared ? 1 : 0
            );
            imported.templates += 1;
        }

        for (const chat of workspace.chats || []) {
            const chatId = statements.insertChatSession.run(
                username,
                chat.stored_title || chat.title || "Imported chat",
                null,
                null,
                chat.folder_name ?? null,
                chat.is_pinned ? 1 : 0,
                chat.archived_at ?? null,
                chat.scenario_prompt ?? null,
                chat.scenario_summary ?? null
            ).lastInsertRowid;
            for (const message of chat.messages || []) {
                statements.insertChatMessage.run(
                    chatId,
                    message.role,
                    message.content,
                    message.model_name ?? null,
                    JSON.stringify(message.retryVariants || [message.content || ""]),
                    Number(message.retryActiveIndex || 0),
                    Number(message.retryRetriesUsed || 0),
                    message.retryPromptMessageId ?? null
                );
            }
            imported.chats += 1;
        }

        return imported;
    });

    return {
        getUser: (username) => statements.getUser.get(username),
        insertUser: (username, passwordHash) => statements.insertUser.run(username, passwordHash),
        updatePassword: (passwordHash, username) => statements.updatePassword.run(passwordHash, username),
        renameUser: (currentUsername, nextUsername) => renameUserTransaction(currentUsername, nextUsername),
        listChats: (username) => statements.listChatSessions.all(username),
        searchChats(username, query) {
            const like = `%${String(query || "").trim().toLowerCase()}%`;
            return statements.searchChats.all(username, like, like);
        },
        countChats: (username) => statements.countChatSessions.get(username).count,
        getChat: (chatId, username) => statements.getChatSession.get(chatId, username),
        getChatByParticipants: (username, assistantPersonaId, userPersonaId) => statements.getChatSessionByParticipants.get(username, assistantPersonaId, userPersonaId, userPersonaId),
        createChat(username, title, assistantPersonaId = null, userPersonaId = null, scenarioPrompt = null, scenarioSummary = null, organization = {}) {
            const chatId = statements.insertChatSession.run(
                username,
                title,
                assistantPersonaId,
                userPersonaId,
                organization.folderName ?? null,
                organization.isPinned ? 1 : 0,
                organization.archivedAt ?? null,
                scenarioPrompt,
                scenarioSummary
            ).lastInsertRowid;
            return statements.getChatSession.get(chatId, username);
        },
        updateChatTitle: (chatId, username, title) => statements.updateChatSessionTitle.run(title, chatId, username),
        updateChatScene: (chatId, username, scenarioPrompt, scenarioSummary) => statements.updateChatSessionScene.run(scenarioPrompt, scenarioSummary, chatId, username),
        updateChatOrganization(chatId, username, {folderName = null, isPinned = false, archivedAt = null}) {
            return statements.updateChatSessionOrganization.run(folderName, isPinned ? 1 : 0, archivedAt, chatId, username);
        },
        touchChat: (chatId, username) => statements.touchChatSession.run(chatId, username),
        deleteChat: (chatId, username) => statements.deleteChatSession.run(chatId, username),
        listChatMessages: (chatId) => statements.getChatMessages.all(chatId),
        getRecentChatMessages: (chatId) => statements.getRecentChatMessages.all(chatId, config.chatHistoryLimit),
        getRecentChatMessagesUpToId: (chatId, messageId) => statements.getRecentChatMessagesUpToId.all(chatId, messageId, config.chatHistoryLimit),
        getChatMessage: (chatId, messageId) => statements.getChatMessageById.get(messageId, chatId),
        getChatMessageByIndex: (chatId, index) => statements.getChatMessageByIndex.get(chatId, index),
        getLatestChatMessage: (chatId) => statements.getLatestChatMessage.get(chatId),
        getPreviousUserMessage: (chatId, messageId) => statements.getPreviousUserMessage.get(chatId, messageId),
        insertChatMessage(chatId, role, content, retryState = null, modelName = null) {
            return statements.insertChatMessage.run(
                chatId,
                role,
                String(content || ""),
                modelName || null,
                retryState ? JSON.stringify(retryState.retryVariants) : null,
                retryState?.retryActiveIndex ?? 0,
                retryState?.retryRetriesUsed ?? 0,
                retryState?.retryPromptMessageId ?? null
            );
        },
        updateChatMessage: (chatId, messageId, content) => statements.updateChatMessage.run(content, messageId, chatId),
        updateChatMessageRetryState: (chatId, messageId, payload) => statements.updateChatMessageWithRetryState.run(
            payload.content,
            JSON.stringify(payload.retryVariants),
            payload.retryActiveIndex,
            payload.retryRetriesUsed,
            payload.retryPromptMessageId ?? null,
            messageId,
            chatId
        ),
        deleteChatMessage: (chatId, messageId) => statements.deleteChatMessage.run(messageId, chatId),
        clearChatMessages: (chatId) => statements.deleteChatMessages.run(chatId),
        listPersonasByType: (username, personaType) => statements.listPersonasByType.all(username, personaType),
        listAllPersonas: (username) => statements.listAllPersonas.all(username),
        getPersona: (personaId, username) => statements.getPersona.get(personaId, username),
        createPersona(username, payload, personaType) {
            const personaId = statements.insertPersona.run(
                username,
                payload.name,
                payload.pronouns,
                payload.appearance,
                payload.background,
                payload.details,
                payload.exampleDialogues,
                personaType
            ).lastInsertRowid;
            const persona = statements.getPersona.get(personaId, username);
            statements.insertPersonaVersion.run(personaId, username, 1, buildPersonaSnapshot(persona));
            return persona;
        },
        updatePersona(personaId, username, payload) {
            savePersonaVersion(personaId, username);
            return statements.updatePersona.run(
                payload.name,
                payload.pronouns,
                payload.appearance,
                payload.background,
                payload.details,
                payload.exampleDialogues,
                personaId,
                username
            );
        },
        restorePersonaVersion(personaId, versionId, username) {
            const version = statements.getPersonaVersion.get(versionId, personaId, username);
            if (!version) return null;
            savePersonaVersion(personaId, username);
            const snapshot = JSON.parse(version.snapshot_json);
            statements.updatePersona.run(
                snapshot.name,
                snapshot.pronouns ?? null,
                snapshot.appearance ?? null,
                snapshot.background ?? null,
                snapshot.details ?? null,
                snapshot.example_dialogues ?? null,
                personaId,
                username
            );
            return statements.getPersona.get(personaId, username);
        },
        listPersonaVersions(personaId, username) {
            return statements.listPersonaVersions.all(personaId, username).map((version) => ({
                ...version,
                snapshot: JSON.parse(version.snapshot_json)
            }));
        },
        clonePersona: (personaId, username) => clonePersonaTransaction(personaId, username),
        deletePersona: (personaId, username) => statements.deletePersona.run(personaId, username),
        clearPersonaReferences(username, personaId) {
            statements.clearAssistantPersonaFromChats.run(username, personaId);
            statements.clearUserPersonaFromChats.run(username, personaId);
            statements.deleteMarketPersonaByPersonaId.run(personaId, username);
        },
        getActivePersonaIds: (username) => statements.getActivePersonaId.get(username) || {},
        setActiveUserPersona: (username, personaId) => statements.setActiveUserPersona.run(username, personaId),
        getActiveUserPersona: (username) => statements.getActiveUserPersona.get(username),
        getAssistantPersonaForChat: (chatId, username) => statements.getAssistantPersonaForChat.get(chatId, username),
        getUserPersonaForChat: (chatId, username) => statements.getUserPersonaForChat.get(chatId, username),
        listMarketPersonas({admin = false, username = null, personaType = null, sort = "best"} = {}) {
            const normalizedPersonaType = normalizeMarketPersonaType(personaType);
            const normalizedSort = normalizeMarketSort(sort);
            const params = [username];
            const filters = [];

            if (!admin) {
                filters.push("pm.soft_deleted_at IS NULL");
                filters.push("pm.moderation_status != 'rejected'");
            }

            if (normalizedPersonaType) {
                filters.push("pm.persona_type = ?");
                params.push(normalizedPersonaType);
            }

            const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
            const query = db.prepare(`
                SELECT pm.id, pm.persona_id, pm.creator_username, pm.name, pm.pronouns, pm.appearance, pm.background, pm.details,
                       pm.example_dialogues, pm.persona_type, pm.tags, pm.usage_count, pm.favorite_count, pm.rating_total, pm.rating_count,
                       pm.moderation_status, pm.moderation_notes, pm.created_at, pm.updated_at, pm.soft_deleted_at,
                       CASE WHEN pm.rating_count > 0 THEN CAST(pm.rating_total AS REAL) / pm.rating_count ELSE 0 END AS rating_average,
                       CASE WHEN mf.username IS NULL THEN 0 ELSE 1 END AS is_favorite
                FROM persona_market pm
                         LEFT JOIN persona_market_favorites mf ON mf.market_id = pm.id AND mf.username = ?
                ${whereClause}
                ORDER BY ${MARKET_SORT_ORDERS[normalizedSort]}
            `);

            return query.all(...params).map((persona) => ({
                ...persona,
                is_favorite: Boolean(persona.is_favorite),
                tags: parseJsonArray(persona.tags)
            }));
        },
        getMarketPersona: (marketId) => {
            const persona = statements.getMarketPersona.get(marketId);
            return persona ? {...persona, tags: parseJsonArray(persona.tags)} : null;
        },
        getMarketPersonaByPersonaId: (personaId, username) => {
            const persona = statements.getMarketPersonaByPersonaId.get(personaId, username);
            return persona ? {...persona, tags: parseJsonArray(persona.tags)} : null;
        },
        upsertMarketPersona(personaId, username, persona, tags = []) {
            statements.upsertMarketPersona.run(
                personaId,
                username,
                persona.name,
                persona.pronouns,
                persona.appearance,
                persona.background,
                persona.details,
                persona.example_dialogues,
                persona.persona_type,
                JSON.stringify(tags)
            );
            return this.getMarketPersonaByPersonaId(personaId, username);
        },
        listPublishedPersonaIds: (username) => statements.listPublishedPersonaIds.all(username).map((row) => row.persona_id),
        getPersonaBySourceMarket: (username, marketId) => statements.getPersonaBySourceMarket.get(username, marketId),
        collectMarketPersona(username, marketPersona) {
            const personaId = statements.insertMarketPersona.run(
                username,
                marketPersona.name,
                marketPersona.pronouns,
                marketPersona.appearance,
                marketPersona.background,
                marketPersona.details,
                marketPersona.example_dialogues,
                marketPersona.persona_type,
                marketPersona.id,
                marketPersona.creator_username
            ).lastInsertRowid;
            const persona = statements.getPersona.get(personaId, username);
            statements.insertPersonaVersion.run(personaId, username, 1, buildPersonaSnapshot(persona));
            return persona;
        },
        incrementMarketUsageCount: (marketId) => statements.incrementMarketUsageCount.run(marketId),
        toggleMarketFavorite(marketId, username) {
            const favorite = statements.isMarketFavorite.get(marketId, username);
            if (favorite) statements.deleteMarketFavorite.run(marketId, username);
            else statements.insertMarketFavorite.run(marketId, username);
            statements.recountMarketFavorites.run(marketId, marketId);
            return !favorite;
        },
        rateMarketPersona(marketId, username, rating) {
            statements.upsertMarketRating.run(marketId, username, rating);
            statements.recountMarketRatings.run(marketId, marketId, marketId);
            return this.getMarketPersona(marketId);
        },
        reportMarketPersona: (marketId, username, reason, details) => statements.insertMarketReport.run(marketId, username, reason, details),
        listMarketReports: () => statements.listMarketReports.all(),
        updateMarketReportStatus: (reportId, status) => statements.updateMarketReportStatus.run(status, reportId),
        updateMarketModeration: (marketId, {status, notes = null, softDelete = false}) => statements.updateMarketModeration.run(status, notes, softDelete ? 1 : 0, marketId),
        deletePublishedPersona: (personaId, username) => statements.deleteMarketPersonaByPersonaId.run(personaId, username),
        createPromptTemplate(username, payload) {
            const id = statements.insertPromptTemplate.run(
                username,
                payload.personaId ?? null,
                payload.name,
                payload.description ?? null,
                payload.category ?? null,
                payload.promptText,
                payload.starterText ?? null,
                payload.isShared ? 1 : 0
            ).lastInsertRowid;
            return statements.getPromptTemplate.get(id);
        },
        updatePromptTemplate(templateId, username, payload) {
            return statements.updatePromptTemplate.run(
                payload.name,
                payload.description ?? null,
                payload.category ?? null,
                payload.promptText,
                payload.starterText ?? null,
                payload.isShared ? 1 : 0,
                templateId,
                username,
                username
            );
        },
        deletePromptTemplate: (templateId, username) => statements.deletePromptTemplate.run(templateId, username),
        listPromptTemplates: (username) => statements.listPromptTemplates.all(username),
        listPromptTemplatesForPersona: (username, personaId = null) => statements.listPersonaPromptTemplates.all(personaId, username, username),
        getPromptTemplate: (templateId) => statements.getPromptTemplate.get(templateId),
        getDashboardSummary(username) {
            const favoriteModel = statements.getFavoriteModel.get(username);
            const publishedUsage = statements.getPublishedPersonaUsage.get(username);
            return {
                chats: statements.countChatSessions.get(username).count,
                messages: statements.getChatMessageCountForUser.get(username).count,
                personas: statements.getPersonaCountForUser.get(username).count,
                published: statements.getPublishedPersonaCountForUser.get(username).count,
                marketPersonas: statements.listMarketPersonas.all().length,
                mostUsedPersonas: statements.getMostUsedPersonas.all(username),
                averageChatLength: Number(statements.getAverageChatLength.get(username)?.average_length || 0),
                favoriteModel: favoriteModel?.model_name || null,
                recentActivity: statements.getRecentActivity.all(username),
                collectedPersonaCount: statements.getCollectedPersonaCount.get(username).count,
                publishedPersonaPerformance: {
                    publishedCount: publishedUsage.published_count,
                    totalUses: publishedUsage.usage_total
                }
            };
        },
        exportWorkspace(username) {
            return {
                exportedAt: new Date().toISOString(),
                chats: this.listChats(username).map((chat) => ({
                    ...chat,
                    messages: this.listChatMessages(chat.id).map((message) => ({
                        ...message,
                        retryVariants: parseJsonArray(message.retry_variants)
                    }))
                })),
                personas: this.listAllPersonas(username),
                templates: this.listPromptTemplates(username)
            };
        },
        importWorkspace: (username, workspace) => importWorkspaceTransaction(username, workspace)
    };
}
