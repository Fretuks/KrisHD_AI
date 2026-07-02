import {createRateLimiter} from "./rateLimit.js";

export function createAuthRateLimiters(config) {
    return [
        createRateLimiter({
            windowMs: config.authRateLimitWindowMs,
            max: config.authRateLimitMaxPerIp,
            cleanupIntervalMs: config.rateLimitCleanupIntervalMs,
            keyGenerator: (req) => `auth:ip:${req.ip}`,
            message: "Too many authentication attempts from this IP. Please try again later."
        }),
        createRateLimiter({
            windowMs: config.authRateLimitWindowMs,
            max: config.authRateLimitMaxPerAccount,
            cleanupIntervalMs: config.rateLimitCleanupIntervalMs,
            keyGenerator: (req) => {
                const username = String(req.body?.username || "").trim().toLowerCase();
                return username ? `auth:user:${username}` : null;
            },
            message: "Too many authentication attempts for this account. Please try again later."
        })
    ];
}

export function createChatRateLimiters(config) {
    return [
        createRateLimiter({
            windowMs: config.chatRateLimitWindowMs,
            max: config.chatRateLimitMaxPerIp,
            cleanupIntervalMs: config.rateLimitCleanupIntervalMs,
            keyGenerator: (req) => `chat:ip:${req.ip}`,
            message: "Too many chat requests from this IP. Please slow down."
        }),
        createRateLimiter({
            windowMs: config.chatRateLimitWindowMs,
            max: config.chatRateLimitMaxPerAccount,
            cleanupIntervalMs: config.rateLimitCleanupIntervalMs,
            keyGenerator: (req) => req.session.user ? `chat:user:${req.session.user}` : null,
            message: "Too many chat requests for this account. Please slow down."
        })
    ];
}
