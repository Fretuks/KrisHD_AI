export function initializeSchema(db) {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    db.prepare(`
        CREATE TABLE IF NOT EXISTS users
        (
            username TEXT PRIMARY KEY,
            password TEXT NOT NULL
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS chat_sessions
        (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            title TEXT NOT NULL,
            assistant_persona_id INTEGER,
            user_persona_id INTEGER,
            folder_name TEXT,
            is_pinned INTEGER DEFAULT 0,
            archived_at DATETIME,
            scenario_prompt TEXT,
            scenario_summary TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assistant_persona_id) REFERENCES personas (id) ON DELETE SET NULL,
            FOREIGN KEY (user_persona_id) REFERENCES personas (id) ON DELETE SET NULL
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS chat_messages
        (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            model_name TEXT,
            retry_variants TEXT,
            retry_active_index INTEGER DEFAULT 0,
            retry_retries_used INTEGER DEFAULT 0,
            retry_prompt_message_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (chat_id) REFERENCES chat_sessions (id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS personas
        (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            name TEXT NOT NULL,
            pronouns TEXT,
            appearance TEXT,
            background TEXT,
            details TEXT,
            custom_fields TEXT,
            persona_type TEXT DEFAULT 'assistant',
            source_market_id INTEGER,
            source_creator_username TEXT,
            example_dialogues TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS user_settings
        (
            username TEXT PRIMARY KEY,
            active_persona_id INTEGER,
            active_user_persona_id INTEGER,
            FOREIGN KEY (username) REFERENCES users (username) ON DELETE CASCADE,
            FOREIGN KEY (active_persona_id) REFERENCES personas (id) ON DELETE SET NULL,
            FOREIGN KEY (active_user_persona_id) REFERENCES personas (id) ON DELETE SET NULL
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS persona_market
        (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            persona_id INTEGER,
            creator_username TEXT NOT NULL,
            name TEXT NOT NULL,
            pronouns TEXT,
            appearance TEXT,
            background TEXT,
            details TEXT,
            example_dialogues TEXT,
            persona_type TEXT DEFAULT 'assistant',
            tags TEXT,
            usage_count INTEGER DEFAULT 0,
            favorite_count INTEGER DEFAULT 0,
            rating_total INTEGER DEFAULT 0,
            rating_count INTEGER DEFAULT 0,
            moderation_status TEXT DEFAULT 'approved',
            moderation_notes TEXT,
            soft_deleted_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (persona_id, creator_username)
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS persona_versions
        (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            persona_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            version_number INTEGER NOT NULL,
            snapshot_json TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (persona_id) REFERENCES personas (id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS persona_market_favorites
        (
            market_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (market_id, username),
            FOREIGN KEY (market_id) REFERENCES persona_market (id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS persona_market_ratings
        (
            market_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            rating INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (market_id, username),
            FOREIGN KEY (market_id) REFERENCES persona_market (id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS persona_market_reports
        (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market_id INTEGER NOT NULL,
            reporter_username TEXT NOT NULL,
            reason TEXT NOT NULL,
            details TEXT,
            status TEXT DEFAULT 'open',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (market_id) REFERENCES persona_market (id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS prompt_templates
        (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            persona_id INTEGER,
            name TEXT NOT NULL,
            description TEXT,
            category TEXT,
            prompt_text TEXT NOT NULL,
            starter_text TEXT,
            is_shared INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (persona_id) REFERENCES personas (id) ON DELETE CASCADE
        )
    `).run();
}

export function runMigrations(db, {dropLegacyChats = true} = {}) {
    const ensureColumn = (tableName, columns, name, sql) => {
        if (!columns.some((column) => column.name === name)) {
            db.prepare(sql).run();
        }
    };

    const personaColumns = db.prepare("PRAGMA table_info(personas)").all();
    ensureColumn("personas", personaColumns, "custom_fields", "ALTER TABLE personas ADD COLUMN custom_fields TEXT");
    ensureColumn("personas", personaColumns, "persona_type", "ALTER TABLE personas ADD COLUMN persona_type TEXT DEFAULT 'assistant'");
    ensureColumn("personas", personaColumns, "source_market_id", "ALTER TABLE personas ADD COLUMN source_market_id INTEGER");
    ensureColumn("personas", personaColumns, "source_creator_username", "ALTER TABLE personas ADD COLUMN source_creator_username TEXT");
    ensureColumn("personas", personaColumns, "example_dialogues", "ALTER TABLE personas ADD COLUMN example_dialogues TEXT");

    const userSettingsColumns = db.prepare("PRAGMA table_info(user_settings)").all();
    ensureColumn("user_settings", userSettingsColumns, "active_user_persona_id", "ALTER TABLE user_settings ADD COLUMN active_user_persona_id INTEGER");

    const marketColumns = db.prepare("PRAGMA table_info(persona_market)").all();
    ensureColumn("persona_market", marketColumns, "persona_id", "ALTER TABLE persona_market ADD COLUMN persona_id INTEGER");
    ensureColumn("persona_market", marketColumns, "usage_count", "ALTER TABLE persona_market ADD COLUMN usage_count INTEGER DEFAULT 0");
    ensureColumn("persona_market", marketColumns, "example_dialogues", "ALTER TABLE persona_market ADD COLUMN example_dialogues TEXT");
    ensureColumn("persona_market", marketColumns, "tags", "ALTER TABLE persona_market ADD COLUMN tags TEXT");
    ensureColumn("persona_market", marketColumns, "favorite_count", "ALTER TABLE persona_market ADD COLUMN favorite_count INTEGER DEFAULT 0");
    ensureColumn("persona_market", marketColumns, "rating_total", "ALTER TABLE persona_market ADD COLUMN rating_total INTEGER DEFAULT 0");
    ensureColumn("persona_market", marketColumns, "rating_count", "ALTER TABLE persona_market ADD COLUMN rating_count INTEGER DEFAULT 0");
    ensureColumn("persona_market", marketColumns, "moderation_status", "ALTER TABLE persona_market ADD COLUMN moderation_status TEXT DEFAULT 'approved'");
    ensureColumn("persona_market", marketColumns, "moderation_notes", "ALTER TABLE persona_market ADD COLUMN moderation_notes TEXT");
    ensureColumn("persona_market", marketColumns, "soft_deleted_at", "ALTER TABLE persona_market ADD COLUMN soft_deleted_at DATETIME");
    db.prepare("UPDATE persona_market SET usage_count = 0 WHERE usage_count IS NULL").run();
    db.prepare("UPDATE persona_market SET favorite_count = 0 WHERE favorite_count IS NULL").run();
    db.prepare("UPDATE persona_market SET rating_total = 0 WHERE rating_total IS NULL").run();
    db.prepare("UPDATE persona_market SET rating_count = 0 WHERE rating_count IS NULL").run();

    const chatMessageColumns = db.prepare("PRAGMA table_info(chat_messages)").all();
    ensureColumn("chat_messages", chatMessageColumns, "model_name", "ALTER TABLE chat_messages ADD COLUMN model_name TEXT");
    ensureColumn("chat_messages", chatMessageColumns, "retry_variants", "ALTER TABLE chat_messages ADD COLUMN retry_variants TEXT");
    ensureColumn("chat_messages", chatMessageColumns, "retry_active_index", "ALTER TABLE chat_messages ADD COLUMN retry_active_index INTEGER DEFAULT 0");
    ensureColumn("chat_messages", chatMessageColumns, "retry_retries_used", "ALTER TABLE chat_messages ADD COLUMN retry_retries_used INTEGER DEFAULT 0");
    ensureColumn("chat_messages", chatMessageColumns, "retry_prompt_message_id", "ALTER TABLE chat_messages ADD COLUMN retry_prompt_message_id INTEGER");
    db.prepare("UPDATE chat_messages SET retry_active_index = 0 WHERE retry_active_index IS NULL").run();
    db.prepare("UPDATE chat_messages SET retry_retries_used = 0 WHERE retry_retries_used IS NULL").run();

    const chatSessionColumns = db.prepare("PRAGMA table_info(chat_sessions)").all();
    ensureColumn("chat_sessions", chatSessionColumns, "assistant_persona_id", "ALTER TABLE chat_sessions ADD COLUMN assistant_persona_id INTEGER");
    ensureColumn("chat_sessions", chatSessionColumns, "user_persona_id", "ALTER TABLE chat_sessions ADD COLUMN user_persona_id INTEGER");
    ensureColumn("chat_sessions", chatSessionColumns, "folder_name", "ALTER TABLE chat_sessions ADD COLUMN folder_name TEXT");
    ensureColumn("chat_sessions", chatSessionColumns, "is_pinned", "ALTER TABLE chat_sessions ADD COLUMN is_pinned INTEGER DEFAULT 0");
    ensureColumn("chat_sessions", chatSessionColumns, "archived_at", "ALTER TABLE chat_sessions ADD COLUMN archived_at DATETIME");
    ensureColumn("chat_sessions", chatSessionColumns, "scenario_prompt", "ALTER TABLE chat_sessions ADD COLUMN scenario_prompt TEXT");
    ensureColumn("chat_sessions", chatSessionColumns, "scenario_summary", "ALTER TABLE chat_sessions ADD COLUMN scenario_summary TEXT");
    db.prepare("UPDATE chat_sessions SET is_pinned = 0 WHERE is_pinned IS NULL").run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS persona_versions
        (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            persona_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            version_number INTEGER NOT NULL,
            snapshot_json TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (persona_id) REFERENCES personas (id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS persona_market_favorites
        (
            market_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (market_id, username),
            FOREIGN KEY (market_id) REFERENCES persona_market (id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS persona_market_ratings
        (
            market_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            rating INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (market_id, username),
            FOREIGN KEY (market_id) REFERENCES persona_market (id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS persona_market_reports
        (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            market_id INTEGER NOT NULL,
            reporter_username TEXT NOT NULL,
            reason TEXT NOT NULL,
            details TEXT,
            status TEXT DEFAULT 'open',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (market_id) REFERENCES persona_market (id) ON DELETE CASCADE
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS prompt_templates
        (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            persona_id INTEGER,
            name TEXT NOT NULL,
            description TEXT,
            category TEXT,
            prompt_text TEXT NOT NULL,
            starter_text TEXT,
            is_shared INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (persona_id) REFERENCES personas (id) ON DELETE CASCADE
        )
    `).run();

    const legacyChatsExist = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chats'").get();
    if (!legacyChatsExist) {
        return;
    }

    const migrationNeeded = db.prepare("SELECT COUNT(*) as count FROM chat_messages").get();
    if (migrationNeeded.count === 0) {
        const insertChatSessionStmt = db.prepare(
            "INSERT INTO chat_sessions (username, title, assistant_persona_id, user_persona_id, scenario_prompt, scenario_summary) VALUES (?, ?, ?, ?, ?, ?)"
        );
        const getLegacyUsersStmt = db.prepare("SELECT DISTINCT username FROM chats");
        const getLegacyChatsStmt = db.prepare(`
            SELECT role, content
            FROM chats
            WHERE username = ?
            ORDER BY datetime(created_at)
        `);
        const insertChatMessageStmt = db.prepare(
            "INSERT INTO chat_messages (chat_id, role, content, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        const migrateLegacyChats = db.transaction(() => {
            for (const {username} of getLegacyUsersStmt.all()) {
                const chatId = insertChatSessionStmt.run(username, "Imported chat", null, null, null, null).lastInsertRowid;
                for (const row of getLegacyChatsStmt.all(username)) {
                    insertChatMessageStmt.run(chatId, row.role, row.content, null, 0, 0, null);
                }
            }
        });
        migrateLegacyChats();
    }

    if (dropLegacyChats) {
        db.prepare("DROP TABLE chats").run();
    }
}
