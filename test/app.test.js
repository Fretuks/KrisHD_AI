import test from "node:test";
import assert from "node:assert/strict";
import {createApp} from "../src/app.js";

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

async function startTestServer() {
    let replyCount = 0;
    const modelService = {
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
        mapError(error) {
            return {status: 500, body: {error: error.message, code: "TEST_MODEL"}};
        }
    };

    const app = createApp({
        config: {
            port: 0,
            dbPath: ":memory:",
            testMode: true,
            sessionSecret: "test-secret"
        },
        modelService
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
