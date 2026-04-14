import express from "express";
import bcrypt from "bcrypt";
import {validateBody} from "../middleware/validate.js";

const credentialsValidator = (body) => {
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    if (!username) return {error: "Username is required"};
    if (username.length < 3) return {error: "Username must be at least 3 characters"};
    if (!password) return {error: "Password is required"};
    if (password.length < 6) return {error: "Password must be at least 6 characters"};
    return {value: {username, password}};
};

export function createAuthRouter({repositories, authRateLimiters}) {
    const router = express.Router();

    router.post("/register", ...authRateLimiters, validateBody(credentialsValidator), async (req, res) => {
        const {username, password} = req.validatedBody;
        if (repositories.getUser(username)) {
            return res.status(400).json({error: "User already exists"});
        }

        const hashed = await bcrypt.hash(password, 10);
        repositories.insertUser(username, hashed);
        return res.json({message: "Registration successful"});
    });

    router.post("/login", ...authRateLimiters, validateBody(credentialsValidator), async (req, res) => {
        const {username, password} = req.validatedBody;
        const user = repositories.getUser(username);
        if (!user) return res.status(400).json({error: "User not found"});
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(403).json({error: "Invalid password"});
        req.session.user = username;
        return res.json({message: "Login successful"});
    });

    router.post("/logout", (req, res) => {
        req.session.destroy(() => res.json({message: "Logged out"}));
    });

    router.get("/session", (req, res) => {
        return res.json({user: req.session.user || null});
    });

    return router;
}
