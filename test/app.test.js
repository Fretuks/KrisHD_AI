import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import session from "express-session";
import {createApp, createCloseHandler} from "../src/app.js";

class CookieJar {
    constructor() {
        this.cookie = "";
    }

    update(response) {
        const values = typeof response.headers.getSetCookie === "function"
            ? response.headers.getSetCookie()
            : [response.headers.get("set-cookie")].filter(Boolean);
        if (!values.length) return;
        this.cookie = values.map((value) => value.split(";")[0]).join("; ");
    }

    headers(extra = {}) {
        return this.cookie ? {...extra, Cookie: this.cookie} : extra;
    }
}

async function startTestServer(overrides = {}) {
    let replyCount = 0;
    const modelService = overrides.modelService || {
        async generateReply() {
            replyCount += 1;
            return `stub-reply-${replyCount}`;
        },
        async streamReply(model, messagesPayload, onChunk) {
            replyCount += 1;
            const reply = `stub-reply-${replyCount}`;
            if (onChunk) {
                onChunk(reply.slice(0, 5), reply.slice(0, 5));
                onChunk(reply.slice(5), reply);
            }
            return reply;
        },
        async listModels() {
            return {models: [{name: "mistral:latest"}]};
        },
        async checkHealth() {
            return {ok: true, checkedAt: new Date().toISOString(), error: null};
        },
        async getDiagnostics() {
            return {
                model: {
                    ok: true,
                    checkedAt: new Date().toISOString(),
                    error: null,
                    latencyMs: 12,
                    backendUrl: "http://model.test",
                    availableModels: ["mistral:latest"],
                    modelCount: 1,
                    listLatencyMs: 12,
                    cacheAgeMs: 0,
                    lastFailure: null,
                    activeRequests: []
                }
            };
        },
        mapError(error) {
            return {status: 500, body: {error: error.message, code: "TEST_MODEL"}};
        }
    };

    const app = createApp({
        config: {
            port: 0,
            dbPath: ":memory:",
            testMode: true,
            sessionSecret: "test-secret",
            ...(overrides.config || {})
        },
        modelService,
        sessionStore: overrides.sessionStore
    });

    const server = await new Promise((resolve) => {
        const instance = app.listen(0, () => resolve(instance));
    });
    const {port} = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    return {
        app,
        baseUrl,
        async close() {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
            await app.locals.close();
        }
    };
}

async function request(baseUrl, path, {method = "GET", body, jar} = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(jar ? jar.headers() : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (jar) jar.update(response);
    const json = await response.json();
    return {status: response.status, json};
}

test("auth flow validates inputs and persists session", async () => {
    const server = await startTestServer();
    const jar = new CookieJar();

    await request(server.baseUrl, "/register", {
        method: "POST",
        body: {username: "ab", password: "123456"}
    }).then(({status, json}) => {
        assert.equal(status, 400);
        assert.match(json.error, /at least 3 characters/i);
    });

    await request(server.baseUrl, "/register", {
        method: "POST",
        body: {username: "alice", password: "password123"}
    }).then(({status}) => assert.equal(status, 200));

    await request(server.baseUrl, "/login", {
        method: "POST",
        body: {username: "alice", password: "password123"},
        jar
    }).then(({status}) => assert.equal(status, 200));

    await request(server.baseUrl, "/session", {jar}).then(({json}) => {
        assert.equal(json.user, "alice");
    });

    await server.close();
});

test("invite-only registration requires invite code", async () => {
    const server = await startTestServer({config: {registrationInviteCode: "let-me-in"}});

    await request(server.baseUrl, "/register", {
        method: "POST",
        body: {username: "invitee", password: "password123"}
    }).then(({status, json}) => {
        assert.equal(status, 403);
        assert.match(json.error, /invite code/i);
    });

    await request(server.baseUrl, "/register", {
        method: "POST",
        body: {username: "invitee", password: "password123", inviteCode: "let-me-in"}
    }).then(({status}) => assert.equal(status, 200));

    await server.close();
});

test("createApp can use an injected session store", async () => {
    class CountingStore extends session.Store {
        constructor() {
            super();
            this.sessions = new Map();
            this.setCount = 0;
        }

        get(sid, callback) {
            callback(null, this.sessions.get(sid));
        }

        set(sid, value, callback) {
            this.setCount += 1;
            this.sessions.set(sid, value);
            callback();
        }

        destroy(sid, callback) {
            this.sessions.delete(sid);
            callback();
        }
    }

    const store = new CountingStore();
    const server = await startTestServer({sessionStore: store});
    const jar = new CookieJar();

    await request(server.baseUrl, "/register", {
        method: "POST",
        body: {username: "alice", password: "password123"}
    }).then(({status}) => assert.equal(status, 200));

    await request(server.baseUrl, "/login", {
        method: "POST",
        body: {username: "alice", password: "password123"},
        jar
    }).then(({status}) => assert.equal(status, 200));

    assert.equal(store.setCount > 0, true);
    await server.close();
});

test("account export, logout-all, and deletion controls work", async () => {
    const server = await startTestServer();
    const firstJar = new CookieJar();
    const secondJar = new CookieJar();

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "owner", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "owner", password: "password123"}, jar: firstJar});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "owner", password: "password123"}, jar: secondJar});

    const exported = await request(server.baseUrl, "/settings/export", {jar: firstJar});
    assert.equal(exported.status, 200);
    assert.equal(exported.json.account.username, "owner");
    assert.ok(exported.json.account.workspace);

    const logoutAll = await request(server.baseUrl, "/settings/logout-all-sessions", {
        method: "POST",
        body: {},
        jar: firstJar
    });
    assert.equal(logoutAll.status, 200);
    const staleSession = await request(server.baseUrl, "/settings/profile", {jar: secondJar});
    assert.equal(staleSession.status, 403);

    await request(server.baseUrl, "/login", {method: "POST", body: {username: "owner", password: "password123"}, jar: firstJar});
    const wrongDelete = await request(server.baseUrl, "/settings/account", {
        method: "DELETE",
        body: {currentPassword: "wrong-password"},
        jar: firstJar
    });
    assert.equal(wrongDelete.status, 403);

    const deleted = await request(server.baseUrl, "/settings/account", {
        method: "DELETE",
        body: {currentPassword: "password123"},
        jar: firstJar
    });
    assert.equal(deleted.status, 200);

    const loginAfterDelete = await request(server.baseUrl, "/login", {
        method: "POST",
        body: {username: "owner", password: "password123"}
    });
    assert.equal(loginAfterDelete.status, 400);

    await server.close();
});

test("admin diagnostics require admin and return model status", async () => {
    const server = await startTestServer({
        config: {
            sessionSecret: "change-me-session-secret",
            slowRequestLoggingEnabled: false,
            eventLoopLagMonitorEnabled: false
        }
    });
    const userJar = new CookieJar();
    const adminJar = new CookieJar();

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "alice", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "alice", password: "password123"}, jar: userJar});
    const userDiagnostics = await request(server.baseUrl, "/admin/diagnostics", {jar: userJar});
    assert.equal(userDiagnostics.status, 403);
    assert.equal(userDiagnostics.json.error, "Admin only");

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "admin", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "admin", password: "password123"}, jar: adminJar});
    const diagnostics = await request(server.baseUrl, "/admin/diagnostics", {jar: adminJar});
    assert.equal(diagnostics.status, 200);
    assert.equal(diagnostics.json.model.ok, true);
    assert.deepEqual(diagnostics.json.model.availableModels, ["mistral:latest"]);
    assert.ok(diagnostics.json.configWarnings.some((warning) => warning.includes("SESSION_SECRET")));

    await server.close();
});

test("invalid JSON returns a clean 400 response", async () => {
    const server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/register`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: "{"
    });
    const json = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(json, {error: "Invalid JSON"});
    await server.close();
});

test("cross-origin state-changing requests are blocked", async () => {
    const server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/register`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Origin: "https://example.test"
        },
        body: JSON.stringify({username: "alice", password: "password123"})
    });
    const json = await response.json();

    assert.equal(response.status, 403);
    assert.deepEqual(json, {error: "Cross-origin request blocked"});
    await server.close();
});

test("file-backed startup creates data and session directories", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "krishd-app-"));
    const dataDir = path.join(rootDir, "data");
    const sessionsDir = path.join(rootDir, "sessions");
    const app = createApp({
        config: {
            rootDir,
            dataDir,
            sessionsDir,
            dbPath: path.join(dataDir, "app.db"),
            testMode: true,
            sessionSecret: "test-secret"
        },
        modelService: {
            async generateReply() {},
            async streamReply() {},
            async listModels() {
                return {models: []};
            },
            async checkHealth() {
                return {ok: true, checkedAt: new Date().toISOString(), error: null};
            },
            async getDiagnostics() {
                return {model: {ok: true, availableModels: [], modelCount: 0, activeRequests: []}};
            },
            mapError(error) {
                return {status: 500, body: {error: error.message}};
            }
        }
    });

    assert.equal(fs.existsSync(dataDir), true);
    assert.equal(fs.existsSync(sessionsDir), true);
    await app.locals.close();
});

test("close handler attempts all resources and reports collected failures", async () => {
    const closed = [];
    const close = createCloseHandler([
        () => {
            closed.push("first");
            throw new Error("first failed");
        },
        () => {
            closed.push("second");
        },
        () => {
            closed.push("third");
            throw new Error("third failed");
        }
    ]);

    await assert.rejects(close, (error) => {
        assert.equal(error instanceof AggregateError, true);
        assert.equal(error.errors.length, 2);
        assert.deepEqual(error.errors.map((item) => item.message), ["first failed", "third failed"]);
        return true;
    });
    assert.deepEqual(closed, ["first", "second", "third"]);
});

test("chat creation, send, and retry endpoints work with stubbed model service", async () => {
    const server = await startTestServer();
    const jar = new CookieJar();

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "bob", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "bob", password: "password123"}, jar});

    const createChat = await request(server.baseUrl, "/chats", {
        method: "POST",
        body: {title: "Test chat"},
        jar
    });
    assert.equal(createChat.status, 200);
    const chatId = createChat.json.chat.id;

    const sendMessage = await request(server.baseUrl, "/chat", {
        method: "POST",
        body: {chatId, message: "hello", model: "mistral:latest"},
        jar
    });
    assert.equal(sendMessage.status, 200);
    assert.equal(sendMessage.json.reply, "stub-reply-1");

    const messages = await request(server.baseUrl, `/chats/${chatId}/messages`, {jar});
    assert.equal(messages.status, 200);
    assert.equal(messages.json.messages.length, 2);
    const botMessage = messages.json.messages.find((message) => message.role === "bot");

    const retry = await request(server.baseUrl, `/chats/${chatId}/messages/${botMessage.id}/retry`, {
        method: "POST",
        body: {model: "mistral:latest"},
        jar
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.json.message.content, "stub-reply-2");
    assert.equal(retry.json.message.retryVariants.length, 2);

    await server.close();
});

test("conversation branches, edit-resend, and generation settings work", async () => {
    const calls = [];
    const modelService = {
        async generateReply(model, messages, options) {
            calls.push({model, messages, options});
            return `reply-${calls.length}`;
        },
        async streamReply() {},
        async listModels() { return {models: [{name: "preferred:model", model: "preferred:model"}]}; },
        mapError(error) { return {status: 500, body: {error: error.message}}; }
    };
    const server = await startTestServer({modelService});
    const jar = new CookieJar();
    await request(server.baseUrl, "/register", {method: "POST", body: {username: "brancher", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "brancher", password: "password123"}, jar});
    const created = await request(server.baseUrl, "/chats", {method: "POST", body: {title: "Branches"}, jar});
    const chatId = created.json.chat.id;

    await request(server.baseUrl, `/chats/${chatId}/generation-settings`, {
        method: "PUT",
        body: {preferredModel: "preferred:model", temperature: 0.4, contextLength: 4096, responseLength: 300, systemInstruction: "Be exact."},
        jar
    });
    await request(server.baseUrl, "/chat", {method: "POST", body: {chatId, message: "first", model: "selected:model"}, jar});
    assert.equal(calls[0].model, "selected:model");
    assert.deepEqual(calls[0].options.generation, {temperature: 0.4, contextLength: 4096, responseLength: 300});
    assert.match(calls[0].messages[0].content, /Be exact/);

    const switchedModel = await request(server.baseUrl, `/chats/${chatId}/model`, {
        method: "PUT", body: {model: "selected:model"}, jar
    });
    assert.equal(switchedModel.status, 200);
    assert.equal(switchedModel.json.chat.preferred_model, "selected:model");

    await request(server.baseUrl, "/chat", {method: "POST", body: {chatId, message: "second", model: "ignored:model"}, jar});
    const original = await request(server.baseUrl, `/chats/${chatId}/messages`, {jar});
    const firstAssistant = original.json.messages[1];
    const originalLeaf = original.json.messages.at(-1);

    const regenerated = await request(server.baseUrl, `/chats/${chatId}/messages/${firstAssistant.id}/retry`, {
        method: "POST", body: {model: "ignored:model"}, jar
    });
    assert.equal(regenerated.status, 200);
    let active = await request(server.baseUrl, `/chats/${chatId}/messages`, {jar});
    assert.equal(active.json.messages.length, 2);
    assert.equal(active.json.messages[1].siblingCount, 2);

    await request(server.baseUrl, `/chats/${chatId}/branches/${originalLeaf.id}/activate`, {method: "POST", body: {}, jar});
    active = await request(server.baseUrl, `/chats/${chatId}/messages`, {jar});
    assert.equal(active.json.messages.length, 4);

    const unconfirmedBranch = await request(server.baseUrl, `/chats/${chatId}/messages/${firstAssistant.id}/branch`, {
        method: "POST", body: {}, jar
    });
    assert.equal(unconfirmedBranch.status, 400);

    const branched = await request(server.baseUrl, `/chats/${chatId}/messages/${firstAssistant.id}/branch`, {
        method: "POST", body: {confirmed: true}, jar
    });
    assert.equal(branched.status, 200);
    assert.notEqual(branched.json.chat.id, chatId);
    assert.equal(branched.json.chat.source_chat_id, chatId);
    assert.equal(branched.json.chat.branched_from_message_id, firstAssistant.id);
    assert.match(branched.json.chat.title, /\(branch\)$/);
    assert.deepEqual(branched.json.messages.map((message) => message.content), ["first", "reply-1"]);
    assert.equal(branched.json.chat.preferred_model, "selected:model");
    assert.equal(branched.json.chat.temperature, 0.4);

    const edited = await request(server.baseUrl, `/chats/${chatId}/messages/${active.json.messages[0].id}/edit-resend`, {
        method: "POST", body: {chatId, message: "edited first", model: "ignored:model", confirmed: true}, jar
    });
    assert.equal(edited.status, 200);
    assert.notEqual(edited.json.chat.id, chatId);
    assert.notEqual(edited.json.chat.id, branched.json.chat.id);
    assert.deepEqual(edited.json.messages.map((message) => message.content), ["edited first", "reply-4"]);

    active = await request(server.baseUrl, `/chats/${chatId}/messages`, {jar});
    assert.deepEqual(active.json.messages.map((message) => message.content), ["first", "reply-1", "second", "reply-2"]);

    await server.close();
});

test("chat memories are durable facts included in model payload", async () => {
    let capturedMessages = [];
    const modelService = {
        async generateReply(model, messagesPayload) {
            capturedMessages = messagesPayload;
            return "memory-aware reply";
        },
        async streamReply() {
            return "unused";
        },
        async listModels() {
            return {models: [{name: "mistral:latest"}]};
        },
        async checkHealth() {
            return {ok: true, checkedAt: new Date().toISOString(), error: null};
        },
        async getDiagnostics() {
            return {model: {ok: true, availableModels: ["mistral:latest"], modelCount: 1, activeRequests: []}};
        },
        mapError(error) {
            return {status: 500, body: {error: error.message, code: "TEST_MODEL"}};
        }
    };
    const server = await startTestServer({modelService});
    const jar = new CookieJar();

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "memoryuser", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "memoryuser", password: "password123"}, jar});
    const createChat = await request(server.baseUrl, "/chats", {
        method: "POST",
        body: {title: "Memory chat"},
        jar
    });
    const chatId = createChat.json.chat.id;

    const memory = await request(server.baseUrl, `/chats/${chatId}/memories`, {
        method: "POST",
        body: {fact: "The user prefers terse answers."},
        jar
    });
    assert.equal(memory.status, 200);
    assert.equal(memory.json.memory.fact, "The user prefers terse answers.");

    const memories = await request(server.baseUrl, `/chats/${chatId}/memories`, {jar});
    assert.equal(memories.status, 200);
    assert.equal(memories.json.memories.length, 1);

    const sendMessage = await request(server.baseUrl, "/chat", {
        method: "POST",
        body: {chatId, message: "hello", model: "mistral:latest"},
        jar
    });
    assert.equal(sendMessage.status, 200);
    assert.ok(capturedMessages.some((message) => message.role === "system" && message.content.includes("The user prefers terse answers.")));

    const deleted = await request(server.baseUrl, `/chats/${chatId}/memories/${memory.json.memory.id}`, {
        method: "DELETE",
        jar
    });
    assert.equal(deleted.status, 200);

    await server.close();
});

test("chat context summary rolls up older messages into future payloads", async () => {
    let replyCount = 0;
    let latestPayload = [];
    const modelService = {
        async generateReply(model, messagesPayload) {
            if (messagesPayload.some((message) => message.content.includes("Merge the previous summary"))) {
                return "Summary: user greeted the assistant and asked for continuity.";
            }
            latestPayload = messagesPayload;
            replyCount += 1;
            return `reply-${replyCount}`;
        },
        async streamReply() {
            return "unused";
        },
        async listModels() {
            return {models: [{name: "mistral:latest"}]};
        },
        async checkHealth() {
            return {ok: true, checkedAt: new Date().toISOString(), error: null};
        },
        async getDiagnostics() {
            return {model: {ok: true, availableModels: ["mistral:latest"], modelCount: 1, activeRequests: []}};
        },
        mapError(error) {
            return {status: 500, body: {error: error.message, code: "TEST_MODEL"}};
        }
    };
    const server = await startTestServer({
        modelService,
        config: {chatHistoryLimit: 2, chatSummaryUpdateEveryMessages: 2}
    });
    const jar = new CookieJar();

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "summarized", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "summarized", password: "password123"}, jar});
    const createChat = await request(server.baseUrl, "/chats", {
        method: "POST",
        body: {title: "Summary chat"},
        jar
    });
    const chatId = createChat.json.chat.id;

    await request(server.baseUrl, "/chat", {
        method: "POST",
        body: {chatId, message: "hello", model: "mistral:latest"},
        jar
    });
    await request(server.baseUrl, "/chat", {
        method: "POST",
        body: {chatId, message: "remember this", model: "mistral:latest"},
        jar
    });
    await request(server.baseUrl, "/chat", {
        method: "POST",
        body: {chatId, message: "what is next?", model: "mistral:latest"},
        jar
    });

    assert.ok(latestPayload.some((message) => message.role === "system" && message.content.includes("CONVERSATION SUMMARY")));
    assert.ok(latestPayload.some((message) => message.content.includes("user greeted the assistant")));

    await server.close();
});

test("roleplay start keeps the session and roleplay messages work", async () => {
    const server = await startTestServer();
    const jar = new CookieJar();

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "roleplayer", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "roleplayer", password: "password123"}, jar});

    const persona = await request(server.baseUrl, "/personas", {
        method: "POST",
        body: {personaType: "assistant", name: "Guide", details: "Patient and direct"},
        jar
    });
    assert.equal(persona.status, 200);

    const started = await request(server.baseUrl, "/roleplays/start", {
        method: "POST",
        body: {assistantPersonaId: persona.json.persona.id, scenarioPrompt: "A quiet station.", model: "mistral:latest"},
        jar
    });
    assert.equal(started.status, 200);
    assert.equal(started.json.generatedInitialMessage, true);
    assert.ok(started.json.chat.id);

    const session = await request(server.baseUrl, "/session", {jar});
    assert.equal(session.status, 200);
    assert.equal(session.json.user, "roleplayer");

    const sendMessage = await request(server.baseUrl, "/chat", {
        method: "POST",
        body: {chatId: started.json.chat.id, message: "I step closer.", model: "mistral:latest"},
        jar
    });
    assert.equal(sendMessage.status, 200);
    assert.equal(sendMessage.json.reply, "stub-reply-2");

    await server.close();
});

test("roleplay start degrades to an open chat when opener generation fails", async () => {
    const modelService = {
        async generateReply() {
            throw new Error("Model backend timed out.");
        },
        async streamReply() {
            return "unused";
        },
        async listModels() {
            return {models: [{name: "mistral:latest"}]};
        },
        async checkHealth() {
            return {ok: false, checkedAt: new Date().toISOString(), error: "Model backend timed out."};
        },
        mapError(error) {
            return {status: 504, body: {error: error.message, code: "MODEL_TIMEOUT"}};
        }
    };
    const server = await startTestServer({modelService});
    const jar = new CookieJar();

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "degraded", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "degraded", password: "password123"}, jar});

    const persona = await request(server.baseUrl, "/personas", {
        method: "POST",
        body: {personaType: "assistant", name: "Guide", details: "Patient and direct"},
        jar
    });

    const started = await request(server.baseUrl, "/roleplays/start", {
        method: "POST",
        body: {assistantPersonaId: persona.json.persona.id, model: "mistral:latest"},
        jar
    });
    assert.equal(started.status, 200);
    assert.equal(started.json.degraded, true);
    assert.equal(started.json.generatedInitialMessage, false);
    assert.ok(started.json.chat.id);

    const session = await request(server.baseUrl, "/session", {jar});
    assert.equal(session.json.user, "degraded");

    await server.close();
});

test("persona publish and collect flow works across accounts", async () => {
    const server = await startTestServer();
    const creatorJar = new CookieJar();
    const collectorJar = new CookieJar();

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "creator", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "creator", password: "password123"}, jar: creatorJar});

    const persona = await request(server.baseUrl, "/personas", {
        method: "POST",
        body: {personaType: "assistant", name: "Agent", details: "Helpful"},
        jar: creatorJar
    });
    assert.equal(persona.status, 200);

    const publish = await request(server.baseUrl, `/personas/${persona.json.persona.id}/publish`, {
        method: "POST",
        body: {},
        jar: creatorJar
    });
    assert.equal(publish.status, 200);

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "collector", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "collector", password: "password123"}, jar: collectorJar});

    const market = await request(server.baseUrl, "/personas/market", {jar: collectorJar});
    assert.equal(market.status, 200);
    assert.equal(market.json.personas.length, 1);

    const collect = await request(server.baseUrl, `/personas/market/${market.json.personas[0].id}/collect`, {
        method: "POST",
        body: {},
        jar: collectorJar
    });
    assert.equal(collect.status, 200);
    assert.equal(collect.json.persona.name, "Agent");

    await server.close();
});

test("chat search, organization, and workspace export work", async () => {
    const server = await startTestServer();
    const jar = new CookieJar();

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "searcher", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "searcher", password: "password123"}, jar});

    const createChat = await request(server.baseUrl, "/chats", {
        method: "POST",
        body: {title: "Notes"},
        jar
    });
    const chatId = createChat.json.chat.id;

    await request(server.baseUrl, "/chat", {
        method: "POST",
        body: {chatId, message: "findable keyword", model: "mistral:latest"},
        jar
    });

    const search = await request(server.baseUrl, "/chats/search?q=keyword", {jar});
    assert.equal(search.status, 200);
    assert.equal(search.json.chats.length, 1);

    const organize = await request(server.baseUrl, `/chats/${chatId}/organization`, {
        method: "PUT",
        body: {folderName: "Research", isPinned: true, archived: false},
        jar
    });
    assert.equal(organize.status, 200);
    assert.equal(organize.json.chat.folder_name, "Research");
    assert.equal(organize.json.chat.is_pinned, 1);

    const exported = await request(server.baseUrl, "/exports/workspace", {jar});
    assert.equal(exported.status, 200);
    assert.equal(exported.json.workspace.chats.length, 1);

    const invalidImport = await request(server.baseUrl, "/imports/workspace/preview", {
        method: "POST",
        body: {workspace: {personas: [{details: "Missing name"}]}},
        jar
    });
    assert.equal(invalidImport.status, 400);
    assert.match(invalidImport.json.errors[0], /missing a name/i);

    const duplicateImport = await request(server.baseUrl, "/imports/workspace", {
        method: "POST",
        body: {workspace: exported.json.workspace},
        jar
    });
    assert.equal(duplicateImport.status, 409);
    assert.match(duplicateImport.json.error, /duplicate/i);

    const workspace = {
        personas: [{name: "Imported Guide", persona_type: "assistant", details: "Imported"}],
        templates: [{name: "Imported Template", prompt_text: "Say hello"}],
        chats: [{
            title: "Imported Notes",
            memories: [{fact: "The imported chat remembers the old station."}],
            messages: [
                {role: "user", content: "Imported question"},
                {role: "assistant", content: "Imported answer"}
            ]
        }]
    };
    const preview = await request(server.baseUrl, "/imports/workspace/preview", {
        method: "POST",
        body: {workspace},
        jar
    });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.json.preview, {personas: 1, chats: 1, messages: 2, memories: 1, templates: 1, duplicates: []});

    const imported = await request(server.baseUrl, "/imports/workspace", {
        method: "POST",
        body: {workspace},
        jar
    });
    assert.equal(imported.status, 200);
    assert.deepEqual(imported.json.imported, {personas: 1, chats: 1, templates: 1});

    await server.close();
});

test("persona clone, version restore, and market feedback endpoints work", async () => {
    const server = await startTestServer();
    const jar = new CookieJar();

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "maker", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "maker", password: "password123"}, jar});

    const persona = await request(server.baseUrl, "/personas", {
        method: "POST",
        body: {personaType: "assistant", name: "Historian", details: "Original"},
        jar
    });
    const personaId = persona.json.persona.id;

    const clone = await request(server.baseUrl, `/personas/${personaId}/clone`, {method: "POST", body: {}, jar});
    assert.equal(clone.status, 200);
    assert.match(clone.json.persona.name, /copy/i);

    await request(server.baseUrl, `/personas/${personaId}`, {
        method: "PUT",
        body: {personaType: "assistant", name: "Historian", details: "Updated"},
        jar
    });
    const versions = await request(server.baseUrl, `/personas/${personaId}/versions`, {jar});
    assert.equal(versions.status, 200);
    assert.ok(versions.json.versions.length >= 1);

    const restoreTarget = versions.json.versions[0];
    const restored = await request(server.baseUrl, `/personas/${personaId}/versions/${restoreTarget.id}/restore`, {
        method: "POST",
        body: {},
        jar
    });
    assert.equal(restored.status, 200);

    const publish = await request(server.baseUrl, `/personas/${personaId}/publish`, {
        method: "POST",
        body: {tags: ["mentor", "history"]},
        jar
    });
    assert.equal(publish.status, 200);
    const marketId = publish.json.persona.id;

    const favorite = await request(server.baseUrl, `/personas/market/${marketId}/favorite`, {
        method: "POST",
        body: {},
        jar
    });
    assert.equal(favorite.status, 200);
    assert.equal(favorite.json.favorite, true);

    const rating = await request(server.baseUrl, `/personas/market/${marketId}/rate`, {
        method: "POST",
        body: {rating: 5},
        jar
    });
    assert.equal(rating.status, 200);
    assert.equal(rating.json.persona.rating_count, 1);

    await server.close();
});

test("market listing supports persona type filters, sorting, and favorite state", async () => {
    const server = await startTestServer();
    const creatorJar = new CookieJar();
    const fanJar = new CookieJar();
    const runnerJar = new CookieJar();

    await request(server.baseUrl, "/register", {method: "POST", body: {username: "creator2", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "creator2", password: "password123"}, jar: creatorJar});
    await request(server.baseUrl, "/register", {method: "POST", body: {username: "fan", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "fan", password: "password123"}, jar: fanJar});
    await request(server.baseUrl, "/register", {method: "POST", body: {username: "runner", password: "password123"}});
    await request(server.baseUrl, "/login", {method: "POST", body: {username: "runner", password: "password123"}, jar: runnerJar});

    const assistantOne = await request(server.baseUrl, "/personas", {
        method: "POST",
        body: {personaType: "assistant", name: "Archivist", details: "Keeps records"},
        jar: creatorJar
    });
    const assistantTwo = await request(server.baseUrl, "/personas", {
        method: "POST",
        body: {personaType: "assistant", name: "Pilot", details: "Fast paced"},
        jar: creatorJar
    });
    const userPersona = await request(server.baseUrl, "/personas", {
        method: "POST",
        body: {personaType: "user", name: "Scout", details: "Observant"},
        jar: creatorJar
    });

    const publishAssistantOne = await request(server.baseUrl, `/personas/${assistantOne.json.persona.id}/publish`, {
        method: "POST",
        body: {tags: ["lore"]},
        jar: creatorJar
    });
    const publishAssistantTwo = await request(server.baseUrl, `/personas/${assistantTwo.json.persona.id}/publish`, {
        method: "POST",
        body: {tags: ["action"]},
        jar: creatorJar
    });
    const publishUser = await request(server.baseUrl, `/personas/${userPersona.json.persona.id}/publish`, {
        method: "POST",
        body: {tags: ["identity"]},
        jar: creatorJar
    });

    const archivistMarketId = publishAssistantOne.json.persona.id;
    const pilotMarketId = publishAssistantTwo.json.persona.id;
    const scoutMarketId = publishUser.json.persona.id;

    await request(server.baseUrl, `/personas/market/${archivistMarketId}/favorite`, {
        method: "POST",
        body: {},
        jar: fanJar
    });
    await request(server.baseUrl, `/personas/market/${archivistMarketId}/favorite`, {
        method: "POST",
        body: {},
        jar: runnerJar
    });
    await request(server.baseUrl, `/personas/market/${archivistMarketId}/rate`, {
        method: "POST",
        body: {rating: 5},
        jar: fanJar
    });
    await request(server.baseUrl, `/personas/market/${pilotMarketId}/collect`, {
        method: "POST",
        body: {},
        jar: fanJar
    });
    await request(server.baseUrl, `/personas/market/${pilotMarketId}/chat`, {
        method: "POST",
        body: {},
        jar: runnerJar
    });

    const assistantsNewest = await request(server.baseUrl, "/personas/market?personaType=assistant&sort=newest", {jar: fanJar});
    assert.equal(assistantsNewest.status, 200);
    assert.deepEqual(assistantsNewest.json.personas.map((persona) => persona.name), ["Pilot", "Archivist"]);

    const assistantsFavorited = await request(server.baseUrl, "/personas/market?personaType=assistant&sort=most_favorited", {jar: fanJar});
    assert.equal(assistantsFavorited.status, 200);
    assert.equal(assistantsFavorited.json.personas[0].name, "Archivist");
    assert.equal(assistantsFavorited.json.personas[0].is_favorite, true);
    assert.equal(assistantsFavorited.json.personas[1].is_favorite, false);

    const assistantsPopular = await request(server.baseUrl, "/personas/market?personaType=assistant&sort=most_popular", {jar: fanJar});
    assert.equal(assistantsPopular.status, 200);
    assert.equal(assistantsPopular.json.personas[0].name, "Pilot");

    const userOnly = await request(server.baseUrl, "/personas/market?personaType=user&sort=best", {jar: fanJar});
    assert.equal(userOnly.status, 200);
    assert.deepEqual(userOnly.json.personas.map((persona) => persona.name), ["Scout"]);
    assert.equal(userOnly.json.personas[0].id, scoutMarketId);

    await server.close();
});

test("public pages, workspace guards, and legacy chat links have distinct destinations", async () => {
    const server = await startTestServer();
    try {
        for (const [url, marker] of [["/", "A space for every conversation."], ["/login", 'id="accountForm"'], ["/register", 'id="accountForm"'], ["/market", 'id="publicSearch"']]) {
            const response = await fetch(server.baseUrl + url);
            assert.equal(response.status, 200);
            const html = await response.text();
            assert.ok(html.includes(marker));
            assert.ok(!html.includes('id="chat"'));
        }
        for (const url of ["/app", "/app/personas", "/app/settings", "/app/chats/42", "/app/chats/new?prompt=hello"]) {
            const response = await fetch(server.baseUrl + url, {redirect: "manual"});
            assert.equal(response.status, 302);
            assert.equal(response.headers.get("location"), `/login?next=${encodeURIComponent(url)}`);
        }
        const legacy = await fetch(server.baseUrl + "/?chat=42", {redirect: "manual"});
        assert.equal(legacy.headers.get("location"), "/app/chats/42");
        const jar = new CookieJar();
        await request(server.baseUrl, "/register", {method: "POST", body: {username: "newvisitor", password: "password123"}, jar});
        const session = await request(server.baseUrl, "/session", {jar});
        assert.equal(session.json.user, "newvisitor", "registration signs in immediately");
        const home = await fetch(server.baseUrl + "/app", {headers: jar.headers()});
        assert.match(await home.text(), /What would you like to do/);
        const chat = await fetch(server.baseUrl + "/app/chats/new", {headers: jar.headers()});
        const html = await chat.text();
        assert.ok(html.includes('src="/script.js'));
        assert.ok(!html.includes('id="loginForm"'));
        assert.deepEqual((await request(server.baseUrl, "/chats", {jar})).json.chats, [], "home and chat pages do not create chats on GET");
        await request(server.baseUrl, "/logout", {method: "POST", body: {}, jar});
        assert.equal((await fetch(server.baseUrl + "/app", {headers: jar.headers(), redirect: "manual"})).status, 302);
    } finally { await server.close(); }
});

test("public discovery only exposes published persona summaries", async () => {
    const server = await startTestServer();
    try {
        const jar = new CookieJar();
        await request(server.baseUrl, "/register", {method: "POST", body: {username: "publicmaker", password: "password123"}, jar});
        const created = await request(server.baseUrl, "/personas", {method: "POST", body: {name: "Rainkeeper", background: "A guide to a rainy city", details: "Private implementation detail", personaType: "assistant"}, jar});
        const id = created.json.persona.id;
        assert.equal((await request(server.baseUrl, "/api/discover")).json.personas.length, 0);
        await request(server.baseUrl, `/personas/${id}/publish`, {method: "POST", body: {}, jar});
        const result = await request(server.baseUrl, "/api/discover");
        assert.equal(result.status, 200);
        assert.equal(result.json.personas[0].name, "Rainkeeper");
        assert.equal(result.json.personas[0].description, "A guide to a rainy city");
        assert.deepEqual(Object.keys(result.json.personas[0]).sort(), ["creator_username", "description", "id", "name", "persona_type"]);
    } finally { await server.close(); }
});

test("page headers share navigation and keep session markup private", async () => {
    const server = await startTestServer();
    try {
        const jar = new CookieJar();
        const username = '<maker&friend>';
        await request(server.baseUrl, "/register", {method: "POST", body: {username, password: "password123"}, jar});
        let sharedNavigation;
        for (const route of ["/", "/app", "/app/chats/new", "/app/personas", "/market", "/app/settings", "/privacy.html", "/tos.html"]) {
            const response = await fetch(server.baseUrl + route, {headers: jar.headers()});
            assert.equal(response.status, 200);
            assert.equal(response.headers.get("cache-control"), "private, no-store");
            const html = await response.text();
            assert.equal((html.match(/class="shell-header"/g) || []).length, 1);
            assert.ok(html.includes('&lt;maker&amp;friend&gt;'));
            assert.ok(!html.includes(username), "account names must be escaped in header markup");
            const navigation = html.match(/<nav class="shell-nav"[^>]*>(.*?)<\/nav>/s)[1].replace(/ aria-current="page"/g, "");
            if (sharedNavigation) assert.equal(navigation, sharedNavigation);
            sharedNavigation = navigation;
        }
        const guest = await fetch(server.baseUrl + "/");
        const html = await guest.text();
        assert.ok(!html.includes('&lt;maker&amp;friend&gt;'));
        assert.ok(html.includes('href="/login"'));
    } finally { await server.close(); }
});

test("frontend scripts and styles revalidate across deployments", async () => {
    const server = await startTestServer({config: {staticMaxAge: "1h"}});
    try {
        for (const asset of ["/script.js?v=20260909-account-controls", "/app/dom.js?v=20260909-account-controls", "/pages.css?v=20260909-account-controls"]) {
            const response = await fetch(server.baseUrl + asset);
            assert.equal(response.status, 200);
            assert.equal(response.headers.get("cache-control"), "no-cache");
            const etag = response.headers.get("etag");
            assert.ok(etag);
            await response.text();
        }
    } finally { await server.close(); }
});
