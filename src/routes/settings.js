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
        return res.json({message: "Password updated"});
    });

    return router;
}
