import {execFile} from "child_process";

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
    let lastHealth = {ok: true, checkedAt: null, error: null, latencyMs: null};
    let lastFailure = null;
    let lastListLatencyMs = null;
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
            execFile("ollama", ["stop", model], () => {
                modelState.delete(model);
            });
        }, config.modelUnloadAfterMs);
    };

    const withTimeout = async (timeoutMs, callback, externalSignal = null) => {
        const controller = new AbortController();
        let timedOut = false;
        const abortFromCaller = () => controller.abort(externalSignal?.reason);
        if (externalSignal?.aborted) abortFromCaller();
        else externalSignal?.addEventListener("abort", abortFromCaller, {once: true});
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        try {
            return await callback(controller.signal);
        } catch (error) {
            if (error?.name === "AbortError") {
                if (!timedOut && externalSignal?.aborted) {
                    throw new ModelServiceError("MODEL_CANCELLED", "Model request was cancelled.", 499);
                }
                throw new ModelServiceError("MODEL_TIMEOUT", "Model backend timed out.", 504);
            }
            throw error;
        } finally {
            clearTimeout(timer);
            externalSignal?.removeEventListener("abort", abortFromCaller);
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

    const buildRequestBody = (model, messagesPayload, generation = {}) => {
        const options = {};
        if (generation.temperature != null) options.temperature = generation.temperature;
        if (generation.contextLength != null) options.num_ctx = generation.contextLength;
        if (generation.responseLength != null) options.num_predict = generation.responseLength;
        return {
            model,
            messages: messagesPayload,
            stream: true,
            ...(Object.keys(options).length ? {options} : {})
        };
    };

    return {
        async generateReply(model, messagesPayload, options = {}) {
            const state = ensureModelState(model);
            state.activeRequests += 1;

            try {
                const startedAt = Date.now();
                const fullReply = await withTimeout(config.modelRequestTimeoutMs, async (signal) => {
                    const response = await fetchImpl(`${config.modelApiBaseUrl}/chat`, {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify(buildRequestBody(model, messagesPayload, options.generation)),
                        signal
                    });

                    if (!response.ok) {
                        throw new ModelServiceError("MODEL_UPSTREAM_ERROR", `Model backend returned ${response.status}.`, 502);
                    }

                    return readStreamingReply(response);
                }, options.signal);
                lastHealth = {ok: true, checkedAt: new Date().toISOString(), error: null, latencyMs: Date.now() - startedAt};
                return fullReply;
            } catch (error) {
                const failure = error instanceof ModelServiceError ? error.message : "Model backend unavailable.";
                lastHealth = {
                    ok: false,
                    checkedAt: new Date().toISOString(),
                    error: failure,
                    latencyMs: null
                };
                lastFailure = {at: lastHealth.checkedAt, error: failure};
                if (error instanceof ModelServiceError) throw error;
                throw new ModelServiceError("MODEL_UNAVAILABLE", "Model backend unavailable.", 502);
            } finally {
                state.activeRequests = Math.max(0, state.activeRequests - 1);
                scheduleModelUnload(model);
            }
        },
        async streamReply(model, messagesPayload, onChunk, options = {}) {
            const state = ensureModelState(model);
            state.activeRequests += 1;

            try {
                const startedAt = Date.now();
                const fullReply = await withTimeout(config.modelRequestTimeoutMs, async (signal) => {
                    const response = await fetchImpl(`${config.modelApiBaseUrl}/chat`, {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify(buildRequestBody(model, messagesPayload, options.generation)),
                        signal
                    });

                    if (!response.ok) {
                        throw new ModelServiceError("MODEL_UPSTREAM_ERROR", `Model backend returned ${response.status}.`, 502);
                    }

                    return readStreamingReply(response, onChunk);
                }, options.signal);
                lastHealth = {ok: true, checkedAt: new Date().toISOString(), error: null, latencyMs: Date.now() - startedAt};
                return fullReply;
            } catch (error) {
                const failure = error instanceof ModelServiceError ? error.message : "Model backend unavailable.";
                lastHealth = {
                    ok: false,
                    checkedAt: new Date().toISOString(),
                    error: failure,
                    latencyMs: null
                };
                lastFailure = {at: lastHealth.checkedAt, error: failure};
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
                const startedAt = Date.now();
                modelsCache = await withTimeout(config.modelListTimeoutMs, async (signal) => {
                    const response = await fetchImpl(`${config.modelApiBaseUrl}/tags`, {signal});
                    if (!response.ok) {
                        throw new ModelServiceError("MODEL_LIST_FAILED", "Failed to load models.", 502);
                    }
                    return response.json();
                });
                lastListLatencyMs = Date.now() - startedAt;
                modelsCacheAt = Date.now();
                lastHealth = {ok: true, checkedAt: new Date().toISOString(), error: null, latencyMs: lastListLatencyMs};
                return modelsCache;
            } catch (error) {
                const failure = error instanceof ModelServiceError ? error.message : "Failed to load models.";
                lastHealth = {
                    ok: false,
                    checkedAt: new Date().toISOString(),
                    error: failure,
                    latencyMs: null
                };
                lastFailure = {at: lastHealth.checkedAt, error: failure};
                if (error instanceof ModelServiceError) throw error;
                throw new ModelServiceError("MODEL_UNAVAILABLE", "Failed to load models.", 502);
            }
        },
        async checkHealth() {
            const startedAt = Date.now();
            try {
                await this.listModels();
                const health = {ok: true, checkedAt: new Date().toISOString(), error: null, latencyMs: Date.now() - startedAt};
                lastHealth = health;
                return health;
            } catch (error) {
                const health = {ok: false, checkedAt: new Date().toISOString(), error: error.message, latencyMs: null};
                lastHealth = health;
                lastFailure = {at: health.checkedAt, error: error.message};
                return health;
            }
        },
        getLastHealth() {
            return lastHealth;
        },
        async getDiagnostics() {
            const model = await this.checkHealth();
            const models = Array.isArray(modelsCache?.models) ? modelsCache.models : [];
            return {
                model: {
                    ...model,
                    backendUrl: config.modelApiBaseUrl,
                    availableModels: models.map((item) => item.name).filter(Boolean),
                    modelCount: models.length,
                    listLatencyMs: lastListLatencyMs,
                    cacheAgeMs: modelsCacheAt ? Date.now() - modelsCacheAt : null,
                    lastFailure,
                    activeRequests: Array.from(modelState.entries()).map(([name, state]) => ({
                        name,
                        activeRequests: state.activeRequests
                    }))
                }
            };
        },
        mapError(error) {
            if (error instanceof ModelServiceError) {
                return {status: error.status, body: {error: error.message, code: error.code}};
            }
            return {status: 500, body: {error: "Model request failed", code: "MODEL_UNKNOWN"}};
        }
    };
}
