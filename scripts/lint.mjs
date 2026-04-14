import {execFileSync} from "node:child_process";

const files = [
    "server.js",
    "src/app.js",
    "src/config.js",
    "src/db/index.js",
    "src/db/repositories.js",
    "src/db/schema.js",
    "src/middleware/auth.js",
    "src/middleware/rateLimit.js",
    "src/middleware/validate.js",
    "src/routes/auth.js",
    "src/routes/chats.js",
    "src/routes/pages.js",
    "src/routes/personas.js",
    "src/routes/settings.js",
    "src/routes/system.js",
    "src/services/chatService.js",
    "src/services/modelService.js",
    "src/services/personaService.js",
    "public/script.js",
    "public/app/api.js",
    "public/app/constants.js",
    "public/app/dom.js"
];

for (const file of files) {
    execFileSync(process.execPath, ["--check", file], {stdio: "inherit"});
}

console.log(`Syntax check passed for ${files.length} files.`);
