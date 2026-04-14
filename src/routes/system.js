import express from "express";

export function createSystemRouter({modelService}) {
    const router = express.Router();

    router.get("/health", async (req, res) => {
        const model = await modelService.checkHealth();
        return res.status(model.ok ? 200 : 503).json({ok: model.ok, model});
    });

    return router;
}
