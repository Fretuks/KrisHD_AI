import path from "path";

const bool = (value, fallback = false) => {
    if (value == null || value === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
};

const trustProxy = (value, fallback = false) => {
    if (value == null || value === "") return fallback;
    const normalized = String(value).toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : value;
};

export function createConfig(overrides = {}) {
    const rootDir = overrides.rootDir || process.cwd();
    const dataDir = overrides.dataDir || path.resolve(rootDir, "data");
    const sessionsDir = overrides.sessionsDir || path.resolve(rootDir, "sessions");
    const testMode = bool(process.env.TEST_MODE, process.env.NODE_ENV === "test");

    const config = {
        rootDir,
        publicDir: path.resolve(rootDir, "public"),
        dataDir,
        sessionsDir,
        port: int(process.env.PORT, 3000),
        dbPath: process.env.DB_PATH || path.resolve(dataDir, "app.db"),
        sessionSecret: process.env.SESSION_SECRET || "change-me-session-secret",
        cookieSecure: bool(process.env.COOKIE_SECURE, false),
        allowInsecureCookies: bool(process.env.ALLOW_INSECURE_COOKIES, false),
        trustProxy: trustProxy(process.env.TRUST_PROXY, false),
        sessionMaxAgeMs: int(process.env.SESSION_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000),
        sameOriginProtectionEnabled: bool(process.env.SAME_ORIGIN_PROTECTION_ENABLED, true),
        staticMaxAge: process.env.STATIC_MAX_AGE || (process.env.NODE_ENV === "production" ? "1h" : 0),
        staticEtag: bool(process.env.STATIC_ETAG, true),
        staticFallthrough: bool(process.env.STATIC_FALLTHROUGH, true),
        eventLoopLagMonitorEnabled: bool(process.env.EVENT_LOOP_LAG_MONITOR_ENABLED, !testMode),
        eventLoopLagWarnMs: int(process.env.EVENT_LOOP_LAG_WARN_MS, 50),
        slowRequestLoggingEnabled: bool(process.env.SLOW_REQUEST_LOGGING_ENABLED, !testMode),
        slowRequestWarnMs: int(process.env.SLOW_REQUEST_WARN_MS, 50),
        chatLimit: int(process.env.CHAT_LIMIT, 10),
        chatHistoryLimit: int(process.env.CHAT_HISTORY_LIMIT, 20),
        modelApiBaseUrl: process.env.MODEL_API_BASE_URL || "https://ai.krishd.ch/api",
        modelRequestTimeoutMs: int(process.env.MODEL_REQUEST_TIMEOUT_MS, 15000),
        modelListTimeoutMs: int(process.env.MODEL_LIST_TIMEOUT_MS, 4000),
        modelUnloadAfterMs: int(process.env.MODEL_UNLOAD_AFTER_MS, 30 * 1000),
        modelsCacheTtlMs: int(process.env.MODELS_CACHE_TTL_MS, 5 * 60 * 1000),
        authRateLimitWindowMs: int(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
        authRateLimitMaxPerIp: int(process.env.AUTH_RATE_LIMIT_MAX_PER_IP, 20),
        authRateLimitMaxPerAccount: int(process.env.AUTH_RATE_LIMIT_MAX_PER_ACCOUNT, 10),
        chatRateLimitWindowMs: int(process.env.CHAT_RATE_LIMIT_WINDOW_MS, 60 * 1000),
        chatRateLimitMaxPerIp: int(process.env.CHAT_RATE_LIMIT_MAX_PER_IP, 60),
        chatRateLimitMaxPerAccount: int(process.env.CHAT_RATE_LIMIT_MAX_PER_ACCOUNT, 30),
        rateLimitCleanupIntervalMs: int(process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS, 60 * 1000),
        testMode,
        dropLegacyChats: bool(process.env.DROP_LEGACY_CHATS, true)
    };

    const resolved = {...config, ...overrides};
    if (process.env.NODE_ENV === "production" && !resolved.testMode) {
        if (resolved.sessionSecret === "change-me-session-secret") {
            throw new Error("SESSION_SECRET must be set in production.");
        }
        if (!resolved.cookieSecure && !resolved.allowInsecureCookies) {
            throw new Error("COOKIE_SECURE must be true in production unless ALLOW_INSECURE_COOKIES=true is set.");
        }
    }

    return resolved;
}
