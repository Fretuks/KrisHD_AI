import express from "express";
import session from "express-session";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import bodyParser from "body-parser";
import Database from "better-sqlite3";
import FileStoreFactory from "session-file-store";
import { exec } from "child_process";

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
        modelState.set(model, { timer: null, activeRequests: 0 });
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
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL
    )
`).run();
db.prepare(`
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`).run();

const insertUserStmt = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
const getUserStmt = db.prepare("SELECT username, password FROM users WHERE username = ?");
const insertChatStmt = db.prepare("INSERT INTO chats (username, role, content) VALUES (?, ?, ?)");
const getChatsStmt = db.prepare(`
    SELECT role, content FROM chats
    WHERE username = ?
    ORDER BY datetime(created_at)
`);
const getRecentChatsStmt = db.prepare(`
    SELECT role, content FROM chats
    WHERE username = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 20
`);
const deleteChatsStmt = db.prepare("DELETE FROM chats WHERE username = ?");

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

app.post("/chat", requireLogin, async (req, res) => {
    const user = req.session.user;
    const { message, model } = req.body;
    const selectedModel = model || "mistral:latest";

    if (!modelState.has(selectedModel)) {
        modelState.set(selectedModel, { activeRequests: 0, timer: null });
    }
    const state = modelState.get(selectedModel);
    state.activeRequests++;

    try {
        const history = getRecentChatsStmt.all(user);
        const conversation = [...history].reverse();
        conversation.push({ role: "user", content: message });

        insertChatStmt.run(user, "user", message);

        const messagesPayload = conversation.map(m => ({
            role: m.role === "bot" ? "assistant" : "user",
            content: m.content
        }));

        const response = await fetch("https://ai.krishd.ch/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

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

        insertChatStmt.run(user, "bot", fullReply);
        console.log("Reply length:", fullReply.length);

        res.json({ reply: fullReply });

    } catch (err) {
        console.error("AI chat error:", err);
        res.status(500).json({ error: "AI request failed" });
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
    const history = getChatsStmt.all(user);
    res.json({history});
});

app.post("/chat/clear", requireLogin, (req, res) => {
    const user = req.session.user;
    deleteChatsStmt.run(user);
    res.json({message: "Chat cleared"});
});

app.get("/", (req, res) => {
    res.sendFile(path.resolve("public/index.html"));
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
