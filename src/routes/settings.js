import express from "express";
import bcrypt from "bcrypt";
import {requireLogin} from "../middleware/auth.js";
import {validateBody} from "../middleware/validate.js";

const usernameValidator = (body) => {
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    if (!username) return {error: "New username is required"};
    if (username.length < 3) return {error: "Username must be at least 3 characters"};
    if (!password) return {error: "Current password is required"};
    return {value: {username, password}};
};

const passwordValidator = (body) => {
    const currentPassword = String(body?.currentPassword || "");
    const newPassword = String(body?.newPassword || "");
    if (!currentPassword || !newPassword) return {error: "Current and new password are required"};
    if (newPassword.length < 6) return {error: "New password must be at least 6 characters"};
    return {value: {currentPassword, newPassword}};
};

const currentPasswordValidator = (body) => {
    const currentPassword = String(body?.currentPassword || "");
    if (!currentPassword) return {error: "Current password is required"};
    return {value: {currentPassword}};
};

const destroySession = (req) => new Promise((resolve) => req.session.destroy(() => resolve()));

export function createSettingsRouter({repositories}) {
    const router = express.Router();
    router.use(requireLogin);

    router.get("/settings/profile", (req, res) => {
        const user = repositories.getUser(req.session.user);
        if (!user) return res.status(404).json({error: "User not found"});
        return res.json({username: user.username});
    });

    router.put("/settings/username", validateBody(usernameValidator), async (req, res) => {
        const currentUsername = req.session.user;
        const {username: nextUsername, password} = req.validatedBody;
        if (nextUsername === currentUsername) {
            return res.status(400).json({error: "That is already your username"});
        }

        const currentUser = repositories.getUser(currentUsername);
        if (!currentUser) return res.status(404).json({error: "User not found"});
        const valid = await bcrypt.compare(password, currentUser.password);
        if (!valid) return res.status(403).json({error: "Current password is incorrect"});
        if (repositories.getUser(nextUsername)) {
            return res.status(400).json({error: "Username already exists"});
        }

        repositories.renameUser(currentUsername, nextUsername);
        req.session.user = nextUsername;
        return res.json({username: nextUsername});
    });

    router.put("/settings/password", validateBody(passwordValidator), async (req, res) => {
        const username = req.session.user;
        const {currentPassword, newPassword} = req.validatedBody;
        const user = repositories.getUser(username);
        if (!user) return res.status(404).json({error: "User not found"});
        const valid = await bcrypt.compare(currentPassword, user.password);
        if (!valid) return res.status(403).json({error: "Current password is incorrect"});
        const hashed = await bcrypt.hash(newPassword, 10);
        repositories.updatePassword(hashed, username);
        const updatedUser = repositories.incrementSessionVersion(username);
        req.session.sessionVersion = Number(updatedUser.session_version || 0);
        return res.json({message: "Password updated"});
    });

    router.post("/settings/logout-all-sessions", (req, res) => {
        repositories.incrementSessionVersion(req.session.user);
        req.session.destroy(() => res.json({message: "All sessions logged out"}));
    });

    router.get("/settings/export", (req, res) => {
        const user = repositories.getUser(req.session.user);
        if (!user) return res.status(404).json({error: "User not found"});
        return res.json({
            account: {
                username: user.username,
                exportedAt: new Date().toISOString(),
                workspace: repositories.exportWorkspace(req.session.user)
            }
        });
    });

    router.delete("/settings/account", validateBody(currentPasswordValidator), async (req, res) => {
        const username = req.session.user;
        const user = repositories.getUser(username);
        if (!user) return res.status(404).json({error: "User not found"});
        const valid = await bcrypt.compare(req.validatedBody.currentPassword, user.password);
        if (!valid) return res.status(403).json({error: "Current password is incorrect"});
        repositories.deleteUser(username);
        await destroySession(req);
        return res.json({message: "Account deleted"});
    });

    return router;
}
