import express from "express";

export function createPagesRouter(config) {
    const router = express.Router();

    router.get("/market", (req, res) => res.sendFile(`${config.publicDir}/market.html`));
    router.get("/settings", (req, res) => res.sendFile(`${config.publicDir}/settings.html`));
    router.get("/", (req, res) => res.sendFile(`${config.publicDir}/index.html`));

    return router;
}
