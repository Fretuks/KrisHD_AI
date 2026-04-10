import express from "express";
import session from "express-session";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import bodyParser from "body-parser";
import Database from "better-sqlite3";
import FileStoreFactory from "session-file-store";
import {exec} from "child_process";
import {performance} from "perf_hooks";

let last = performance.now();
setInterval(() => {
    const now = performance.now();
    const drift = now - last - 1000;
    last = now;
    if (drift > 50) {
        console.log("EVENT LOOP LAG", Math.round(drift), "ms", new Date().toISOString());
    }
}, 1000);

const modelState = new Map();
const app = express();
const PORT = 3000;
const DB_PATH = "./data/app.db";
const SESSIONS_DIR = path.resolve("sessions");
const UNLOAD_AFTER_MS = 30 * 1000;
let modelsCache = null;
let modelsCacheAt = 0;
const MODELS_TTL_MS = 5 * 60 * 1000;

app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
        const ms = Date.now() - start;
        if (ms > 50) console.log("SLOW REQ", ms + "ms", req.method, req.url);
    });
    next();
});

if (!fs.existsSync("./data")) {
    fs.mkdirSync("./data", {recursive: true});
}

if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, {recursive: true});
}

function scheduleModelUnload(model) {
    if (!modelState.has(model)) {
        modelState.set(model, {timer: null, activeRequests: 0});
    }

    const state = modelState.get(model);

    if (state.timer) {
        clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
        if (state.activeRequests > 0) return;

        console.log(`Unloading model: ${model}`);

        exec(`ollama stop ${model}`, (err) => {
            if (err) {
                console.error(`Failed to unload ${model}:`, err.message);
            } else {
                console.log(`Model unloaded: ${model}`);
                modelState.delete(model);
            }
        });
    }, UNLOAD_AFTER_MS);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.prepare(`
    CREATE TABLE IF NOT EXISTS users
    (
        username
            TEXT
            PRIMARY
                KEY,
        password
            TEXT
            NOT
                NULL
    )
`).run();
db.prepare(`
    CREATE TABLE IF NOT EXISTS chats
    (
        id
            INTEGER
            PRIMARY
                KEY
            AUTOINCREMENT,
        username
            TEXT
            NOT
                NULL,
        role
            TEXT
            NOT
                NULL,
        content
            TEXT
            NOT
                NULL,
        created_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP
    )
`).run();
db.prepare(`
    CREATE TABLE IF NOT EXISTS chat_sessions
    (
        id
            INTEGER
            PRIMARY
                KEY
            AUTOINCREMENT,
        username
            TEXT
            NOT
                NULL,
        title
            TEXT
            NOT
                NULL,
        assistant_persona_id
            INTEGER,
        user_persona_id
            INTEGER,
        scenario_prompt
            TEXT,
        scenario_summary
            TEXT,
        created_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP,
        updated_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP,
        FOREIGN
            KEY
            (
             assistant_persona_id
                ) REFERENCES personas
            (
             id
                ) ON DELETE SET NULL,
        FOREIGN
            KEY
            (
             user_persona_id
                ) REFERENCES personas
            (
             id
                ) ON DELETE SET NULL
    )
`).run();
db.prepare(`
    CREATE TABLE IF NOT EXISTS chat_messages
    (
        id
            INTEGER
            PRIMARY
                KEY
            AUTOINCREMENT,
        chat_id
            INTEGER
            NOT
                NULL,
        role
            TEXT
            NOT
                NULL,
        content
            TEXT
            NOT
                NULL,
        retry_variants
            TEXT,
        retry_active_index
            INTEGER
            DEFAULT 0,
        retry_retries_used
            INTEGER
            DEFAULT 0,
        retry_prompt_message_id
            INTEGER,
        created_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP,
        FOREIGN
            KEY
            (
             chat_id
                ) REFERENCES chat_sessions
            (
             id
                ) ON DELETE CASCADE
    )
`).run();
db.prepare(`
    CREATE TABLE IF NOT EXISTS personas
    (
        id
            INTEGER
            PRIMARY
                KEY
            AUTOINCREMENT,
        username
            TEXT
            NOT
                NULL,
        name
            TEXT
            NOT
                NULL,
        pronouns
            TEXT,
        appearance
            TEXT,
        background
            TEXT,
        details
            TEXT,
        example_dialogues
            TEXT,
        persona_type
            TEXT
            DEFAULT
                'assistant',
        source_market_id
            INTEGER,
        source_creator_username
            TEXT,
        created_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP,
        updated_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP
    )
`).run();
db.prepare(`
    CREATE TABLE IF NOT EXISTS user_settings
    (
        username
            TEXT
            PRIMARY
                KEY,
        active_persona_id
            INTEGER,
        active_user_persona_id
            INTEGER,
        FOREIGN
            KEY
            (
             active_persona_id
                ) REFERENCES personas
            (
             id
                ) ON DELETE SET NULL,
        FOREIGN
            KEY
            (
             active_user_persona_id
                ) REFERENCES personas
            (
             id
                ) ON DELETE SET NULL
    )
`).run();
db.prepare(`
    CREATE TABLE IF NOT EXISTS persona_market
    (
        id
            INTEGER
            PRIMARY
                KEY
            AUTOINCREMENT,
        persona_id
            INTEGER,
        creator_username
            TEXT
            NOT
                NULL,
        name
            TEXT
            NOT
                NULL,
        pronouns
            TEXT,
        appearance
            TEXT,
        background
            TEXT,
        details
            TEXT,
        example_dialogues
            TEXT,
        persona_type
            TEXT
            DEFAULT
                'assistant',
        usage_count
            INTEGER
            DEFAULT
                0,
        created_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP,
        updated_at
            DATETIME
            DEFAULT
                CURRENT_TIMESTAMP,
        UNIQUE
            (
             persona_id,
             creator_username
                )
    )
`).run();

const insertUserStmt = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
const getUserStmt = db.prepare("SELECT username, password FROM users WHERE username = ?");
const updateUsernameStmt = db.prepare("UPDATE users SET username = ? WHERE username = ?");
const updatePasswordStmt = db.prepare("UPDATE users SET password = ? WHERE username = ?");
const getLegacyChatsStmt = db.prepare(`
    SELECT role, content
    FROM chats
    WHERE username = ?
    ORDER BY datetime(created_at)
`);
const insertChatSessionStmt = db.prepare(
    "INSERT INTO chat_sessions (username, title, assistant_persona_id, user_persona_id, scenario_prompt, scenario_summary) VALUES (?, ?, ?, ?, ?, ?)"
);
const listChatSessionsStmt = db.prepare(`
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
           cs.scenario_prompt,
           cs.scenario_summary,
           cs.created_at,
           cs.updated_at
    FROM chat_sessions cs
             LEFT JOIN personas p ON p.id = cs.assistant_persona_id
             LEFT JOIN personas up ON up.id = cs.user_persona_id
    WHERE cs.username = ?
    ORDER BY datetime(cs.updated_at) DESC
`);

const countChatSessionsStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM chat_sessions
    WHERE username = ?
`);

const getChatSessionStmt = db.prepare(`
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
           cs.scenario_prompt,
           cs.scenario_summary
    FROM chat_sessions cs
             LEFT JOIN personas p ON p.id = cs.assistant_persona_id
             LEFT JOIN personas up ON up.id = cs.user_persona_id
    WHERE cs.id = ?
      AND cs.username = ?
`);

const getChatSessionByParticipantsStmt = db.prepare(`
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
           cs.scenario_prompt,
           cs.scenario_summary
    FROM chat_sessions cs
             LEFT JOIN personas p ON p.id = cs.assistant_persona_id
             LEFT JOIN personas up ON up.id = cs.user_persona_id
    WHERE cs.username = ?
      AND cs.assistant_persona_id = ?
      AND (
        (cs.user_persona_id IS NULL AND ? IS NULL)
        OR cs.user_persona_id = ?
      )
    ORDER BY datetime(cs.updated_at) DESC
    LIMIT 1
`);

const updateChatSessionTitleStmt = db.prepare(
    "UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?"
);

const updateChatSessionSceneStmt = db.prepare(
    "UPDATE chat_sessions SET scenario_prompt = ?, scenario_summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?"
);

const touchChatSessionStmt = db.prepare(
    "UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?"
);

const deleteChatSessionStmt = db.prepare(
    "DELETE FROM chat_sessions WHERE id = ? AND username = ?"
);

const clearAssistantPersonaFromChatsStmt = db.prepare(`
    UPDATE chat_sessions
    SET assistant_persona_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE username = ?
      AND assistant_persona_id = ?
`);

const clearUserPersonaFromChatsStmt = db.prepare(`
    UPDATE chat_sessions
    SET user_persona_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE username = ?
      AND user_persona_id = ?
`);

const insertChatMessageStmt = db.prepare(
    "INSERT INTO chat_messages (chat_id, role, content, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

const getChatMessagesStmt = db.prepare(`
                    SELECT id, role, content, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id
                    FROM chat_messages
                    WHERE chat_id = ?
                    ORDER BY id
        `
    )
;
const getRecentChatMessagesStmt = db.prepare(`
                    SELECT role, content
                    FROM chat_messages
                    WHERE chat_id = ?
                    ORDER BY id DESC
                    LIMIT 20
        `
    )
;

const getRecentChatMessagesUpToIdStmt = db.prepare(`
                    SELECT role, content
                    FROM chat_messages
                    WHERE chat_id = ?
                      AND id <= ?
                    ORDER BY id DESC
                    LIMIT 20
        `
    )
;

const getChatMessageByIdStmt = db.prepare(`
                    SELECT id, role, content, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id
                    FROM chat_messages
                    WHERE id = ?
                      AND chat_id = ?
        `
    )
;

const getChatMessageByIndexStmt = db.prepare(`
                    SELECT id, role, content, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id
                    FROM chat_messages
                    WHERE chat_id = ?
                    ORDER BY id
                    LIMIT 1 OFFSET ?
        `
    )
;

const getLatestChatMessageStmt = db.prepare(`
                    SELECT id, role, content, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id
                    FROM chat_messages
                    WHERE chat_id = ?
                    ORDER BY id DESC
                    LIMIT 1
        `
    )
;

const getPreviousUserMessageStmt = db.prepare(`
                    SELECT id, role, content, retry_variants, retry_active_index, retry_retries_used, retry_prompt_message_id
                    FROM chat_messages
                    WHERE chat_id = ?
                      AND role = 'user'
                      AND id < ?
                    ORDER BY id DESC
                    LIMIT 1
        `
    )
;

const updateChatMessageStmt = db.prepare(
    "UPDATE chat_messages SET content = ? WHERE id = ? AND chat_id = ?"
);

const updateChatMessageWithRetryStateStmt = db.prepare(
    "UPDATE chat_messages SET content = ?, retry_variants = ?, retry_active_index = ?, retry_retries_used = ?, retry_prompt_message_id = ? WHERE id = ? AND chat_id = ?"
);

const deleteChatMessageStmt = db.prepare(
    "DELETE FROM chat_messages WHERE id = ? AND chat_id = ?"
);

const deleteChatMessagesStmt = db.prepare(
    "DELETE FROM chat_messages WHERE chat_id = ?"
);

const listPersonasByTypeStmt = db.prepare(`
    SELECT id,
           name,
           pronouns,
           appearance,
           background,
           details,
           example_dialogues,
           persona_type,
           source_market_id,
           source_creator_username,
           created_at,
           updated_at
    FROM personas
    WHERE username = ?
      AND persona_type = ?
    ORDER BY datetime(updated_at) DESC
`);

const getPersonaStmt = db.prepare(`
    SELECT id, name, pronouns, appearance, background, details, example_dialogues, persona_type
    FROM personas
    WHERE id = ?
      AND username = ?
`);

const getPersonaForPublishStmt = db.prepare(`
    SELECT id,
           name,
           pronouns,
           appearance,
           background,
           details,
           example_dialogues,
           persona_type,
           source_market_id,
           source_creator_username
    FROM personas
    WHERE id = ?
      AND username = ?
`);

const insertPersonaStmt = db.prepare(
    "INSERT INTO personas (username, name, pronouns, appearance, background, details, example_dialogues, persona_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);

const insertMarketPersonaStmt = db.prepare(
    "INSERT INTO personas (username, name, pronouns, appearance, background, details, example_dialogues, persona_type, source_market_id, source_creator_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
);

const getPersonaBySourceMarketStmt = db.prepare(`
    SELECT id
    FROM personas
    WHERE username = ?
      AND source_market_id = ?
`);

const updatePersonaStmt = db.prepare(`
    UPDATE personas
    SET name       = ?,
        pronouns   = ?,
        appearance = ?,
        background = ?,
        details    = ?,
        example_dialogues = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND username = ?
`);

const deletePersonaStmt = db.prepare(
    "DELETE FROM personas WHERE id = ? AND username = ?"
);

const getActivePersonaIdStmt = db.prepare(
    "SELECT active_persona_id, active_user_persona_id FROM user_settings WHERE username = ?"
);

const setActivePersonaStmt = db.prepare(`
    INSERT INTO user_settings (username, active_persona_id)
    VALUES (?, ?)
    ON CONFLICT(username) DO UPDATE SET active_persona_id = excluded.active_persona_id
`);

const setActiveUserPersonaStmt = db.prepare(`
    INSERT INTO user_settings (username, active_user_persona_id)
    VALUES (?, ?)
    ON CONFLICT(username) DO UPDATE SET active_user_persona_id = excluded.active_user_persona_id
`);

const getActivePersonaStmt = db.prepare(`
    SELECT p.id, p.name, p.pronouns, p.appearance, p.background, p.details, p.example_dialogues
    FROM user_settings us
             JOIN personas p ON p.id = us.active_persona_id
    WHERE us.username = ?
`);

const getActiveUserPersonaStmt = db.prepare(`
    SELECT p.id, p.name, p.pronouns, p.appearance, p.background, p.details, p.example_dialogues
    FROM user_settings us
             JOIN personas p ON p.id = us.active_user_persona_id
    WHERE us.username = ?
`);

const getAssistantPersonaForChatStmt = db.prepare(`
    SELECT p.id, p.name, p.pronouns, p.appearance, p.background, p.details, p.example_dialogues
    FROM chat_sessions cs
             JOIN personas p ON p.id = cs.assistant_persona_id
    WHERE cs.id = ?
      AND cs.username = ?
`);

const getUserPersonaForChatStmt = db.prepare(`
    SELECT p.id, p.name, p.pronouns, p.appearance, p.background, p.details, p.example_dialogues
    FROM chat_sessions cs
             JOIN personas p ON p.id = cs.user_persona_id
    WHERE cs.id = ?
      AND cs.username = ?
`);

const listMarketPersonasStmt = db.prepare(`
    SELECT id,
           persona_id,
           creator_username,
           name,
           pronouns,
           appearance,  
           background,
           details,
           example_dialogues,
           persona_type,
           usage_count,
           created_at,
           updated_at
    FROM persona_market
    ORDER BY datetime(updated_at) DESC
`);

const getMarketPersonaStmt = db.prepare(`
    SELECT id,
           persona_id,
           creator_username,
           name,
           pronouns,
           appearance,
           background,
           details,
           example_dialogues,
           persona_type,
           usage_count
    FROM persona_market
    WHERE id = ?
`);

const getMarketPersonaByPersonaIdStmt = db.prepare(`
    SELECT id,
           persona_id,
           creator_username,
           name,
           pronouns,
           appearance,
           background,
           details,
           example_dialogues,
           persona_type
    FROM persona_market
    WHERE persona_id = ?
      AND creator_username = ?
`);

const upsertMarketPersonaStmt = db.prepare(`
    INSERT INTO persona_market (persona_id, creator_username, name, pronouns, appearance, background, details,
                                example_dialogues, persona_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(persona_id, creator_username) DO UPDATE SET name         = excluded.name,
                                                            pronouns     = excluded.pronouns,
                                                            appearance   = excluded.appearance,
                                                            background   = excluded.background,
                                                            details      = excluded.details,
                                                            example_dialogues = excluded.example_dialogues,
                                                            persona_type = excluded.persona_type,
                                                            updated_at   = CURRENT_TIMESTAMP
`);

const listPublishedPersonaIdsStmt = db.prepare(`
    SELECT persona_id
    FROM persona_market
    WHERE creator_username = ?
`);

const getChatMessageCountForUserStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM chat_messages cm
             JOIN chat_sessions cs ON cs.id = cm.chat_id
    WHERE cs.username = ?
`);

const getPersonaCountForUserStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM personas
    WHERE username = ?
`);

const getPublishedPersonaCountForUserStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM persona_market
    WHERE creator_username = ?
`);

const updateLegacyChatsUsernameStmt = db.prepare(`
    UPDATE chats
    SET username = ?
    WHERE username = ?
`);

const updateChatSessionsUsernameStmt = db.prepare(`
    UPDATE chat_sessions
    SET username = ?
    WHERE username = ?
`);

const updatePersonasUsernameStmt = db.prepare(`
    UPDATE personas
    SET username = ?
    WHERE username = ?
`);

const updatePersonasSourceCreatorStmt = db.prepare(`
    UPDATE personas
    SET source_creator_username = ?
    WHERE source_creator_username = ?
`);

const updateUserSettingsUsernameStmt = db.prepare(`
    UPDATE user_settings
    SET username = ?
    WHERE username = ?
`);

const updatePersonaMarketCreatorStmt = db.prepare(`
    UPDATE persona_market
    SET creator_username = ?
    WHERE creator_username = ?
`);

const renameUserTransaction = db.transaction((currentUsername, nextUsername) => {
    updateUsernameStmt.run(nextUsername, currentUsername);
    updateLegacyChatsUsernameStmt.run(nextUsername, currentUsername);
    updateChatSessionsUsernameStmt.run(nextUsername, currentUsername);
    updatePersonasUsernameStmt.run(nextUsername, currentUsername);
    updatePersonasSourceCreatorStmt.run(nextUsername, currentUsername);
    updateUserSettingsUsernameStmt.run(nextUsername, currentUsername);
    updatePersonaMarketCreatorStmt.run(nextUsername, currentUsername);
});

const deleteMarketPersonaByPersonaIdStmt = db.prepare(`
    DELETE FROM persona_market
    WHERE persona_id = ?
      AND creator_username = ?
`);

const incrementMarketUsageCountStmt = db.prepare(`
    UPDATE persona_market
    SET usage_count = usage_count + 1
    WHERE id = ?
`);

const migrationNeeded = db.prepare(
    "SELECT COUNT(*) as count FROM chat_messages"
).get();
const legacyChatsExist = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chats'"
).get();
if (legacyChatsExist && migrationNeeded.count === 0) {
    const legacyUsers = db.prepare(
        "SELECT DISTINCT username FROM chats"
    ).all();
    legacyUsers.forEach(({username}) => {
        const sessionId = insertChatSessionStmt.run(username, "Imported chat", null, null).lastInsertRowid;
        const legacyMessages = getLegacyChatsStmt.all(username);
        legacyMessages.forEach(msg => {
            insertChatMessage(sessionId, msg.role, msg.content);
        });
    });
}

const personaColumns = db.prepare("PRAGMA table_info(personas)").all();
const hasCustomFields = personaColumns.some(column => column.name === "custom_fields");
if (!hasCustomFields) {
    db.prepare("ALTER TABLE personas ADD COLUMN custom_fields TEXT").run();
}
const hasPersonaType = personaColumns.some(column => column.name === "persona_type");
if (!hasPersonaType) {
    db.prepare("ALTER TABLE personas ADD COLUMN persona_type TEXT DEFAULT 'assistant'").run();
}
const hasSourceMarketId = personaColumns.some(column => column.name === "source_market_id");
if (!hasSourceMarketId) {
    db.prepare("ALTER TABLE personas ADD COLUMN source_market_id INTEGER").run();
}
const hasSourceCreatorUsername = personaColumns.some(column => column.name === "source_creator_username");
if (!hasSourceCreatorUsername) {
    db.prepare("ALTER TABLE personas ADD COLUMN source_creator_username TEXT").run();
}
const hasExampleDialogues = personaColumns.some(column => column.name === "example_dialogues");
if (!hasExampleDialogues) {
    db.prepare("ALTER TABLE personas ADD COLUMN example_dialogues TEXT").run();
}

const userSettingsColumns = db.prepare("PRAGMA table_info(user_settings)").all();
const hasActiveUserPersona = userSettingsColumns.some(column => column.name === "active_user_persona_id");
if (!hasActiveUserPersona) {
    db.prepare("ALTER TABLE user_settings ADD COLUMN active_user_persona_id INTEGER").run();
}

const marketColumns = db.prepare("PRAGMA table_info(persona_market)").all();
const hasPersonaIdColumn = marketColumns.some(column => column.name === "persona_id");
if (!hasPersonaIdColumn) {
    db.prepare("ALTER TABLE persona_market ADD COLUMN persona_id INTEGER").run();
}
const hasUsageCount = marketColumns.some(column => column.name === "usage_count");
if (!hasUsageCount) {
    db.prepare("ALTER TABLE persona_market ADD COLUMN usage_count INTEGER DEFAULT 0").run();
}
const hasMarketExampleDialogues = marketColumns.some(column => column.name === "example_dialogues");
if (!hasMarketExampleDialogues) {
    db.prepare("ALTER TABLE persona_market ADD COLUMN example_dialogues TEXT").run();
}
db.prepare("UPDATE persona_market SET usage_count = 0 WHERE usage_count IS NULL").run();

const chatMessageColumns = db.prepare("PRAGMA table_info(chat_messages)").all();
const hasRetryVariants = chatMessageColumns.some(column => column.name === "retry_variants");
if (!hasRetryVariants) {
    db.prepare("ALTER TABLE chat_messages ADD COLUMN retry_variants TEXT").run();
}
const hasRetryActiveIndex = chatMessageColumns.some(column => column.name === "retry_active_index");
if (!hasRetryActiveIndex) {
    db.prepare("ALTER TABLE chat_messages ADD COLUMN retry_active_index INTEGER DEFAULT 0").run();
}
const hasRetryRetriesUsed = chatMessageColumns.some(column => column.name === "retry_retries_used");
if (!hasRetryRetriesUsed) {
    db.prepare("ALTER TABLE chat_messages ADD COLUMN retry_retries_used INTEGER DEFAULT 0").run();
}
const hasRetryPromptMessageId = chatMessageColumns.some(column => column.name === "retry_prompt_message_id");
if (!hasRetryPromptMessageId) {
    db.prepare("ALTER TABLE chat_messages ADD COLUMN retry_prompt_message_id INTEGER").run();
}
db.prepare("UPDATE chat_messages SET retry_active_index = 0 WHERE retry_active_index IS NULL").run();
db.prepare("UPDATE chat_messages SET retry_retries_used = 0 WHERE retry_retries_used IS NULL").run();

const chatSessionColumns = db.prepare("PRAGMA table_info(chat_sessions)").all();
const hasAssistantPersonaLink = chatSessionColumns.some(column => column.name === "assistant_persona_id");
if (!hasAssistantPersonaLink) {
    db.prepare("ALTER TABLE chat_sessions ADD COLUMN assistant_persona_id INTEGER").run();
}
const hasChatUserPersonaLink = chatSessionColumns.some(column => column.name === "user_persona_id");
if (!hasChatUserPersonaLink) {
    db.prepare("ALTER TABLE chat_sessions ADD COLUMN user_persona_id INTEGER").run();
}
const hasScenarioPrompt = chatSessionColumns.some(column => column.name === "scenario_prompt");
if (!hasScenarioPrompt) {
    db.prepare("ALTER TABLE chat_sessions ADD COLUMN scenario_prompt TEXT").run();
}
const hasScenarioSummary = chatSessionColumns.some(column => column.name === "scenario_summary");
if (!hasScenarioSummary) {
    db.prepare("ALTER TABLE chat_sessions ADD COLUMN scenario_summary TEXT").run();
}

const FileStore = FileStoreFactory(session);
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(
    session({
        store: new FileStore({
            path: SESSIONS_DIR,
            reapInterval: 3600
        }),
        secret: "-secret-key-here-",
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    })
);

app.post("/register", async (req, res) => {
    const {username, password} = req.body;
    const existingUser = getUserStmt.get(username);

    if (existingUser) return res.status(400).json({error: "User already exists"});

    const hashed = await bcrypt.hash(password, 10);
    insertUserStmt.run(username, hashed);
    res.json({message: "Registration successful"});
});

app.post("/login", async (req, res) => {
    const {username, password} = req.body;
    const user = getUserStmt.get(username);
    if (!user) return res.status(400).json({error: "User not found"});
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(403).json({error: "Invalid password"});
    req.session.user = username;
    res.json({message: "Login successful"});
});

app.post("/logout", (req, res) => {
    req.session.destroy(() => res.json({message: "Logged out"}));
});

const requireLogin = (req, res, next) => {
    if (!req.session.user) return res.status(403).json({error: "Not logged in"});
    next();
};

app.get("/settings/profile", requireLogin, (req, res) => {
    const user = getUserStmt.get(req.session.user);
    if (!user) return res.status(404).json({error: "User not found"});
    res.json({username: user.username});
});

app.put("/settings/username", requireLogin, async (req, res) => {
    const currentUsername = req.session.user;
    const nextUsername = (req.body?.username || "").trim();
    const password = req.body?.password || "";

    if (!nextUsername) {
        return res.status(400).json({error: "New username is required"});
    }
    if (nextUsername.length < 3) {
        return res.status(400).json({error: "Username must be at least 3 characters"});
    }
    if (nextUsername === currentUsername) {
        return res.status(400).json({error: "That is already your username"});
    }

    const currentUser = getUserStmt.get(currentUsername);
    if (!currentUser) {
        return res.status(404).json({error: "User not found"});
    }
    const valid = await bcrypt.compare(password, currentUser.password);
    if (!valid) {
        return res.status(403).json({error: "Current password is incorrect"});
    }

    if (getUserStmt.get(nextUsername)) {
        return res.status(400).json({error: "Username already exists"});
    }

    renameUserTransaction(currentUsername, nextUsername);
    req.session.user = nextUsername;
    res.json({username: nextUsername});
});

app.put("/settings/password", requireLogin, async (req, res) => {
    const username = req.session.user;
    const currentPassword = req.body?.currentPassword || "";
    const nextPassword = req.body?.newPassword || "";

    if (!currentPassword || !nextPassword) {
        return res.status(400).json({error: "Current and new password are required"});
    }
    if (nextPassword.length < 6) {
        return res.status(400).json({error: "New password must be at least 6 characters"});
    }

    const user = getUserStmt.get(username);
    if (!user) {
        return res.status(404).json({error: "User not found"});
    }
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
        return res.status(403).json({error: "Current password is incorrect"});
    }

    const hashed = await bcrypt.hash(nextPassword, 10);
    updatePasswordStmt.run(hashed, username);
    res.json({message: "Password updated"});
});

const normalizePersonaField = (value) => {
    const trimmed = (value || "").trim();
    return trimmed ? trimmed : null;
};

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

const validatePersonaPayload = (payload) => {
    const sanitized = {
        name: (payload?.name || "").trim(),
        pronouns: normalizePersonaField(payload?.pronouns),
        appearance: normalizePersonaField(payload?.appearance),
        background: normalizePersonaField(payload?.background),
        details: normalizePersonaField(payload?.details),
        exampleDialogues: payload?.personaType === "assistant" ? normalizePersonaField(payload?.exampleDialogues) : null
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

    const combinedText = [
        sanitized.name,
        sanitized.pronouns,
        sanitized.appearance,
        sanitized.background,
        sanitized.details,
        sanitized.exampleDialogues
    ].filter(Boolean).join("\n");

    if (blockedPersonaPatterns.some((pattern) => pattern.test(combinedText))) {
        return {error: "This persona contains disallowed content. Remove sexual content involving minors, extreme sexual violence, or hateful/extremist material."};
    }

    return {sanitized};
};

const buildPersonaPrompt = (persona) => {
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
};

const buildUserPersonaPrompt = (persona) => {
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
};

const summarizePersona = (persona) => {
    if (!persona) return "";
    return [
        persona.name ? `Name: ${persona.name}` : null,
        persona.pronouns ? `Pronouns: ${persona.pronouns}` : null,
        persona.background ? `Background: ${persona.background}` : null,
        persona.details ? `Traits: ${persona.details}` : null
    ].filter(Boolean).join(" | ");
};

const clampText = (value, limit = 260) => {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (normalized.length <= limit) return normalized;
    return `${normalized.slice(0, limit - 3).trimEnd()}...`;
};

const normalizeOptionalText = (value) => {
    const normalized = String(value || "").trim();
    return normalized || null;
};

const buildRoleplaySceneSummary = (assistantPersona, userPersona, scenarioPrompt = "") => {
    const assistantName = assistantPersona?.name || "The assistant";
    const userName = userPersona?.name || "the user";
    const assistantHook = assistantPersona?.details || assistantPersona?.background || "stays strongly in character";
    const userHook = userPersona?.details || userPersona?.background || "enters the scene as themselves";
    const scenarioSeed = scenarioPrompt
        ? clampText(scenarioPrompt, 180)
        : `A fitting opening grows naturally from ${assistantName}'s role, goals, and manner toward ${userName}.`;
    return clampText(
        `${assistantName} leads the opening. Their approach is shaped by ${assistantHook}. ` +
        `${userName} is framed through ${userHook}. ` +
        `Scene seed: ${scenarioSeed}`,
        340
    );
};

const buildRoleplayDirectionPrompt = ({assistantPersona, userPersona, scenarioPrompt, sceneSummary}) => {
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
    if (scenarioPrompt) {
        lines.push(`USER SCENARIO SEED: ${scenarioPrompt}`);
    }
    if (assistantPersona) {
        lines.push("", `ASSISTANT SNAPSHOT: ${summarizePersona(assistantPersona)}`);
    }
    if (userPersona) {
        lines.push(`USER SNAPSHOT: ${summarizePersona(userPersona)}`);
    }
    return lines.join("\n");
};

const buildRoleplayOpenerPrompt = ({assistantPersona, userPersona, scenarioPrompt, sceneSummary}) => {
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
};

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const containsUserVoiceInRoleplayOpener = (opener, userPersona) => {
    const text = String(opener || "").trim();
    if (!text) return true;

    const userName = (userPersona?.name || "").trim();
    const nameParts = userName ? userName.split(/\s+/).filter(Boolean).slice(0, 2) : [];
    const tokens = ["user", "you", ...nameParts].filter(Boolean).map(escapeRegExp);
    if (!tokens.length) return false;

    const labelPattern = new RegExp(`(^|\\n)\\s*(?:${tokens.join("|")})\\s*:`, "i");
    if (labelPattern.test(text)) return true;

    const userActionPattern = new RegExp(
        `(^|\\n)\\s*(?:\\*\\s*)?(?:${tokens.join("|")})\\s+` +
        "(?:say|says|said|ask|asks|asked|reply|replies|replied|think|thinks|thought|feel|feels|felt|walk|walks|walked|step|steps|stepped|look|looks|looked|nod|nods|nodded|smile|smiles|smiled|enter|enters|entered|turn|turns|turned)\\b",
        "i"
    );
    if (userActionPattern.test(text)) return true;

    const quotedUserSpeechPattern = new RegExp(
        `["“][^"”\\n]{1,240}["”]\\s*(?:,?\\s*)?(?:${tokens.join("|")})\\s*(?:say|says|said|ask|asks|asked|reply|replies|replied|murmur|murmurs|murmured|whisper|whispers|whispered)\\b`,
        "i"
    );
    if (quotedUserSpeechPattern.test(text)) return true;

    const userReactionPattern = new RegExp(
        `(?:^|\\n|[.!?]\\s+)(?:${tokens.join("|")})\\s+` +
        "(?:is|was|seems|looks|feels|hesitates|freezes|flinches|nods|smiles|frowns|steps|walks|turns|glances|stares|swallows|breathes)\\b",
        "i"
    );
    return userReactionPattern.test(text);
};

const generateRoleplayOpener = async ({selectedModel = "mistral:latest", assistantPersona, userPersona, scenarioPrompt, sceneSummary}) => {
    const baseMessages = [
        {role: "system", content: buildPersonaPrompt(assistantPersona)},
        ...(userPersona ? [{role: "system", content: buildUserPersonaPrompt(userPersona)}] : []),
        {role: "system", content: buildRoleplayDirectionPrompt({assistantPersona, userPersona, scenarioPrompt, sceneSummary})},
        {role: "user", content: buildRoleplayOpenerPrompt({assistantPersona, userPersona, scenarioPrompt, sceneSummary})}
    ];

    let opener = await generateModelReply(selectedModel, baseMessages);
    if (!containsUserVoiceInRoleplayOpener(opener, userPersona)) {
        return opener;
    }

    const retryMessages = [
        ...baseMessages,
        {role: "assistant", content: opener || ""},
        {
            role: "user",
            content: "Rewrite this opening. Hard rule: only the assistant character may speak or act. Never write or imply user speech, thoughts, feelings, reactions, decisions, actions, or labels like 'User:'/'You:'. Stop before the user's reply."
        }
    ];
    opener = await generateModelReply(selectedModel, retryMessages);
    return opener;
};

const buildRetryPayload = async ({chatId, user, session, selectedModel, targetMessage}) => {
    const activePersona = getAssistantPersonaForChatStmt.get(chatId, user);
    const activeUserPersona = getUserPersonaForChatStmt.get(chatId, user) || getActiveUserPersonaStmt.get(user);
    const sceneSummary = session.scenario_summary;
    const scenarioPrompt = session.scenario_prompt;
    const promptMessage = getPreviousUserMessageStmt.get(chatId, targetMessage.id);

    if (!promptMessage) {
        if (!activePersona || !sceneSummary) {
            return {error: "No previous user prompt found for retry"};
        }
        const opener = await generateRoleplayOpener({
            selectedModel,
            assistantPersona: activePersona,
            userPersona: activeUserPersona,
            scenarioPrompt,
            sceneSummary
        });
        if (!opener || containsUserVoiceInRoleplayOpener(opener, activeUserPersona)) {
            return {error: "Failed to regenerate message"};
        }
        return {fullReply: opener, promptMessageId: null};
    }

    const conversation = getRecentChatMessagesUpToIdStmt.all(chatId, promptMessage.id).reverse();
    const messagesPayload = [];
    if (activePersona) {
        messagesPayload.push({
            role: "system",
            content: buildPersonaPrompt(activePersona)
        });
    }
    if (activeUserPersona) {
        messagesPayload.push({
            role: "system",
            content: buildUserPersonaPrompt(activeUserPersona)
        });
    }
    if (activePersona && sceneSummary) {
        messagesPayload.push({
            role: "system",
            content: buildRoleplayDirectionPrompt({
                assistantPersona: activePersona,
                userPersona: activeUserPersona,
                scenarioPrompt,
                sceneSummary
            })
        });
    }
    messagesPayload.push(
        ...conversation.map((m) => ({
            role: m.role === "bot" ? "assistant" : "user",
            content: m.content
        }))
    );

    const fullReply = await generateModelReply(selectedModel, messagesPayload);
    if (!fullReply) {
        return {error: "Failed to regenerate message"};
    }
    return {fullReply, promptMessageId: promptMessage.id};
};

const parseRetryVariants = (rawValue, content) => {
    if (!rawValue) return [content || ""];
    try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) {
            const normalized = parsed
                .map(item => String(item || "").trim())
                .filter(Boolean);
            if (normalized.length) return normalized;
        }
    } catch {
        // Ignore invalid stored retry history and fall back to current content.
    }
    return [content || ""];
};

const clampRetryActiveIndex = (index, variants) => {
    const numeric = Number(index);
    if (!Number.isInteger(numeric) || numeric < 0) return 0;
    return Math.min(numeric, Math.max(0, variants.length - 1));
};

const formatChatMessage = (row) => {
    if (!row) return null;
    const retryVariants = parseRetryVariants(row.retry_variants, row.content);
    const retryActiveIndex = clampRetryActiveIndex(row.retry_active_index, retryVariants);
    return {
        id: row.id,
        role: row.role,
        content: row.content,
        retryVariants,
        retryActiveIndex,
        retryRetriesUsed: Number(row.retry_retries_used || 0),
        retryPromptMessageId: row.retry_prompt_message_id ?? null
    };
};

const persistChatMessageRetryState = ({chatId, messageId, content, retryVariants, retryActiveIndex, retryRetriesUsed, retryPromptMessageId}) => {
    return updateChatMessageWithRetryStateStmt.run(
        content,
        JSON.stringify(retryVariants || [content || ""]),
        clampRetryActiveIndex(retryActiveIndex, retryVariants || [content || ""]),
        Number(retryRetriesUsed || 0),
        retryPromptMessageId ?? null,
        messageId,
        chatId
    );
};

const insertChatMessage = (chatId, role, content, retryState = null) => {
    const normalizedContent = String(content || "");
    const payload = retryState
        ? {
            retryVariants: Array.isArray(retryState.retryVariants) && retryState.retryVariants.length ? retryState.retryVariants : [normalizedContent],
            retryActiveIndex: retryState.retryActiveIndex ?? 0,
            retryRetriesUsed: retryState.retryRetriesUsed ?? 0,
            retryPromptMessageId: retryState.retryPromptMessageId ?? null
        }
        : null;
    return insertChatMessageStmt.run(
        chatId,
        role,
        normalizedContent,
        payload ? JSON.stringify(payload.retryVariants) : null,
        payload ? clampRetryActiveIndex(payload.retryActiveIndex, payload.retryVariants) : 0,
        payload ? Number(payload.retryRetriesUsed || 0) : 0,
        payload ? payload.retryPromptMessageId : null
    );
};

const getChatMessageByIndex = (chatId, index) => {
    const safeIndex = Number(index);
    if (!Number.isInteger(safeIndex) || safeIndex < 0) return null;
    return getChatMessageByIndexStmt.get(chatId, safeIndex) || null;
};

const createPersonaChat = (user, persona, userPersonaId = null, scenarioPrompt = null, scenarioSummary = null) => {
    const chatId = insertChatSessionStmt.run(user, persona.name, persona.id, userPersonaId, scenarioPrompt, scenarioSummary).lastInsertRowid;
    return getChatSessionStmt.get(chatId, user);
};

const getOrCreatePersonaChat = (user, persona, userPersonaId = null, scenarioPrompt = null, scenarioSummary = null) => {
    const existing = getChatSessionByParticipantsStmt.get(user, persona.id, userPersonaId, userPersonaId);
    if (existing) return existing;
    const sessionCount = countChatSessionsStmt.get(user).count;
    if (sessionCount >= 10) {
        throw new Error("CHAT_LIMIT_REACHED");
    }
    return createPersonaChat(user, persona, userPersonaId, scenarioPrompt, scenarioSummary);
};

const ensureModelState = (model) => {
    if (!modelState.has(model)) {
        modelState.set(model, {activeRequests: 0, timer: null});
    }
    return modelState.get(model);
};

const generateModelReply = async (selectedModel, messagesPayload) => {
    const state = ensureModelState(selectedModel);
    state.activeRequests++;
    try {
        const response = await fetch("https://ai.krishd.ch/api/chat", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                model: selectedModel,
                messages: messagesPayload,
                stream: true
            })
        });

        if (!response.ok) {
            throw new Error(`AI HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullReply = "";

        while (true) {
            const {value, done} = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, {stream: true});
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const data = JSON.parse(trimmed);
                if (data.message?.content) fullReply += data.message.content;
            }
        }

        if (buffer.trim()) {
            const data = JSON.parse(buffer.trim());
            if (data.message?.content) fullReply += data.message.content;
        }

        return fullReply.trim();
    } finally {
        state.activeRequests = Math.max(0, state.activeRequests - 1);
        scheduleModelUnload(selectedModel);
    }
};

app.get("/models", async (req, res) => {
    try {
        if (modelsCache && (Date.now() - modelsCacheAt) < MODELS_TTL_MS) {
            return res.json(modelsCache);
        }
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 4000);
        const response = await fetch("https://ai.krishd.ch/api/tags", {signal: controller.signal});
        clearTimeout(t);
        if (!response.ok) return res.status(500).json({error: "Failed to load models"});
        modelsCache = await response.json();
        modelsCacheAt = Date.now();
        res.json(modelsCache);
    } catch (e) {
        res.status(500).json({error: "Failed to load models"});
    }
});

app.get("/chats", requireLogin, (req, res) => {
    const user = req.session.user;
    const chats = listChatSessionsStmt.all(user);
    res.json({chats});
});

app.post("/chats", requireLogin, (req, res) => {
    const user = req.session.user;

    const assistantPersonaId = req.body?.assistantPersonaId ? Number(req.body.assistantPersonaId) : null;
    if (assistantPersonaId) {
        const persona = getPersonaStmt.get(assistantPersonaId, user);
        if (!persona || persona.persona_type !== "assistant") {
            return res.status(404).json({error: "AI Character not found"});
        }
        const existingChat = getChatSessionByParticipantsStmt.get(user, assistantPersonaId, null, null);
        try {
            const chat = getOrCreatePersonaChat(user, persona, null);
            return res.json({chat, existing: Boolean(existingChat)});
        } catch (error) {
            if (error.message === "CHAT_LIMIT_REACHED") {
                return res.status(400).json({error: "Maximum of 10 chats reached. Please delete an old chat to create a new one."});
            }
            throw error;
        }
    }

    const sessionCount = countChatSessionsStmt.get(user).count;
    if (sessionCount >= 10) {
        return res.status(400).json({error: "Maximum of 10 chats reached. Please delete an old chat to create a new one."});
    }

    const title = (req.body?.title || "New chat").trim() || "New chat";
    const chatId = insertChatSessionStmt.run(user, title, null, null, null, null).lastInsertRowid;
    const chat = getChatSessionStmt.get(chatId, user);
    res.json({chat, existing: false});
});

app.put("/chats/:id", requireLogin, (req, res) => {
    const user = req.session.user;
    const chatId = Number(req.params.id);
    const title = (req.body?.title || "").trim();
    if (!title) {
        return res.status(400).json({error: "Title is required"});
    }
    const result = updateChatSessionTitleStmt.run(title, chatId, user);
    if (result.changes === 0) {
        return res.status(404).json({error: "Chat not found"});
    }
    res.json({chat: {id: chatId, title}});
});

app.delete("/chats/:id", requireLogin, (req, res) => {
    const user = req.session.user;
    const chatId = Number(req.params.id);
    const result = deleteChatSessionStmt.run(chatId, user);
    if (result.changes === 0) {
        return res.status(404).json({error: "Chat not found"});
    }
    res.json({message: "Chat deleted"});
});

app.get("/chats/:id/messages", requireLogin, (req, res) => {
    const user = req.session.user;
    const chatId = Number(req.params.id);
    const session = getChatSessionStmt.get(chatId, user);
    if (!session) {
        return res.status(404).json({error: "Chat not found"});
    }
    const messages = getChatMessagesStmt.all(chatId).map(formatChatMessage);
    res.json({messages, chat: session});
});

app.put("/chats/:id/messages/:messageId", requireLogin, (req, res) => {
    const user = req.session.user;
    const chatId = Number(req.params.id);
    const messageId = Number(req.params.messageId);
    const content = String(req.body?.content || "").trim();
    const session = getChatSessionStmt.get(chatId, user);
    if (!session) {
        return res.status(404).json({error: "Chat not found"});
    }
    if (!content) {
        return res.status(400).json({error: "Message content is required"});
    }
    const existingMessage = formatChatMessage(getChatMessageByIdStmt.get(messageId, chatId));
    if (!existingMessage) {
        return res.status(404).json({error: "Message not found"});
    }
    const requestedRetryActiveIndex = Number(req.body?.retryActiveIndex);
    if (existingMessage.role === "bot") {
        const retryVariants = [...existingMessage.retryVariants];
        const nextActiveIndex = Number.isInteger(requestedRetryActiveIndex)
            ? clampRetryActiveIndex(requestedRetryActiveIndex, retryVariants)
            : existingMessage.retryActiveIndex;
        retryVariants[nextActiveIndex] = content;
        persistChatMessageRetryState({
            chatId,
            messageId,
            content,
            retryVariants,
            retryActiveIndex: nextActiveIndex,
            retryRetriesUsed: existingMessage.retryRetriesUsed,
            retryPromptMessageId: existingMessage.retryPromptMessageId
        });
    } else {
        updateChatMessageStmt.run(content, messageId, chatId);
    }
    touchChatSessionStmt.run(chatId, user);
    const message = formatChatMessage(getChatMessageByIdStmt.get(messageId, chatId));
    res.json({message});
});

app.put("/chats/:id/messages/by-index/:index", requireLogin, (req, res) => {
    const user = req.session.user;
    const chatId = Number(req.params.id);
    const content = String(req.body?.content || "").trim();
    const session = getChatSessionStmt.get(chatId, user);
    if (!session) {
        return res.status(404).json({error: "Chat not found"});
    }
    if (!content) {
        return res.status(400).json({error: "Message content is required"});
    }
    const target = getChatMessageByIndex(chatId, req.params.index);
    if (!target) {
        return res.status(404).json({error: "Message not found"});
    }
    const existingMessage = formatChatMessage(getChatMessageByIdStmt.get(target.id, chatId));
    if (!existingMessage) {
        return res.status(404).json({error: "Message not found"});
    }
    const requestedRetryActiveIndex = Number(req.body?.retryActiveIndex);
    if (existingMessage.role === "bot") {
        const retryVariants = [...existingMessage.retryVariants];
        const nextActiveIndex = Number.isInteger(requestedRetryActiveIndex)
            ? clampRetryActiveIndex(requestedRetryActiveIndex, retryVariants)
            : existingMessage.retryActiveIndex;
        retryVariants[nextActiveIndex] = content;
        persistChatMessageRetryState({
            chatId,
            messageId: target.id,
            content,
            retryVariants,
            retryActiveIndex: nextActiveIndex,
            retryRetriesUsed: existingMessage.retryRetriesUsed,
            retryPromptMessageId: existingMessage.retryPromptMessageId
        });
    } else {
        updateChatMessageStmt.run(content, target.id, chatId);
    }
    touchChatSessionStmt.run(chatId, user);
    const message = formatChatMessage(getChatMessageByIdStmt.get(target.id, chatId));
    res.json({message});
});

app.delete("/chats/:id/messages/:messageId", requireLogin, (req, res) => {
    const user = req.session.user;
    const chatId = Number(req.params.id);
    const messageId = Number(req.params.messageId);
    const session = getChatSessionStmt.get(chatId, user);
    if (!session) {
        return res.status(404).json({error: "Chat not found"});
    }
    const result = deleteChatMessageStmt.run(messageId, chatId);
    if (result.changes === 0) {
        return res.status(404).json({error: "Message not found"});
    }
    touchChatSessionStmt.run(chatId, user);
    res.json({message: "Message deleted"});
});

app.delete("/chats/:id/messages/by-index/:index", requireLogin, (req, res) => {
    const user = req.session.user;
    const chatId = Number(req.params.id);
    const session = getChatSessionStmt.get(chatId, user);
    if (!session) {
        return res.status(404).json({error: "Chat not found"});
    }
    const target = getChatMessageByIndex(chatId, req.params.index);
    if (!target) {
        return res.status(404).json({error: "Message not found"});
    }
    deleteChatMessageStmt.run(target.id, chatId);
    touchChatSessionStmt.run(chatId, user);
    res.json({message: "Message deleted"});
});

app.post("/chats/:id/clear", requireLogin, (req, res) => {
    const user = req.session.user;
    const chatId = Number(req.params.id);
    const session = getChatSessionStmt.get(chatId, user);
    if (!session) {
        return res.status(404).json({error: "Chat not found"});
    }
    deleteChatMessagesStmt.run(chatId);
    touchChatSessionStmt.run(chatId, user);
    res.json({message: "Chat cleared"});
});

app.get("/personas", requireLogin, (req, res) => {
    const user = req.session.user;
    const assistantPersonas = listPersonasByTypeStmt.all(user, "assistant");
    const userPersonas = listPersonasByTypeStmt.all(user, "user");
    const activePersonas = getActivePersonaIdStmt.get(user) || {};
    const publishedPersonaIds = listPublishedPersonaIdsStmt.all(user).map(row => row.persona_id);
    res.json({
        assistantPersonas,
        userPersonas,
        activeUserPersonaId: activePersonas.active_user_persona_id ?? null,
        publishedPersonaIds
    });
});

app.post("/personas", requireLogin, (req, res) => {
    const user = req.session.user;
    const personaType = (req.body?.personaType || "assistant").trim();
    if (!["assistant", "user"].includes(personaType)) {
        return res.status(400).json({error: "Invalid persona type"});
    }
    const validation = validatePersonaPayload(req.body);
    if (validation.error) {
        return res.status(400).json({error: validation.error});
    }
    const {name, pronouns, appearance, background, details, exampleDialogues} = validation.sanitized;
    const personaId = insertPersonaStmt.run(
        user,
        name,
        pronouns,
        appearance,
        background,
        details,
        exampleDialogues,
        personaType
    ).lastInsertRowid;
    const persona = getPersonaStmt.get(personaId, user);
    res.json({persona});
});

app.put("/personas/:id", requireLogin, (req, res) => {
    const user = req.session.user;
    const personaId = Number(req.params.id);
    const validation = validatePersonaPayload(req.body);
    if (validation.error) {
        return res.status(400).json({error: validation.error});
    }
    const {name, pronouns, appearance, background, details, exampleDialogues} = validation.sanitized;
    const result = updatePersonaStmt.run(
        name,
        pronouns,
        appearance,
        background,
        details,
        exampleDialogues,
        personaId,
        user
    );
    if (result.changes === 0) {
        return res.status(404).json({error: "Persona not found"});
    }
    const persona = getPersonaStmt.get(personaId, user);
    res.json({persona});
});

app.delete("/personas/:id", requireLogin, (req, res) => {
    const user = req.session.user;
    const personaId = Number(req.params.id);
    const activePersonas = getActivePersonaIdStmt.get(user) || {};
    const result = deletePersonaStmt.run(personaId, user);
    if (result.changes === 0) {
        return res.status(404).json({error: "Persona not found"});
    }
    if (activePersonas.active_user_persona_id === personaId) {
        setActiveUserPersonaStmt.run(user, null);
    }
    clearAssistantPersonaFromChatsStmt.run(user, personaId);
    clearUserPersonaFromChatsStmt.run(user, personaId);
    deleteMarketPersonaByPersonaIdStmt.run(personaId, user);
    res.json({message: "Persona deleted"});
});

app.post("/personas/:id/chat", requireLogin, (req, res) => {
    const user = req.session.user;
    const personaId = Number(req.params.id);
    const userPersonaId = req.body?.userPersonaId ? Number(req.body.userPersonaId) : null;
    const persona = getPersonaStmt.get(personaId, user);
    if (!persona || persona.persona_type !== "assistant") {
        return res.status(404).json({error: "Persona not found"});
    }
    if (userPersonaId) {
        const userPersona = getPersonaStmt.get(userPersonaId, user);
        if (!userPersona || userPersona.persona_type !== "user") {
            return res.status(404).json({error: "User persona not found"});
        }
    }
    let chat;
    try {
        chat = getOrCreatePersonaChat(user, persona, userPersonaId, null, null);
    } catch (error) {
        if (error.message === "CHAT_LIMIT_REACHED") {
            return res.status(400).json({error: "Maximum of 10 chats reached. Please delete an old chat to create a new one."});
        }
        throw error;
    }
    res.json({chat});
});

app.post("/personas/:id/equip-user", requireLogin, (req, res) => {
    const user = req.session.user;
    const personaId = Number(req.params.id);
    const persona = getPersonaStmt.get(personaId, user);
    if (!persona || persona.persona_type !== "user") {
        return res.status(404).json({error: "Persona not found"});
    }
    setActiveUserPersonaStmt.run(user, personaId);
    res.json({activeUserPersonaId: personaId});
});

app.post("/personas/user/clear", requireLogin, (req, res) => {
    const user = req.session.user;
    setActiveUserPersonaStmt.run(user, null);
    res.json({activeUserPersonaId: null});
});

app.get("/personas/market", requireLogin, (req, res) => {
    const personas = listMarketPersonasStmt.all();
    res.json({personas});
});

app.get("/dashboard/summary", requireLogin, (req, res) => {
    const user = req.session.user;
    const chats = countChatSessionsStmt.get(user).count;
    const messages = getChatMessageCountForUserStmt.get(user).count;
    const personas = getPersonaCountForUserStmt.get(user).count;
    const published = getPublishedPersonaCountForUserStmt.get(user).count;
    const marketPersonas = listMarketPersonasStmt.all().length;

    res.json({
        username: user,
        stats: {
            chats,
            messages,
            personas,
            published,
            marketPersonas
        }
    });
});

app.post("/personas/:id/publish", requireLogin, (req, res) => {
    const user = req.session.user;
    const personaId = Number(req.params.id);
    const persona = getPersonaForPublishStmt.get(personaId, user);
    if (!persona) {
        return res.status(404).json({error: "Persona not found"});
    }
    if (persona.source_market_id) {
        return res.status(403).json({error: "Collected personas cannot be published."});
    }
    upsertMarketPersonaStmt.run(
        personaId,
        user,
        persona.name,
        persona.pronouns,
        persona.appearance,
        persona.background,
        persona.details,
        persona.example_dialogues,
        persona.persona_type
    );
    const marketPersona = getMarketPersonaByPersonaIdStmt.get(personaId, user);
    res.json({persona: marketPersona});
});

app.post("/personas/:id/unpublish", requireLogin, (req, res) => {
    const user = req.session.user;
    const personaId = Number(req.params.id);
    const persona = getPersonaForPublishStmt.get(personaId, user);
    if (!persona) {
        return res.status(404).json({error: "Persona not found"});
    }
    if (persona.source_market_id) {
        return res.status(403).json({error: "Collected personas cannot be unpublished."});
    }
    const result = deleteMarketPersonaByPersonaIdStmt.run(personaId, user);
    if (result.changes === 0) {
        return res.status(404).json({error: "Persona is not published."});
    }
    res.json({message: "Persona unpublished"});
});

app.post("/personas/market/:id/collect", requireLogin, (req, res) => {
    const user = req.session.user;
    const marketId = Number(req.params.id);
    const marketPersona = getMarketPersonaStmt.get(marketId);
    if (!marketPersona) {
        return res.status(404).json({error: "Market persona not found"});
    }
    if (marketPersona.creator_username === user) {
        return res.status(400).json({error: "You already own this persona."});
    }
    const existingPersona = getPersonaBySourceMarketStmt.get(user, marketId);
    if (existingPersona) {
        return res.status(400).json({error: "You already collected this persona."});
    }
    const personaId = insertMarketPersonaStmt.run(
        user,
        marketPersona.name,
        marketPersona.pronouns,
        marketPersona.appearance,
        marketPersona.background,
        marketPersona.details,
        marketPersona.example_dialogues,
        marketPersona.persona_type,
        marketId,
        marketPersona.creator_username
    ).lastInsertRowid;
    incrementMarketUsageCountStmt.run(marketId);
    let activeUserPersonaId = null;
    if (req.body?.equip) {
        if (marketPersona.persona_type === "user") {
            setActiveUserPersonaStmt.run(user, personaId);
            activeUserPersonaId = personaId;
        }
    }
    const persona = getPersonaStmt.get(personaId, user);
    res.json({persona, activeUserPersonaId});
});

app.post("/personas/market/:id/chat", requireLogin, async (req, res) => {
    const user = req.session.user;
    const marketId = Number(req.params.id);
    const userPersonaId = req.body?.userPersonaId ? Number(req.body.userPersonaId) : null;
    const marketPersona = getMarketPersonaStmt.get(marketId);
    if (!marketPersona || marketPersona.persona_type !== "assistant") {
        return res.status(404).json({error: "Market AI Character not found"});
    }
    let userPersona = null;
    if (userPersonaId) {
        userPersona = getPersonaStmt.get(userPersonaId, user);
        if (!userPersona || userPersona.persona_type !== "user") {
            return res.status(404).json({error: "User persona not found"});
        }
    }

    let personaId = null;
    const existingPersona = getPersonaBySourceMarketStmt.get(user, marketId);
    if (existingPersona) {
        personaId = existingPersona.id;
    } else {
        personaId = insertMarketPersonaStmt.run(
            user,
            marketPersona.name,
            marketPersona.pronouns,
            marketPersona.appearance,
            marketPersona.background,
            marketPersona.details,
            marketPersona.example_dialogues,
            marketPersona.persona_type,
            marketId,
            marketPersona.creator_username
        ).lastInsertRowid;
        incrementMarketUsageCountStmt.run(marketId);
    }

    const persona = getPersonaStmt.get(personaId, user);
    const scenarioPrompt = normalizeOptionalText(req.body?.scenarioPrompt);
    const sceneSummary = buildRoleplaySceneSummary(persona, userPersona, scenarioPrompt);
    let chat;
    try {
        chat = getOrCreatePersonaChat(user, persona, userPersonaId, scenarioPrompt, sceneSummary);
    } catch (error) {
        if (error.message === "CHAT_LIMIT_REACHED") {
            return res.status(400).json({error: "Maximum of 10 chats reached. Please delete an old chat to create a new one."});
        }
        throw error;
    }
    const existingMessages = getChatMessagesStmt.all(chat.id);
    if (existingMessages.length > 0) {
        return res.json({persona, chat, existing: true, generatedInitialMessage: false});
    }
    updateChatSessionSceneStmt.run(scenarioPrompt, sceneSummary, chat.id, user);
    chat = getChatSessionStmt.get(chat.id, user);
    try {
        const opener = await generateRoleplayOpener({
            selectedModel: "mistral:latest",
            assistantPersona: persona,
            userPersona,
            scenarioPrompt,
            sceneSummary
        });
        if (!opener || containsUserVoiceInRoleplayOpener(opener, userPersona)) {
            return res.json({persona, chat, existing: false, generatedInitialMessage: false});
        }
        insertChatMessage(chat.id, "bot", opener, {
            retryVariants: [opener],
            retryActiveIndex: 0,
            retryRetriesUsed: 0,
            retryPromptMessageId: null
        });
        touchChatSessionStmt.run(chat.id, user);
        return res.json({persona, chat: getChatSessionStmt.get(chat.id, user), existing: false, generatedInitialMessage: true, opener});
    } catch {
        return res.json({persona, chat, existing: false, generatedInitialMessage: false});
    }
});

app.post("/roleplays/start", requireLogin, async (req, res) => {
    const user = req.session.user;
    const selectedModel = req.body?.model || "mistral:latest";
    const assistantPersonaId = Number(req.body?.assistantPersonaId);
    const userPersonaId = req.body?.userPersonaId ? Number(req.body.userPersonaId) : null;
    const scenarioPrompt = normalizeOptionalText(req.body?.scenarioPrompt);

    if (!assistantPersonaId) {
        return res.status(400).json({error: "assistantPersonaId is required"});
    }

    const assistantPersona = getPersonaStmt.get(assistantPersonaId, user);
    if (!assistantPersona || assistantPersona.persona_type !== "assistant") {
        return res.status(404).json({error: "Character not found"});
    }

    let userPersona = null;
    if (userPersonaId) {
        userPersona = getPersonaStmt.get(userPersonaId, user);
        if (!userPersona || userPersona.persona_type !== "user") {
            return res.status(404).json({error: "User persona not found"});
        }
    }

    let chat;
    const sceneSummary = buildRoleplaySceneSummary(assistantPersona, userPersona, scenarioPrompt);
    try {
        chat = getOrCreatePersonaChat(user, assistantPersona, userPersonaId, scenarioPrompt, sceneSummary);
    } catch (error) {
        if (error.message === "CHAT_LIMIT_REACHED") {
            return res.status(400).json({error: "Maximum of 10 chats reached. Please delete an old chat to create a new one."});
        }
        throw error;
    }

    const existingMessages = getChatMessagesStmt.all(chat.id);
    if (existingMessages.length > 0) {
        return res.json({chat, existing: true, generatedInitialMessage: false});
    }
    updateChatSessionSceneStmt.run(scenarioPrompt, sceneSummary, chat.id, user);
    chat = getChatSessionStmt.get(chat.id, user);

    try {
        const opener = await generateRoleplayOpener({
            selectedModel,
            assistantPersona,
            userPersona,
            scenarioPrompt,
            sceneSummary
        });
        if (!opener || containsUserVoiceInRoleplayOpener(opener, userPersona)) {
            return res.status(500).json({error: "Failed to generate the character opener"});
        }
        insertChatMessage(chat.id, "bot", opener, {
            retryVariants: [opener],
            retryActiveIndex: 0,
            retryRetriesUsed: 0,
            retryPromptMessageId: null
        });
        touchChatSessionStmt.run(chat.id, user);
        return res.json({chat: getChatSessionStmt.get(chat.id, user), existing: false, generatedInitialMessage: true, opener});
    } catch {
        return res.status(500).json({error: "Failed to generate the character opener"});
    }
});

app.post("/chat", requireLogin, async (req, res) => {
    const user = req.session.user;
    const {message, model, chatId} = req.body;
    const selectedModel = model || "mistral:latest";
    const targetChatId = Number(chatId);

    if (!targetChatId) {
        return res.status(400).json({error: "chatId is required"});
    }

    const session = getChatSessionStmt.get(targetChatId, user);
    if (!session) {
        return res.status(404).json({error: "Chat not found"});
    }

    try {
        const activePersona = getAssistantPersonaForChatStmt.get(targetChatId, user);
        const activeUserPersona = getUserPersonaForChatStmt.get(targetChatId, user) || getActiveUserPersonaStmt.get(user);
        const sceneSummary = session.scenario_summary;
        const scenarioPrompt = session.scenario_prompt;
        const history = getRecentChatMessagesStmt.all(targetChatId);
        const conversation = [...history].reverse();
        conversation.push({role: "user", content: message});
        insertChatMessage(targetChatId, "user", message);
        touchChatSessionStmt.run(targetChatId, user);
        const messagesPayload = [];
        if (activePersona) {
            messagesPayload.push({
                role: "system",
                content: buildPersonaPrompt(activePersona)
            });
        }
        if (activeUserPersona) {
            messagesPayload.push({
                role: "system",
                content: buildUserPersonaPrompt(activeUserPersona)
            });
        }
        if (activePersona && sceneSummary) {
            messagesPayload.push({
                role: "system",
                content: buildRoleplayDirectionPrompt({
                    assistantPersona: activePersona,
                    userPersona: activeUserPersona,
                    scenarioPrompt,
                    sceneSummary
                })
            });
        }
        messagesPayload.push(
            ...conversation.map(m => ({
                role: m.role === "bot" ? "assistant" : "user",
                content: m.content
            }))
        );
        const fullReply = await generateModelReply(selectedModel, messagesPayload);
        insertChatMessage(targetChatId, "bot", fullReply, {
            retryVariants: [fullReply],
            retryActiveIndex: 0,
            retryRetriesUsed: 0,
            retryPromptMessageId: null
        });
        touchChatSessionStmt.run(targetChatId, user);
        console.log("Reply length:", fullReply.length);
        res.json({reply: fullReply});
    } catch (err) {
        console.error("AI chat error:", err);
        res.status(500).json({error: "AI request failed"});
    }
});

app.post("/chats/:id/messages/:messageId/retry", requireLogin, async (req, res) => {
    const user = req.session.user;
    const chatId = Number(req.params.id);
    const messageId = Number(req.params.messageId);
    const selectedModel = req.body?.model || "mistral:latest";
    const session = getChatSessionStmt.get(chatId, user);
    if (!session) {
        return res.status(404).json({error: "Chat not found"});
    }

    const targetMessage = getChatMessageByIdStmt.get(messageId, chatId);
    if (!targetMessage) {
        return res.status(404).json({error: "Message not found"});
    }
    const latestMessage = getLatestChatMessageStmt.get(chatId);
    if (!latestMessage || latestMessage.id !== messageId || latestMessage.role !== "bot") {
        return res.status(400).json({error: "Only the newest assistant message can be retried"});
    }
    try {
        const retryResult = await buildRetryPayload({chatId, user, session, selectedModel, targetMessage});
        if (retryResult.error) {
            return res.status(400).json({error: retryResult.error});
        }
        const {fullReply, promptMessageId} = retryResult;
        const existingMessage = formatChatMessage(targetMessage);
        const retryVariants = [...existingMessage.retryVariants, fullReply];
        const retryActiveIndex = retryVariants.length - 1;
        const retryRetriesUsed = existingMessage.retryRetriesUsed + 1;
        persistChatMessageRetryState({
            chatId,
            messageId,
            content: fullReply,
            retryVariants,
            retryActiveIndex,
            retryRetriesUsed,
            retryPromptMessageId: promptMessageId
        });
        touchChatSessionStmt.run(chatId, user);
        return res.json({message: formatChatMessage(getChatMessageByIdStmt.get(messageId, chatId)), promptMessageId});
    } catch (err) {
        console.error("Retry error:", err);
        return res.status(500).json({error: "Failed to regenerate message"});
    }
});

app.post("/chats/:id/messages/by-index/:index/retry", requireLogin, async (req, res) => {
    const user = req.session.user;
    const chatId = Number(req.params.id);
    const selectedModel = req.body?.model || "mistral:latest";
    const session = getChatSessionStmt.get(chatId, user);
    if (!session) {
        return res.status(404).json({error: "Chat not found"});
    }

    const targetMessage = getChatMessageByIndex(chatId, req.params.index);
    if (!targetMessage) {
        return res.status(404).json({error: "Message not found"});
    }
    const latestMessage = getLatestChatMessageStmt.get(chatId);
    if (!latestMessage || latestMessage.id !== targetMessage.id || latestMessage.role !== "bot") {
        return res.status(400).json({error: "Only the newest assistant message can be retried"});
    }
    try {
        const retryResult = await buildRetryPayload({chatId, user, session, selectedModel, targetMessage});
        if (retryResult.error) {
            return res.status(400).json({error: retryResult.error});
        }
        const {fullReply, promptMessageId} = retryResult;
        const existingMessage = formatChatMessage(targetMessage);
        const retryVariants = [...existingMessage.retryVariants, fullReply];
        const retryActiveIndex = retryVariants.length - 1;
        const retryRetriesUsed = existingMessage.retryRetriesUsed + 1;
        persistChatMessageRetryState({
            chatId,
            messageId: targetMessage.id,
            content: fullReply,
            retryVariants,
            retryActiveIndex,
            retryRetriesUsed,
            retryPromptMessageId: promptMessageId
        });
        touchChatSessionStmt.run(chatId, user);
        return res.json({message: formatChatMessage(getChatMessageByIdStmt.get(targetMessage.id, chatId)), promptMessageId});
    } catch (err) {
        console.error("Retry error:", err);
        return res.status(500).json({error: "Failed to regenerate message"});
    }
});

app.get("/session", (req, res) => {
    if (req.session.user) res.json({user: req.session.user});
    else res.json({user: null});
});

app.get("/chat/history", requireLogin, (req, res) => {
    const user = req.session.user;
    const chats = listChatSessionsStmt.all(user);
    res.json({history: chats});
});

app.get("/market", (req, res) => {
    res.sendFile(path.resolve("public/market.html"));
});

app.get("/settings", (req, res) => {
    res.sendFile(path.resolve("public/settings.html"));
});

app.get("/", (req, res) => {
    res.sendFile(path.resolve("public/index.html"));
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
