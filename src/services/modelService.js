import {exec} from "child_process";

class ModelServiceError extends Error {
    constructor(code, message, status = 500) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

export function createModelService(config, overrides = {}) {
    const modelState = new Map();
    let modelsCache = null;
    let modelsCacheAt = 0;
    let lastHealth = {ok: true, checkedAt: null, error: null};
    const fetchImpl = overrides.fetch || global.fetch;

    const ensureModelState = (model) => {
        if (!modelState.has(model)) {
            modelState.set(model, {activeRequests: 0, timer: null});
        }
        return modelState.get(model);
    };

    const scheduleModelUnload = (model) => {
        const state = ensureModelState(model);
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => {
            if (state.activeRequests > 0) return;
            exec(`ollama stop ${model}`, () => {
                modelState.delete(model);
            });
        }, config.modelUnloadAfterMs);
    };

    const withTimeout = async (timeoutMs, callback) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await callback(controller.signal);
        } catch (error) {
            if (error?.name === "AbortError") {
                throw new ModelServiceError("MODEL_TIMEOUT", "Model backend timed out.", 504);
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    };

    const readStreamingReply = async (response, onChunk = null) => {
        if (!response.body) {
            throw new ModelServiceError("MODEL_BAD_RESPONSE", "Model backend returned no body.", 502);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullReply = "";

        while (true) {
            const {value, done} = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, {stream: true});
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const data = JSON.parse(trimmed);
                if (data.message?.content) {
                    fullReply += data.message.content;
                    if (onChunk) onChunk(data.message.content, fullReply);
                }
            }
        }

        if (buffer.trim()) {
            const data = JSON.parse(buffer.trim());
            if (data.message?.content) {
                fullReply += data.message.content;
                if (onChunk) onChunk(data.message.content, fullReply);
            }
        }

        return fullReply.trim();
    };

    return {
        async generateReply(model, messagesPayload) {
            const state = ensureModelState(model);
            state.activeRequests += 1;

            try {
                const response = await withTimeout(config.modelRequestTimeoutMs, (signal) => fetchImpl(`${config.modelApiBaseUrl}/chat`, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({model, messages: messagesPayload, stream: true}),
                    signal
                }));

                if (!response.ok) {
                    throw new ModelServiceError("MODEL_UPSTREAM_ERROR", `Model backend returned ${response.status}.`, 502);
                }

                const fullReply = await readStreamingReply(response);
                lastHealth = {ok: true, checkedAt: new Date().toISOString(), error: null};
                return fullReply;
            } catch (error) {
                lastHealth = {
                    ok: false,
                    checkedAt: new Date().toISOString(),
                    error: error instanceof ModelServiceError ? error.message : "Model backend unavailable."
                };
                if (error instanceof ModelServiceError) throw error;
                throw new ModelServiceError("MODEL_UNAVAILABLE", "Model backend unavailable.", 502);
            } finally {
                state.activeRequests = Math.max(0, state.activeRequests - 1);
                scheduleModelUnload(model);
            }
        },
        async streamReply(model, messagesPayload, onChunk) {
            const state = ensureModelState(model);
            state.activeRequests += 1;

            try {
                const response = await withTimeout(config.modelRequestTimeoutMs, (signal) => fetchImpl(`${config.modelApiBaseUrl}/chat`, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({model, messages: messagesPayload, stream: true}),
                    signal
                }));

                if (!response.ok) {
                    throw new ModelServiceError("MODEL_UPSTREAM_ERROR", `Model backend returned ${response.status}.`, 502);
                }

                const fullReply = await readStreamingReply(response, onChunk);
                lastHealth = {ok: true, checkedAt: new Date().toISOString(), error: null};
                return fullReply;
            } catch (error) {
                lastHealth = {
                    ok: false,
                    checkedAt: new Date().toISOString(),
                    error: error instanceof ModelServiceError ? error.message : "Model backend unavailable."
                };
                if (error instanceof ModelServiceError) throw error;
                throw new ModelServiceError("MODEL_UNAVAILABLE", "Model backend unavailable.", 502);
            } finally {
                state.activeRequests = Math.max(0, state.activeRequests - 1);
                scheduleModelUnload(model);
            }
        },
        async listModels() {
            if (modelsCache && Date.now() - modelsCacheAt < config.modelsCacheTtlMs) {
                return modelsCache;
            }

            try {
                const response = await withTimeout(config.modelListTimeoutMs, (signal) => fetchImpl(`${config.modelApiBaseUrl}/tags`, {signal}));
                if (!response.ok) {
                    throw new ModelServiceError("MODEL_LIST_FAILED", "Failed to load models.", 502);
                }
                modelsCache = await response.json();
                modelsCacheAt = Date.now();
                lastHealth = {ok: true, checkedAt: new Date().toISOString(), error: null};
                return modelsCache;
            } catch (error) {
                lastHealth = {
                    ok: false,
                    checkedAt: new Date().toISOString(),
                    error: error instanceof ModelServiceError ? error.message : "Failed to load models."
                };
                if (error instanceof ModelServiceError) throw error;
                throw new ModelServiceError("MODEL_UNAVAILABLE", "Failed to load models.", 502);
            }
        },
        async checkHealth() {
            try {
                await this.listModels();
                return {ok: true, checkedAt: new Date().toISOString(), error: null};
            } catch (error) {
                return {ok: false, checkedAt: new Date().toISOString(), error: error.message};
            }
        },
        getLastHealth() {
            return lastHealth;
        },
        mapError(error) {
            if (error instanceof ModelServiceError) {
                return {status: error.status, body: {error: error.message, code: error.code}};
            }
            return {status: 500, body: {error: "Model request failed", code: "MODEL_UNKNOWN"}};
        }
    };
}
