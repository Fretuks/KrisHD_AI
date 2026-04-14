import path from "path";

const bool = (value, fallback = false) => {
    if (value == null || value === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
};

export function createConfig(overrides = {}) {
    const rootDir = overrides.rootDir || process.cwd();
    const dataDir = overrides.dataDir || path.resolve(rootDir, "data");
    const sessionsDir = overrides.sessionsDir || path.resolve(rootDir, "sessions");

    const config = {
        rootDir,
        publicDir: path.resolve(rootDir, "public"),
        dataDir,
        sessionsDir,
        port: int(process.env.PORT, 3000),
        dbPath: process.env.DB_PATH || path.resolve(dataDir, "app.db"),
        sessionSecret: process.env.SESSION_SECRET || "change-me-session-secret",
        cookieSecure: bool(process.env.COOKIE_SECURE, false),
        sessionMaxAgeMs: int(process.env.SESSION_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000),
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
        testMode: bool(process.env.TEST_MODE, process.env.NODE_ENV === "test"),
        dropLegacyChats: bool(process.env.DROP_LEGACY_CHATS, true)
    };

    return {...config, ...overrides};
}
