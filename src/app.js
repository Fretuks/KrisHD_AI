import fs from "fs";
import {performance} from "perf_hooks";
import express from "express";
import session from "express-session";
import FileStoreFactory from "session-file-store";
import {createConfig} from "./config.js";
import {createDatabase} from "./db/index.js";
import {createRepositories} from "./db/repositories.js";
import {createRateLimiter} from "./middleware/rateLimit.js";
import {createModelService} from "./services/modelService.js";
import {createChatService} from "./services/chatService.js";
import {createAuthRouter} from "./routes/auth.js";
import {createChatsRouter} from "./routes/chats.js";
import {createPagesRouter} from "./routes/pages.js";
import {createPersonasRouter} from "./routes/personas.js";
import {createSettingsRouter} from "./routes/settings.js";
import {createSystemRouter} from "./routes/system.js";

export function createApp(options = {}) {
    const config = createConfig(options.config);
    const app = express();

    if (config.dbPath !== ":memory:") {
        fs.mkdirSync(config.sessionsDir, {recursive: true});
    }

    let last = performance.now();
    const lagMonitor = setInterval(() => {
        const now = performance.now();
        const drift = now - last - 1000;
        last = now;
        if (drift > 50) {
            console.log("EVENT LOOP LAG", Math.round(drift), "ms", new Date().toISOString());
        }
    }, 1000);
    lagMonitor.unref();

    app.use((req, res, next) => {
        const start = Date.now();
        res.on("finish", () => {
            const ms = Date.now() - start;
            if (ms > 50) console.log("SLOW REQ", `${ms}ms`, req.method, req.url);
        });
        next();
    });

    const db = createDatabase(config);
    const repositories = createRepositories(db, config);
    const modelService = options.modelService || createModelService(config, options.modelOverrides);
    const chatService = createChatService(repositories, modelService, config);
    const FileStore = FileStoreFactory(session);

    const authRateLimiters = [
        createRateLimiter({
            windowMs: config.authRateLimitWindowMs,
            max: config.authRateLimitMaxPerIp,
            keyGenerator: (req) => `auth:ip:${req.ip}`,
            message: "Too many authentication attempts from this IP. Please try again later."
        }),
        createRateLimiter({
            windowMs: config.authRateLimitWindowMs,
            max: config.authRateLimitMaxPerAccount,
            keyGenerator: (req) => {
                const username = String(req.body?.username || "").trim().toLowerCase();
                return username ? `auth:user:${username}` : null;
            },
            message: "Too many authentication attempts for this account. Please try again later."
        })
    ];

    const chatRateLimiters = [
        createRateLimiter({
            windowMs: config.chatRateLimitWindowMs,
            max: config.chatRateLimitMaxPerIp,
            keyGenerator: (req) => `chat:ip:${req.ip}`,
            message: "Too many chat requests from this IP. Please slow down."
        }),
        createRateLimiter({
            windowMs: config.chatRateLimitWindowMs,
            max: config.chatRateLimitMaxPerAccount,
            keyGenerator: (req) => req.session.user ? `chat:user:${req.session.user}` : null,
            message: "Too many chat requests for this account. Please slow down."
        })
    ];

    app.use(express.json({limit: "1mb"}));
    app.use(express.static(config.publicDir));
    app.use(session({
        store: config.testMode ? undefined : new FileStore({path: config.sessionsDir, reapInterval: 3600}),
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: config.cookieSecure,
            httpOnly: true,
            sameSite: "lax",
            maxAge: config.sessionMaxAgeMs
        }
    }));

    app.locals.config = config;
    app.locals.db = db;
    app.locals.repositories = repositories;
    app.locals.modelService = modelService;

    app.use(createAuthRouter({repositories, authRateLimiters}));
    app.use(createSettingsRouter({repositories}));
    app.use(createChatsRouter({repositories, chatService, modelService, config, chatRateLimiters}));
    app.use(createPersonasRouter({repositories, chatService, modelService, config}));
    app.use(createSystemRouter({modelService}));
    app.use(createPagesRouter(config));

    return app;
}

export function startServer(options = {}) {
    const app = createApp(options);
    const {port} = app.locals.config;
    const server = app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
    return {app, server};
}
