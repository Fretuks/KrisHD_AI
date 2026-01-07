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

const requireLogin = (req, res, next) => {
    if (!req.session.user) return res.status(403).json({error: "Not logged in"});
    next();
};

app.get("/models", async (req, res) => {
    const response = await fetch("https://ai.krishd.ch/api/tags");
    res.json(await response.json());
});

app.get("/chats", requireLogin, (req, res) => {
    const user = req.session.user;
    const chats = listChatSessionsStmt.all(user);
    res.json({chats});
});

app.post("/chats", requireLogin, (req, res) => {
    const user = req.session.user;
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
        const history = getRecentChatMessagesStmt.all(targetChatId);
        const conversation = [...history].reverse();
        conversation.push({role: "user", content: message});
        insertChatMessageStmt.run(targetChatId, "user", message);
        touchChatSessionStmt.run(targetChatId, user);
        const messagesPayload = conversation.map(m => ({
            role: m.role === "bot" ? "assistant" : "user",
            content: m.content
        }));

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
