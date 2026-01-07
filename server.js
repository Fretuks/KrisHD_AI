import express from "express";
import session from "express-session";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import bodyParser from "body-parser";
import Database from "better-sqlite3";
import FileStoreFactory from "session-file-store";
import {exec} from "child_process";

const modelState = new Map();
const app = express();
const PORT = 3000;
const DB_PATH = "./data/app.db";
const UNLOAD_AFTER_MS = 30 * 1000;

if (!fs.existsSync("./data")) {
    fs.mkdirSync("./data", {recursive: true});
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
                console.log(`✅ Model unloaded: ${model}`);
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
        custom_fields
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
        FOREIGN
        KEY
    (
        active_persona_id
    ) REFERENCES personas
    (
        id
    ) ON DELETE SET NULL
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
const deleteLegacyChatsStmt = db.prepare("DELETE FROM chats WHERE username = ?");
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

const deleteAllChatSessionsStmt = db.prepare(
    "DELETE FROM chat_sessions WHERE username = ?"
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
                    ORDER BY datetime(created_at) DESC LIMIT 20
        `
    )
;

const deleteChatMessagesStmt = db.prepare(
    "DELETE FROM chat_messages WHERE chat_id = ?"
);

const listPersonasStmt = db.prepare(`
    SELECT id, name, pronouns, appearance, background, details, custom_fields, created_at, updated_at
    FROM personas
    WHERE username = ?
    ORDER BY datetime(updated_at) DESC
`);

const getPersonaStmt = db.prepare(`
    SELECT id, name, pronouns, appearance, background, details, custom_fields
    FROM personas
    WHERE id = ? AND username = ?
`);

const insertPersonaStmt = db.prepare(
    "INSERT INTO personas (username, name, pronouns, appearance, background, details, custom_fields) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

const updatePersonaStmt = db.prepare(`
    UPDATE personas
    SET name = ?, pronouns = ?, appearance = ?, background = ?, details = ?, custom_fields = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND username = ?
`);

const deletePersonaStmt = db.prepare(
    "DELETE FROM personas WHERE id = ? AND username = ?"
);

const getActivePersonaIdStmt = db.prepare(
    "SELECT active_persona_id FROM user_settings WHERE username = ?"
);

const setActivePersonaStmt = db.prepare(`
    INSERT INTO user_settings (username, active_persona_id)
    VALUES (?, ?)
    ON CONFLICT(username) DO UPDATE SET active_persona_id = excluded.active_persona_id
`);

const getActivePersonaStmt = db.prepare(`
    SELECT p.id, p.name, p.pronouns, p.appearance, p.background, p.details, p.custom_fields
    FROM user_settings us
    JOIN personas p ON p.id = us.active_persona_id
    WHERE us.username = ?
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

const FileStore = FileStoreFactory(session);
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(
    session({
        store: new FileStore({path: "./sessions"}),
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

const normalizeCustomFields = (fields) => {
    if (!Array.isArray(fields)) return null;
    const cleaned = fields
        .map(field => ({
            label: (field?.label || "").trim(),
            value: (field?.value || "").trim()
        }))
        .filter(field => field.label || field.value);
    return cleaned.length ? JSON.stringify(cleaned) : null;
};

const parseCustomFields = (value) => {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
};

const buildPersonaPrompt = (persona) => {
    const lines = [
        "You are roleplaying with the following persona. Stay in character, be engaging, and align with these details."
    ];
    if (persona.name) lines.push(`Name: ${persona.name}`);
    if (persona.pronouns) lines.push(`Pronouns: ${persona.pronouns}`);
    if (persona.appearance) lines.push(`Appearance: ${persona.appearance}`);
    if (persona.background) lines.push(`Background: ${persona.background}`);
    if (persona.details) lines.push(`Details: ${persona.details}`);
    const customFields = parseCustomFields(persona.custom_fields);
    customFields.forEach(field => {
        lines.push(`${field.label || "Custom"}: ${field.value}`);
    });
    return lines.join("\n");
};

const requireLogin = (req, res, next) => {
    if (!req.session.user) return res.status(403).json({error: "Not logged in"});
    next();
};

app.get("/models", async (req, res) => {
    try {
        const response = await fetch("https://ai.krishd.ch/api/tags");
        if (!response.ok) {
            return res.status(500).json({error: "Failed to load models"});
        }
        res.json(await response.json());
    } catch (error) {
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
    const personas = listPersonasStmt.all(user).map(persona => ({
        ...persona,
        customFields: parseCustomFields(persona.custom_fields)
    }));
    const activePersonaId = getActivePersonaIdStmt.get(user)?.active_persona_id ?? null;
    res.json({personas, activePersonaId});
});

app.post("/personas", requireLogin, (req, res) => {
    const user = req.session.user;
    const name = (req.body?.name || "").trim();
    if (!name) {
        return res.status(400).json({error: "Name is required"});
    }
    const pronouns = normalizePersonaField(req.body?.pronouns);
    const appearance = normalizePersonaField(req.body?.appearance);
    const background = normalizePersonaField(req.body?.background);
    const details = normalizePersonaField(req.body?.details);
    const customFields = normalizeCustomFields(req.body?.customFields);
    const personaId = insertPersonaStmt.run(
        user,
        name,
        pronouns,
        appearance,
        background,
        details,
        customFields
    ).lastInsertRowid;
    const persona = getPersonaStmt.get(personaId, user);
    res.json({
        persona: {
            ...persona,
            customFields: parseCustomFields(persona.custom_fields)
        }
    });
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
    const customFields = normalizeCustomFields(req.body?.customFields);
    const result = updatePersonaStmt.run(
        name,
        pronouns,
        appearance,
        background,
        details,
        customFields,
        personaId,
        user
    );
    if (result.changes === 0) {
        return res.status(404).json({error: "Persona not found"});
    }
    const persona = getPersonaStmt.get(personaId, user);
    res.json({
        persona: {
            ...persona,
            customFields: parseCustomFields(persona.custom_fields)
        }
    });
});

app.delete("/personas/:id", requireLogin, (req, res) => {
    const user = req.session.user;
    const personaId = Number(req.params.id);
    const activePersonaId = getActivePersonaIdStmt.get(user)?.active_persona_id ?? null;
    const result = deletePersonaStmt.run(personaId, user);
    if (result.changes === 0) {
        return res.status(404).json({error: "Persona not found"});
    }
    if (activePersonaId === personaId) {
        setActivePersonaStmt.run(user, null);
    }
    res.json({message: "Persona deleted"});
});

app.post("/personas/:id/equip", requireLogin, (req, res) => {
    const user = req.session.user;
    const personaId = Number(req.params.id);
    const persona = getPersonaStmt.get(personaId, user);
    if (!persona) {
        return res.status(404).json({error: "Persona not found"});
    }
    setActivePersonaStmt.run(user, personaId);
    res.json({activePersonaId: personaId});
});

app.post("/personas/clear", requireLogin, (req, res) => {
    const user = req.session.user;
    setActivePersonaStmt.run(user, null);
    res.json({activePersonaId: null});
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
