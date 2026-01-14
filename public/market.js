const marketPersonaList = document.getElementById("marketPersonaList");
const marketUserPersonaList = document.getElementById("marketUserPersonaList");
const refreshMarketBtn = document.getElementById("refreshMarket");
const marketStatus = document.getElementById("marketStatus");

async function request(url, data, method = "POST") {
    try {
        const res = await fetch(url, {
            method,
            headers: {"Content-Type": "application/json"},
            body: data ? JSON.stringify(data) : undefined
        });
        return await res.json();
    } catch (err) {
        return {error: "Network error — please try again."};
    }
}

async function post(url, data) {
    return request(url, data, "POST");
}

async function get(url) {
    try {
        const res = await fetch(url);
        return await res.json();
    } catch (err) {
        return {error: "Network error — please try again."};
    }
}

function setMarketStatus(message, state = "") {
    if (!marketStatus) return;
    marketStatus.textContent = message;
    marketStatus.className = state ? `status persona-status ${state}` : "status persona-status";
}

function buildPersonaMeta(persona) {
    const pronouns = persona.pronouns ? `Pronouns: ${persona.pronouns}` : "Pronouns: —";
    return `By ${persona.creator_username} • ${pronouns}`;
}

function renderMarketList(personaItems, listElement, personaType) {
    if (!listElement) return;
    listElement.innerHTML = "";
    if (!personaItems.length) {
        const empty = document.createElement("p");
        empty.className = "status persona-status";
        empty.textContent = personaType === "assistant"
            ? "No AI personas listed yet. Publish the first one!"
            : "No user personas listed yet. Publish the first one!";
        listElement.appendChild(empty);
        return;
    }
    personaItems.forEach(persona => {
        const item = document.createElement("div");
        item.className = "persona-item";

        const titleRow = document.createElement("div");
        titleRow.className = "persona-title-row";

        const title = document.createElement("h4");
        title.textContent = persona.name;

        const roleTag = document.createElement("span");
        roleTag.className = `persona-role-tag ${personaType === "assistant" ? "ai" : "user"}`;
        roleTag.textContent = personaType === "assistant" ? "AI" : "You";

        titleRow.appendChild(title);
        titleRow.appendChild(roleTag);

        const meta = document.createElement("p");
        meta.textContent = buildPersonaMeta(persona);

        const actions = document.createElement("div");
        actions.className = "persona-item-actions";

        const getBtn = document.createElement("button");
        getBtn.type = "button";
        getBtn.textContent = personaType === "assistant" ? "Get & equip as AI" : "Get & equip as You";
        getBtn.addEventListener("click", () => collectMarketPersona(persona.id, persona.persona_type));

        actions.appendChild(getBtn);
        item.appendChild(titleRow);
        item.appendChild(meta);
        item.appendChild(actions);
        listElement.appendChild(item);
    });
}

async function loadMarketPersonas() {
    setMarketStatus("Loading market personas...");
    const res = await get("/personas/market");
    if (res.error) {
        setMarketStatus(res.error, "error");
        return;
    }
    const marketPersonas = res.personas || [];
    const assistantMarket = marketPersonas.filter(persona => persona.persona_type === "assistant");
    const userMarket = marketPersonas.filter(persona => persona.persona_type === "user");
    renderMarketList(assistantMarket, marketPersonaList, "assistant");
    renderMarketList(userMarket, marketUserPersonaList, "user");
    setMarketStatus("Choose an AI persona or a user persona to equip.");
}

async function collectMarketPersona(marketId, personaType) {
    setMarketStatus(
        personaType === "assistant"
            ? "Equipping the AI persona..."
            : "Equipping the user persona..."
    );
    const res = await post(`/personas/market/${marketId}/collect`, {equip: true});
    if (res.error) {
        setMarketStatus(res.error, "error");
        return;
    }
    setMarketStatus(
        personaType === "assistant"
            ? "AI persona equipped. Head back to chat to use it."
            : "User persona equipped. Head back to chat to use it.",
        "success"
    );
}

if (refreshMarketBtn) {
    refreshMarketBtn.addEventListener("click", () => loadMarketPersonas());
}

window.addEventListener("load", () => {
    loadMarketPersonas();
});
