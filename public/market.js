const marketPersonaList = document.getElementById("marketPersonaList");
const marketUserPersonaList = document.getElementById("marketUserPersonaList");
const refreshMarketBtn = document.getElementById("refreshMarket");
const marketStatus = document.getElementById("marketStatus");
const marketSearchInput = document.getElementById("marketSearch");
const marketPreviewModal = document.getElementById("marketPreviewModal");
const marketPreviewName = document.getElementById("marketPreviewName");
const marketPreviewMeta = document.getElementById("marketPreviewMeta");
const marketPreviewPronouns = document.getElementById("marketPreviewPronouns");
const marketPreviewAppearance = document.getElementById("marketPreviewAppearance");
const marketPreviewBackground = document.getElementById("marketPreviewBackground");
const marketPreviewDetails = document.getElementById("marketPreviewDetails");
const marketPreviewConfirm = document.getElementById("marketPreviewConfirm");
const marketPreviewCancel = document.getElementById("marketPreviewCancel");
const marketPreviewClose = document.getElementById("marketPreviewClose");
let allMarketPersonas = [];
let pendingMarketPersona = null;

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
    const usageCount = Number(persona.usage_count || 0);
    const usageLabel = `Used ${usageCount} ${usageCount === 1 ? "time" : "times"}`;
    return `By ${persona.creator_username} • ${pronouns} • ${usageLabel}`;
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
        getBtn.textContent = "View details";
        getBtn.addEventListener("click", () => openMarketPreview(persona));

        actions.appendChild(getBtn);
        item.appendChild(titleRow);
        item.appendChild(meta);
        item.appendChild(actions);
        listElement.appendChild(item);
    });
}

function formatPersonaField(value) {
    return value && value.trim() ? value.trim() : "Not provided.";
}

function openMarketPreview(persona) {
    if (!marketPreviewModal) return;
    pendingMarketPersona = persona;
    marketPreviewName.textContent = persona.name;
    marketPreviewMeta.textContent = buildPersonaMeta(persona);
    marketPreviewPronouns.textContent = formatPersonaField(persona.pronouns);
    marketPreviewAppearance.textContent = formatPersonaField(persona.appearance);
    marketPreviewBackground.textContent = formatPersonaField(persona.background);
    marketPreviewDetails.textContent = formatPersonaField(persona.details);
    marketPreviewConfirm.textContent =
        persona.persona_type === "assistant" ? "Get & equip as AI" : "Get & equip as You";
    marketPreviewModal.classList.remove("hidden");
}

function closeMarketPreview() {
    if (!marketPreviewModal) return;
    marketPreviewModal.classList.add("hidden");
    pendingMarketPersona = null;
}

function filterMarketPersonas() {
    const query = marketSearchInput?.value.trim().toLowerCase() || "";
    if (!query) return allMarketPersonas;
    return allMarketPersonas.filter(persona => {
        const fields = [
            persona.name,
            persona.creator_username,
            persona.pronouns,
            persona.appearance,
            persona.background,
            persona.details
        ];
        return fields.some(field => field && field.toLowerCase().includes(query));
    });
}

function applyMarketFilter() {
    const filtered = filterMarketPersonas();
    const assistantMarket = filtered.filter(persona => persona.persona_type === "assistant");
    const userMarket = filtered.filter(persona => persona.persona_type === "user");
    renderMarketList(assistantMarket, marketPersonaList, "assistant");
    renderMarketList(userMarket, marketUserPersonaList, "user");
    if (marketSearchInput?.value.trim() && !filtered.length) {
        setMarketStatus("No personas match your search.", "error");
        return;
    }
    setMarketStatus("Choose an AI persona or a user persona to equip.");
}

async function loadMarketPersonas() {
    setMarketStatus("Loading market personas...");
    const res = await get("/personas/market");
    if (res.error) {
        setMarketStatus(res.error, "error");
        return;
    }
    allMarketPersonas = res.personas || [];
    applyMarketFilter();
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
    await loadMarketPersonas();
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

if (marketSearchInput) {
    marketSearchInput.addEventListener("input", () => applyMarketFilter());
}

if (marketPreviewCancel) {
    marketPreviewCancel.addEventListener("click", closeMarketPreview);
}

if (marketPreviewClose) {
    marketPreviewClose.addEventListener("click", closeMarketPreview);
}

if (marketPreviewModal) {
    marketPreviewModal.addEventListener("click", (event) => {
        if (event.target === marketPreviewModal) {
            closeMarketPreview();
        }
    });
}

if (marketPreviewConfirm) {
    marketPreviewConfirm.addEventListener("click", async () => {
        if (!pendingMarketPersona) return;
        const {id, persona_type} = pendingMarketPersona;
        closeMarketPreview();
        await collectMarketPersona(id, persona_type);
    });
}

window.addEventListener("load", () => {
    loadMarketPersonas();
});
