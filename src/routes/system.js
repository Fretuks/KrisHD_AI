import express from "express";
import {requireLogin} from "../middleware/auth.js";

function requireAdmin(req, res, next) {
    if (req.session.user !== "admin") {
        return res.status(403).json({error: "Admin only"});
    }
    return next();
}

function buildConfigWarnings(config) {
    const warnings = [];
    if (config.sessionSecret === "change-me-session-secret") {
        warnings.push("SESSION_SECRET is using the development default.");
    }
    if (!config.cookieSecure && !config.testMode) {
        warnings.push("COOKIE_SECURE is disabled; use secure cookies behind HTTPS in production.");
    }
    if (!config.sameOriginProtectionEnabled) {
        warnings.push("Same-origin protection is disabled.");
    }
    if (!config.slowRequestLoggingEnabled) {
        warnings.push("Slow request logging is disabled.");
    }
    if (!config.eventLoopLagMonitorEnabled) {
        warnings.push("Event-loop lag monitoring is disabled.");
    }
    return warnings;
}

export function createSystemRouter({modelService, config}) {
    const router = express.Router();

    router.get("/health", async (req, res) => {
        const model = await modelService.checkHealth();
        return res.status(model.ok ? 200 : 503).json({ok: model.ok, model});
    });

    router.get("/admin/diagnostics", requireLogin, requireAdmin, async (req, res) => {
        const diagnostics = await modelService.getDiagnostics();
        return res.status(diagnostics.model.ok ? 200 : 503).json({
            model: diagnostics.model,
            configWarnings: buildConfigWarnings(config)
        });
    });

    return router;
}
