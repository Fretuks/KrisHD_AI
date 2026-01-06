import express from "express";
import session from "express-session";
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import bodyParser from "body-parser";

const app = express();
const PORT = 3000;
const DATA_PATH = "./data/users.json";
const CHAT_PATH = "./data/chats.json";

import FileStoreFactory from "session-file-store";

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

let chats = JSON.parse(fs.readFileSync(CHAT_PATH));
const saveChats = () => fs.writeFileSync(CHAT_PATH, JSON.stringify(chats, null, 2));

if (!fs.existsSync(DATA_PATH)) fs.writeFileSync(DATA_PATH, "{}");
const users = JSON.parse(fs.readFileSync(DATA_PATH));
const saveUsers = () => fs.writeFileSync(DATA_PATH, JSON.stringify(users, null, 2));

app.post("/register", async (req, res) => {
    const {username, password} = req.body;
    if (users[username]) return res.status(400).json({error: "User already exists"});
    const hashed = await bcrypt.hash(password, 10);
    users[username] = {password: hashed};
    saveUsers();
    res.json({message: "Registration successful"});
});

app.post("/login", async (req, res) => {
    const {username, password} = req.body;
    const user = users[username];
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
})

app.post("/chat", requireLogin, async (req, res) => {
    const user = req.session.user;
    const { message, model } = req.body;
    const selectedModel = model || "mistral:latest";

    try {
        if (!chats[user]) chats[user] = [];
        chats[user].push({ role: "user", content: message });
        if (chats[user].length > 20) chats[user] = chats[user].slice(-20);

        const messagesPayload = chats[user].map(m => ({
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
            buffer = lines.pop(); // keep incomplete JSON

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

        chats[user].push({ role: "bot", content: fullReply });
        saveChats();
        console.log("Reply length:", fullReply.length);

        res.json({ reply: fullReply });

    } catch (err) {
        console.error("AI chat error:", err);
        res.status(500).json({ error: "AI request failed" });
    }
});


async function checkSession() {
    const res = await get('/session');
    if (res.user) {
        authDiv.style.display = "none";
        chatDiv.style.display = "grid";
        loadChatHistory();
        msgInput.focus();
        return true;
    }
    return false;
}

app.get("/session", (req, res) => {
    if (req.session.user) res.json({user: req.session.user});
    else res.json({user: null});
});

app.get("/chat/history", requireLogin, (req, res) => {
    const user = req.session.user;
    res.json({history: chats[user] || []});
});

app.post("/chat/clear", requireLogin, (req, res) => {
    const user = req.session.user;
    chats[user] = [];
    saveChats();
    res.json({message: "Chat cleared"});
});

app.get("/", (req, res) => {
    res.sendFile(path.resolve("public/index.html"));
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));