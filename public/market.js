const $ = (id) => document.getElementById(id);
const marketPersonaList = $("marketPersonaList"), marketUserPersonaList = $("marketUserPersonaList");
const refreshMarketBtn = $("refreshMarket"), marketStatus = $("marketStatus"), marketSearchInput = $("marketSearch");
const marketPreviewModal = $("marketPreviewModal"), marketPreviewName = $("marketPreviewName"), marketPreviewMeta = $("marketPreviewMeta");
const marketPreviewPronouns = $("marketPreviewPronouns"), marketPreviewAppearance = $("marketPreviewAppearance"), marketPreviewBackground = $("marketPreviewBackground"), marketPreviewDetails = $("marketPreviewDetails");
const marketPreviewConfirm = $("marketPreviewConfirm"), marketPreviewCancel = $("marketPreviewCancel"), marketPreviewClose = $("marketPreviewClose");
const themeNameTargets = document.querySelectorAll("[data-theme-name]");
let allMarketPersonas = [], pendingMarketPersona = null;

const themes = {
    "fakegpt": {name: "FakeGPT"},
    "fraud": {name: "Fraud"},
    "germini": {name: "Germini"},
    "slopilot": {name: "Slopilot"},
    "beta-ai": {name: "Beta AI"},
    "confusity": {name: "Confusity"}
};

async function request(url, data, method = "POST") {
    try {
        const res = await fetch(url, {method, headers: {"Content-Type": "application/json"}, body: data ? JSON.stringify(data) : undefined});
        return await res.json();
    } catch {
        return {error: "Network error - please try again."};
    }
}

const get = (url) => request(url, null, "GET");
const post = (url, data) => request(url, data, "POST");

function applyTheme(themeKey) {
    const nextTheme = themes[themeKey] ? themeKey : "fakegpt";
    document.body.dataset.theme = nextTheme;
    document.title = `${themes[nextTheme].name} Market`;
    themeNameTargets.forEach((target) => { target.textContent = themes[nextTheme].name; });
}

function setMarketStatus(message, state = "") {
    marketStatus.textContent = message;
    marketStatus.className = state ? `status persona-status ${state}` : "status persona-status";
}

function buildPersonaMeta(persona) {
    const pronouns = persona.pronouns ? `Pronouns: ${persona.pronouns}` : "Pronouns: n/a";
    return `${persona.creator_username} | ${pronouns}`;
}

function formatPersonaField(value) {
    return value && value.trim() ? value.trim() : "Not provided.";
}

function closeMarketPreview() {
    marketPreviewModal.classList.add("hidden");
    pendingMarketPersona = null;
}

function renderMarketList(items, listElement, type) {
    listElement.innerHTML = "";
    if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "status persona-status";
        empty.textContent = type === "assistant" ? "No AI personas found." : "No user personas found.";
        listElement.appendChild(empty);
        return;
    }

    items.forEach((persona) => {
        const item = document.createElement("div");
        const titleRow = document.createElement("div");
        const title = document.createElement("h4");
        const tag = document.createElement("span");
        const meta = document.createElement("p");
        const actions = document.createElement("div");
        const detailsBtn = document.createElement("button");

        item.className = "persona-item";
        titleRow.className = "persona-title-row";
        actions.className = "persona-item-actions";
        tag.className = `persona-role-tag ${type === "assistant" ? "ai" : "user"}`;
        tag.textContent = type === "assistant" ? "AI" : "You";
        title.textContent = persona.name;
        meta.textContent = buildPersonaMeta(persona);
        detailsBtn.type = "button";
        detailsBtn.textContent = "View";
        detailsBtn.addEventListener("click", () => openMarketPreview(persona));

        titleRow.append(title, tag);
        actions.appendChild(detailsBtn);
        item.append(titleRow, meta, actions);
        listElement.appendChild(item);
    });
}

function filterMarketPersonas() {
    const query = marketSearchInput.value.trim().toLowerCase();
    if (!query) return allMarketPersonas;
    return allMarketPersonas.filter((persona) =>
        [persona.name, persona.creator_username, persona.pronouns, persona.appearance, persona.background, persona.details]
            .some((field) => field && field.toLowerCase().includes(query))
    );
}

function applyMarketFilter() {
    const filtered = filterMarketPersonas();
    renderMarketList(filtered.filter((persona) => persona.persona_type === "assistant"), marketPersonaList, "assistant");
    renderMarketList(filtered.filter((persona) => persona.persona_type === "user"), marketUserPersonaList, "user");
    if (marketSearchInput.value.trim() && !filtered.length) {
        setMarketStatus("No personas match your search.", "error");
        return;
    }
    setMarketStatus(`${filtered.length} persona${filtered.length === 1 ? "" : "s"} shown.`);
}

function openMarketPreview(persona) {
    pendingMarketPersona = persona;
    marketPreviewName.textContent = persona.name;
    marketPreviewMeta.textContent = buildPersonaMeta(persona);
    marketPreviewPronouns.textContent = formatPersonaField(persona.pronouns);
    marketPreviewAppearance.textContent = formatPersonaField(persona.appearance);
    marketPreviewBackground.textContent = formatPersonaField(persona.background);
    marketPreviewDetails.textContent = formatPersonaField(persona.details);
    marketPreviewConfirm.textContent = persona.persona_type === "assistant" ? "Collect as AI persona" : "Collect as user persona";
    marketPreviewModal.classList.remove("hidden");
}

async function loadMarketPersonas() {
    setMarketStatus("Loading market personas...");
    const res = await get("/personas/market");
    if (res.error) return setMarketStatus(res.error, "error");
    allMarketPersonas = res.personas || [];
    applyMarketFilter();
}

async function collectMarketPersona(marketId, personaType) {
    setMarketStatus(personaType === "assistant" ? "Collecting AI persona..." : "Collecting user persona...");
    const res = await post(`/personas/market/${marketId}/collect`, {equip: true});
    if (res.error) return setMarketStatus(res.error, "error");
    await loadMarketPersonas();
    setMarketStatus(personaType === "assistant" ? "AI persona collected." : "User persona collected.", "success");
}

refreshMarketBtn.addEventListener("click", loadMarketPersonas);
marketSearchInput.addEventListener("input", applyMarketFilter);
marketPreviewCancel.addEventListener("click", closeMarketPreview);
marketPreviewClose.addEventListener("click", closeMarketPreview);
marketPreviewModal.addEventListener("click", (event) => { if (event.target === marketPreviewModal) closeMarketPreview(); });
marketPreviewConfirm.addEventListener("click", async () => {
    if (!pendingMarketPersona) return;
    const {id, persona_type} = pendingMarketPersona;
    closeMarketPreview();
    await collectMarketPersona(id, persona_type);
});

window.addEventListener("load", () => {
    applyTheme(localStorage.getItem("krishd-theme") || "fakegpt");
    loadMarketPersonas();
});
