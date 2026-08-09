import fs from "fs";
import {randomUUID} from "crypto";
import {performance} from "perf_hooks";
import express from "express";
import session from "express-session";
import FileStoreFactory from "session-file-store";
import {createConfig} from "./config.js";
import {createDatabase} from "./db/index.js";
import {createRepositories} from "./db/repositories.js";
import {createAuthRateLimiters, createChatRateLimiters} from "./middleware/rateLimiters.js";
import {createModelService} from "./services/modelService.js";
import {createChatService} from "./services/chatService.js";
import {createAuthRouter} from "./routes/auth.js";
import {createChatsRouter} from "./routes/chats.js";
import {createPagesRouter} from "./routes/pages.js";
import {createPersonasRouter} from "./routes/personas.js";
import {createSettingsRouter} from "./routes/settings.js";
import {createSystemRouter} from "./routes/system.js";

export function createCloseHandler(resources) {
    let closed = false;
    return async () => {
        if (closed) return;
        closed = true;

        const errors = [];
        for (const close of resources) {
            try {
                await close();
            } catch (error) {
                errors.push(error);
            }
        }

        if (errors.length) {
            throw new AggregateError(errors, "Failed to close one or more resources");
        }
    };
}

function createLifecycleMonitors(app, config) {
    const resources = [];

    if (config.eventLoopLagMonitorEnabled) {
        let last = performance.now();
        const lagMonitor = setInterval(() => {
            const now = performance.now();
            const drift = now - last - 1000;
            last = now;
            if (drift > config.eventLoopLagWarnMs) {
                console.warn("EVENT LOOP LAG", Math.round(drift), "ms", new Date().toISOString());
            }
        }, 1000);
        lagMonitor.unref();
        resources.push(() => clearInterval(lagMonitor));
    }

    if (config.slowRequestLoggingEnabled) {
        app.use((req, res, next) => {
            const start = Date.now();
            res.on("finish", () => {
                const ms = Date.now() - start;
                if (ms > config.slowRequestWarnMs) {
                    console.warn("SLOW REQ", `${ms}ms`, req.method, req.url);
                }
            });
            next();
        });
    }

    return resources;
}

function safeRequestId(value) {
    const candidate = String(value || "").trim();
    if (/^[A-Za-z0-9._:-]{8,128}$/.test(candidate)) return candidate;
    return randomUUID();
}

function createObservability(config) {
    const counters = {
        startedAt: new Date().toISOString(),
        requestsTotal: 0,
        responsesByStatus: {},
        errorsTotal: 0,
        slowRequestsTotal: 0,
        lastFailure: null
    };

    const recordError = (req, error, status = 500) => {
        counters.errorsTotal += 1;
        counters.lastFailure = {
            at: new Date().toISOString(),
            requestId: req?.id || null,
            method: req?.method || null,
            path: req?.originalUrl || req?.url || null,
            status,
            message: String(error?.message || error || "Unknown error").slice(0, 500)
        };
    };

    const middleware = (req, res, next) => {
        const start = Date.now();
        req.id = safeRequestId(req.get("X-Request-ID"));
        res.setHeader("X-Request-ID", req.id);

        res.on("finish", () => {
            const durationMs = Date.now() - start;
            const status = res.statusCode;
            const statusKey = String(status);
            counters.requestsTotal += 1;
            counters.responsesByStatus[statusKey] = (counters.responsesByStatus[statusKey] || 0) + 1;
            if (durationMs > config.slowRequestWarnMs) counters.slowRequestsTotal += 1;
            if (status >= 500 && counters.lastFailure?.requestId !== req.id) {
                recordError(req, `HTTP ${status}`, status);
            }
            if (config.structuredRequestLoggingEnabled) {
                console.log(JSON.stringify({
                    type: "request",
                    requestId: req.id,
                    method: req.method,
                    path: req.originalUrl || req.url,
                    status,
                    durationMs,
                    slow: durationMs > config.slowRequestWarnMs,
                    user: req.session?.user || null
                }));
            }
        });

        next();
    };

    return {
        middleware,
        recordError,
        getSnapshot() {
            return {
                ...counters,
                responsesByStatus: {...counters.responsesByStatus}
            };
        }
    };
}

function wantsJson(req) {
    const accept = req.get("Accept") || "";
    const contentType = req.get("Content-Type") || "";
    return req.xhr
        || req.path.startsWith("/api/")
        || accept.includes("application/json")
        || contentType.includes("application/json");
}

function notFoundHandler(req, res) {
    if (wantsJson(req)) {
        return res.status(404).json({error: "Not found"});
    }
    return res.status(404).type("text").send("Not found");
}

function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }

    if (err?.type === "entity.parse.failed") {
        req.app?.locals?.observability?.recordError(req, err, 400);
        return res.status(400).json({error: "Invalid JSON"});
    }

    const status = Number.isInteger(err.status) ? err.status : Number.isInteger(err.statusCode) ? err.statusCode : 500;
    const message = status >= 500 ? "Internal server error" : err.message;
    req.app?.locals?.observability?.recordError(req, err, status);
    if (status >= 500) {
        console.warn("REQUEST ERROR", status, req.method, req.url, err);
    } else {
        console.warn("REQUEST ERROR", status, req.method, req.url, message);
    }
    if (wantsJson(req)) {
        return res.status(status).json({error: message});
    }
    return res.status(status).type("text").send(message);
}

function sameOriginProtection(config) {
    return (req, res, next) => {
        if (!config.sameOriginProtectionEnabled || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
            return next();
        }

        const secFetchSite = req.get("Sec-Fetch-Site");
        if (secFetchSite && !["same-origin", "none"].includes(secFetchSite)) {
            return res.status(403).json({error: "Cross-origin request blocked"});
        }

        const origin = req.get("Origin");
        if (!origin) return next();

        let parsedOrigin;
        try {
            parsedOrigin = new URL(origin);
        } catch {
            return res.status(403).json({error: "Cross-origin request blocked"});
        }

        if (parsedOrigin.protocol !== `${req.protocol}:` || parsedOrigin.host !== req.get("Host")) {
            return res.status(403).json({error: "Cross-origin request blocked"});
        }

        return next();
    };
}

function enforceSessionVersion(repositories) {
    return (req, res, next) => {
        if (!req.session.user) return next();
        const user = repositories.getUser(req.session.user);
        const currentVersion = Number(user?.session_version || 0);
        const sessionVersion = Number(req.session.sessionVersion || 0);
        if (user && currentVersion === sessionVersion) return next();

        req.session.destroy(() => {
            if (req.path === "/session") {
                return res.json({user: null});
            }
            return res.status(403).json({error: "Session expired. Please log in again."});
        });
    };
}

export function createApp(options = {}) {
    const config = createConfig(options.config);
    const app = express();
    app.set("trust proxy", config.trustProxy);

    if (config.dbPath !== ":memory:") {
        fs.mkdirSync(config.dataDir, {recursive: true});
        fs.mkdirSync(config.sessionsDir, {recursive: true});
    }

    const closeHandlers = createLifecycleMonitors(app, config);
    const observability = createObservability(config);

    const db = createDatabase(config);
    const repositories = createRepositories(db, config);
    const modelService = options.modelService || createModelService(config, options.modelOverrides);
    const chatService = createChatService(repositories, modelService, config);
    const FileStore = FileStoreFactory(session);
    const authRateLimiters = createAuthRateLimiters(config);
    const chatRateLimiters = createChatRateLimiters(config);
    closeHandlers.push(
        ...authRateLimiters.map((limiter) => limiter.close),
        ...chatRateLimiters.map((limiter) => limiter.close),
        () => db.close()
    );

    app.use(observability.middleware);
    app.use(express.json({limit: "1mb"}));
    app.use(express.static(config.publicDir, {
        maxAge: config.staticMaxAge,
        etag: config.staticEtag,
        fallthrough: config.staticFallthrough
    }));
    app.use(session({
        store: options.sessionStore || (config.testMode ? undefined : new FileStore({path: config.sessionsDir, reapInterval: 3600})),
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
    app.use(sameOriginProtection(config));
    app.use(enforceSessionVersion(repositories));

    app.locals.config = config;
    app.locals.db = db;
    app.locals.repositories = repositories;
    app.locals.modelService = modelService;
    app.locals.observability = observability;
    app.locals.close = createCloseHandler(closeHandlers);

    app.use(createAuthRouter({repositories, authRateLimiters, config}));
    app.use(createSettingsRouter({repositories}));
    app.use(createChatsRouter({repositories, chatService, modelService, config, chatRateLimiters}));
    app.use(createPersonasRouter({repositories, chatService, modelService, config}));
    app.use(createSystemRouter({modelService, config}));
    app.use(createPagesRouter(config));
    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

export function startServer(options = {}) {
    const app = createApp(options);
    const {port} = app.locals.config;
    const server = app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
    const close = async () => {
        const errors = [];
        try {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        } catch (error) {
            errors.push(error);
        }
        try {
            await app.locals.close();
        } catch (error) {
            if (error instanceof AggregateError) {
                errors.push(...error.errors);
            } else {
                errors.push(error);
            }
        }
        if (errors.length) {
            throw new AggregateError(errors, "Failed to close server cleanly");
        }
    };
    if (options.handleSignals !== false) {
        let shuttingDown = false;
        const shutdown = (signal) => {
            if (shuttingDown) return;
            shuttingDown = true;
            close()
                .then(() => process.exit(0))
                .catch((error) => {
                    console.error(`Failed to shut down after ${signal}`, error);
                    process.exit(1);
                });
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
    }
    return {app, server, close};
}
