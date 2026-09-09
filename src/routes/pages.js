import express from "express";
import {readFile} from "node:fs/promises";
import {renderSiteHeader} from "../pageLayout.js";

export function createPagesRouter(config) {
    const router = express.Router();
    const page = (name) => async (req, res, next) => {
        try {
            const template = await readFile(`${config.publicDir}/${name}.html`, "utf8");
            const header = renderSiteHeader({user: req.session.user, pathname: req.path});
            res.set("Cache-Control", "private, no-store").type("html").send(template.replace("<!-- site-header -->", () => header));
        } catch (error) { next(error); }
    };
    const signedIn = (req, res, next) => req.session.user ? next() : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    router.get(["/", "/index.html"], (req, res, next) => {
        if (/^\d+$/.test(String(req.query.chat || ""))) return res.redirect(`/app/chats/${req.query.chat}`);
        return page("landing")(req, res, next);
    });
    router.get(["/login", "/register"], (req, res, next) => {
        if (req.session.user) return res.redirect("/app");
        return page("account")(req, res, next);
    });
    router.get("/market", (req, res, next) => page(req.session.user ? "market" : "discover")(req, res, next));
    router.get("/privacy.html", page("privacy"));
    router.get("/tos.html", page("tos"));
    router.get("/api/discover", (req, res) => {
        const personas = req.app.locals.repositories.listMarketPersonas().map(({id, name, background, creator_username, persona_type}) => ({id, name, description: String(background || "").slice(0, 240), creator_username, persona_type}));
        res.json({personas});
    });
    router.get(["/home.html", "/account.html", "/discover.html", "/landing.html"], (req, res) => res.redirect(({"/home.html": "/app", "/account.html": "/login", "/discover.html": "/market", "/landing.html": "/"})[req.path]));
    router.get("/settings", (req, res) => res.redirect(`/app/settings${req.url.slice(req.path.length)}`));
    router.get("/app", signedIn, page("home"));
    router.get(["/app/chats", "/app/chats/:id"], signedIn, page("chat"));
    router.get(["/app/settings", "/app/personas"], signedIn, page("settings"));
    router.get("/chat.html", signedIn, (req, res) => res.redirect("/app/chats"));
    router.get("/settings.html", signedIn, (req, res) => res.redirect("/app/settings"));
    router.get("/market.html", (req, res) => res.redirect("/market"));
    return router;
}
