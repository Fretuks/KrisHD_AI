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
const getLegacyChatsStmt = db.prepare(`
    SELECT role, content
    FROM chats
    WHERE username = ?
    ORDER BY datetime(created_at)
`);
const insertChatSessionStmt = db.prepare(
    "INSERT INTO chat_sessions (username, title) VALUES (?, ?)"
);
const listChatSessionsStmt = db.prepare(`
    SELECT id, title, created_at, updated_at
    FROM chat_sessions
    WHERE username = ?
    ORDER BY datetime(updated_at) DESC
`);

const countChatSessionsStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM chat_sessions
    WHERE username = ?
`);

const getChatSessionStmt = db.prepare(
    "SELECT id, title FROM chat_sessions WHERE id = ? AND username = ?"
);

const updateChatSessionTitleStmt = db.prepare(
    "UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?"
);

const touchChatSessionStmt = db.prepare(
    "UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND username = ?"
);

const deleteChatSessionStmt = db.prepare(
    "DELETE FROM chat_sessions WHERE id = ? AND username = ?"
);

const insertChatMessageStmt = db.prepare(
    "INSERT INTO chat_messages (chat_id, role, content) VALUES (?, ?, ?)"
);

const getChatMessagesStmt = db.prepare(`
                    SELECT role, content
                    FROM chat_messages
                    WHERE chat_id = ?
                    ORDER BY datetime(created_at)
        `
    )
;
const getRecentChatMessagesStmt = db.prepare(`
                    SELECT role, content
                    FROM chat_messages
                    WHERE chat_id = ?
                    ORDER BY datetime(created_at) DESC
                    LIMIT 20
        `
    )
;

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
    SELECT id, name, pronouns, appearance, background, details, persona_type
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
           persona_type,
           source_market_id,
           source_creator_username
    FROM personas
    WHERE id = ?
      AND username = ?
`);

const insertPersonaStmt = db.prepare(
    "INSERT INTO personas (username, name, pronouns, appearance, background, details, persona_type) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

const insertMarketPersonaStmt = db.prepare(
    "INSERT INTO personas (username, name, pronouns, appearance, background, details, persona_type, source_market_id, source_creator_username) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
    SELECT p.id, p.name, p.pronouns, p.appearance, p.background, p.details
    FROM user_settings us
             JOIN personas p ON p.id = us.active_persona_id
    WHERE us.username = ?
`);

const getActiveUserPersonaStmt = db.prepare(`
    SELECT p.id, p.name, p.pronouns, p.appearance, p.background, p.details
    FROM user_settings us
             JOIN personas p ON p.id = us.active_user_persona_id
    WHERE us.username = ?
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
           persona_type
    FROM persona_market
    WHERE persona_id = ?
      AND creator_username = ?
`);

const upsertMarketPersonaStmt = db.prepare(`
    INSERT INTO persona_market (persona_id, creator_username, name, pronouns, appearance, background, details,
                                persona_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(persona_id, creator_username) DO UPDATE SET name         = excluded.name,
                                                            pronouns     = excluded.pronouns,
                                                            appearance   = excluded.appearance,
                                                            background   = excluded.background,
                                                            details      = excluded.details,
                                                            persona_type = excluded.persona_type,
                                                            updated_at   = CURRENT_TIMESTAMP
`);

const listPublishedPersonaIdsStmt = db.prepare(`
    SELECT persona_id
    FROM persona_market
    WHERE creator_username = ?
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
        const sessionId = insertChatSessionStmt.run(username, "Imported chat").lastInsertRowid;
        const legacyMessages = getLegacyChatsStmt.all(username);
        legacyMessages.forEach(msg => {
            insertChatMessageStmt.run(sessionId, msg.role, msg.content);
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
db.prepare("UPDATE persona_market SET usage_count = 0 WHERE usage_count IS NULL").run();

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

const normalizePersonaField = (value) => {
    const trimmed = (value || "").trim();
    return trimmed ? trimmed : null;
};

const buildPersonaPrompt = (persona) => {
    const lines = [
        "You are roleplaying as the following persona. Stay in character, be engaging, and align with these details."
    ];
    if (persona.name) lines.push(`Name: ${persona.name}`);
    if (persona.pronouns) lines.push(`Pronouns: ${persona.pronouns}`);
    if (persona.appearance) lines.push(`Appearance: ${persona.appearance}`);
    if (persona.background) lines.push(`Background: ${persona.background}`);
    if (persona.details) lines.push(`Details: ${persona.details}`);
    return lines.join("\n");
};

const buildUserPersonaPrompt = (persona) => {
    const lines = [
        "The user is roleplaying as the following persona. Keep this context in mind when responding."
    ];
    if (persona.name) lines.push(`Name: ${persona.name}`);
    if (persona.pronouns) lines.push(`Pronouns: ${persona.pronouns}`);
    if (persona.appearance) lines.push(`Appearance: ${persona.appearance}`);
    if (persona.background) lines.push(`Background: ${persona.background}`);
    if (persona.details) lines.push(`Details: ${persona.details}`);
    return lines.join("\n");
};

const requireLogin = (req, res, next) => {
    if (!req.session.user) return res.status(403).json({error: "Not logged in"});
    next();
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

    const sessionCount = countChatSessionsStmt.get(user).count;
    if (sessionCount >= 10) {
        return res.status(400).json({error: "Maximum of 10 chats reached. Please delete an old chat to create a new one."});
    }

    const title = (req.body?.title || "New chat").trim() || "New chat";
    const chatId = insertChatSessionStmt.run(user, title).lastInsertRowid;
    res.json({chat: {id: chatId, title}});
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
    const messages = getChatMessagesStmt.all(chatId);
    res.json({messages});
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
        activePersonaId: activePersonas.active_persona_id ?? null,
        activeUserPersonaId: activePersonas.active_user_persona_id ?? null,
        publishedPersonaIds
    });
});

app.post("/personas", requireLogin, (req, res) => {
    const user = req.session.user;
    const name = (req.body?.name || "").trim();
    if (!name) {
        return res.status(400).json({error: "Name is required"});
    }
    const personaType = (req.body?.personaType || "assistant").trim();
    if (!["assistant", "user"].includes(personaType)) {
        return res.status(400).json({error: "Invalid persona type"});
    }
    const pronouns = normalizePersonaField(req.body?.pronouns);
    const appearance = normalizePersonaField(req.body?.appearance);
    const background = normalizePersonaField(req.body?.background);
    const details = normalizePersonaField(req.body?.details);
    const personaId = insertPersonaStmt.run(
        user,
        name,
        pronouns,
        appearance,
        background,
        details,
        personaType
    ).lastInsertRowid;
    const persona = getPersonaStmt.get(personaId, user);
    res.json({persona});
});

app.put("/personas/:id", requireLogin, (req, res) => {
    const user = req.session.user;
    const personaId = Number(req.params.id);
    const name = (req.body?.name || "").trim();
    if (!name) {
        return res.status(400).json({error: "Name is required"});
    }
    const pronouns = normalizePersonaField(req.body?.pronouns);
    const appearance = normalizePersonaField(req.body?.appearance);
    const background = normalizePersonaField(req.body?.background);
    const details = normalizePersonaField(req.body?.details);
    const result = updatePersonaStmt.run(
        name,
        pronouns,
        appearance,
        background,
        details,
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
    if (activePersonas.active_persona_id === personaId) {
        setActivePersonaStmt.run(user, null);
    }
    if (activePersonas.active_user_persona_id === personaId) {
        setActiveUserPersonaStmt.run(user, null);
    }
    res.json({message: "Persona deleted"});
});

app.post("/personas/:id/equip", requireLogin, (req, res) => {
    const user = req.session.user;
    const personaId = Number(req.params.id);
    const persona = getPersonaStmt.get(personaId, user);
    if (!persona || persona.persona_type !== "assistant") {
        return res.status(404).json({error: "Persona not found"});
    }
    setActivePersonaStmt.run(user, personaId);
    res.json({activePersonaId: personaId});
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

app.post("/personas/clear", requireLogin, (req, res) => {
    const user = req.session.user;
    setActivePersonaStmt.run(user, null);
    res.json({activePersonaId: null});
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
        persona.persona_type
    );
    const marketPersona = getMarketPersonaByPersonaIdStmt.get(personaId, user);
    res.json({persona: marketPersona});
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
        marketPersona.persona_type,
        marketId,
        marketPersona.creator_username
    ).lastInsertRowid;
    incrementMarketUsageCountStmt.run(marketId);
    let activePersonaId = null;
    let activeUserPersonaId = null;
    if (req.body?.equip) {
        if (marketPersona.persona_type === "user") {
            setActiveUserPersonaStmt.run(user, personaId);
            activeUserPersonaId = personaId;
        } else {
            setActivePersonaStmt.run(user, personaId);
            activePersonaId = personaId;
        }
    }
    const persona = getPersonaStmt.get(personaId, user);
    res.json({persona, activePersonaId, activeUserPersonaId});
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

    if (!modelState.has(selectedModel)) {
        modelState.set(selectedModel, {activeRequests: 0, timer: null});
    }
    const state = modelState.get(selectedModel);
    state.activeRequests++;

    try {
        const activePersona = getActivePersonaStmt.get(user);
        const activeUserPersona = getActiveUserPersonaStmt.get(user);
        const history = getRecentChatMessagesStmt.all(targetChatId);
        const conversation = [...history].reverse();
        conversation.push({role: "user", content: message});
        insertChatMessageStmt.run(targetChatId, "user", message);
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
        messagesPayload.push(
            ...conversation.map(m => ({
                role: m.role === "bot" ? "assistant" : "user",
                content: m.content
            }))
        );

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
            let lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                const json = JSON.parse(line);
                if (json.done) {
                    break;
                }
                if (json.message?.content) {
                    fullReply += json.message.content;
                }
            }
        }
        insertChatMessageStmt.run(targetChatId, "bot", fullReply);
        touchChatSessionStmt.run(targetChatId, user);
        console.log("Reply length:", fullReply.length);
        res.json({reply: fullReply});
    } catch (err) {
        console.error("AI chat error:", err);
        res.status(500).json({error: "AI request failed"});
    } finally {
        state.activeRequests--;

        if (state.activeRequests === 0) {
            scheduleModelUnload(selectedModel);
        }
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

app.get("/", (req, res) => {
    res.sendFile(path.resolve("public/index.html"));
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
