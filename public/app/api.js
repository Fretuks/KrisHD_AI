export async function request(url, data, method = "POST") {
    try {
        const res = await fetch(url, {
            method,
            credentials: "same-origin",
            headers: {"Content-Type": "application/json"},
            body: data ? JSON.stringify(data) : undefined
        });
        return await res.json();
    } catch {
        return {error: "Network error - please try again."};
    }
}

export const get = (url) => request(url, null, "GET");
export const post = (url, data) => request(url, data, "POST");
export const put = (url, data) => request(url, data, "PUT");
export const del = (url) => request(url, null, "DELETE");

export async function stream(url, data, handlers = {}) {
    const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data || {})
    });

    if (!response.ok || !response.body) {
        let error = "Streaming request failed";
        try {
            const payload = await response.json();
            error = payload.error || error;
        } catch {
            // Keep the generic error if the server did not send JSON.
        }
        if (handlers.onError) {
            handlers.onError({error});
            return;
        }
        throw new Error(error);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
            const lines = part.split("\n");
            const eventLine = lines.find((line) => line.startsWith("event:"));
            const dataLine = lines.find((line) => line.startsWith("data:"));
            if (!eventLine || !dataLine) continue;
            const event = eventLine.slice(6).trim();
            const payload = JSON.parse(dataLine.slice(5).trim());
            if (event === "chunk" && handlers.onChunk) handlers.onChunk(payload);
            if (event === "done" && handlers.onDone) handlers.onDone(payload);
            if (event === "error" && handlers.onError) handlers.onError(payload);
        }
    }
}
