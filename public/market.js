const $ = (id) => document.getElementById(id);
const marketPersonaList = $("marketPersonaList");
const marketUserPersonaList = $("marketUserPersonaList");
const refreshMarketBtn = $("refreshMarket");
const marketStatus = $("marketStatus");
const marketSearchInput = $("marketSearch");
const marketAssistantSort = $("marketAssistantSort");
const marketUserSort = $("marketUserSort");
const marketViewButtons = document.querySelectorAll("[data-market-view]");
const marketPanels = document.querySelectorAll("[data-market-panel]");
const marketCreateAiCharacterBtn = $("marketCreateAiCharacter");
const marketCreateUserPersonaBtn = $("marketCreateUserPersona");
const marketPreviewModal = $("marketPreviewModal");
const marketPreviewTitle = $("marketPreviewTitle");
const marketPreviewName = $("marketPreviewName");
const marketPreviewMeta = $("marketPreviewMeta");
const marketPreviewBody = $("marketPreviewBody");
const marketPreviewPronouns = $("marketPreviewPronouns");
const marketPreviewAppearance = $("marketPreviewAppearance");
const marketPreviewBackground = $("marketPreviewBackground");
const marketPreviewDetails = $("marketPreviewDetails");
const marketPreviewExampleDialogues = $("marketPreviewExampleDialogues");
const marketPreviewIntro = $("marketPreviewIntro");
const marketPreviewUserPersonaField = $("marketPreviewUserPersonaField");
const marketPreviewUserPersonaSelect = $("marketPreviewUserPersonaSelect");
const marketPreviewScenarioField = $("marketPreviewScenarioField");
const marketPreviewScenario = $("marketPreviewScenario");
const marketPreviewStepOne = $("marketPreviewStepOne");
const marketPreviewStepTwo = $("marketPreviewStepTwo");
const marketPreviewConfirm = $("marketPreviewConfirm");
const marketPreviewClose = $("marketPreviewClose");
const marketPersonaModal = $("marketPersonaModal");
const marketPersonaClose = $("marketPersonaClose");
const marketPersonaForm = $("marketPersonaForm");
const marketPersonaFormTitle = $("marketPersonaFormTitle");
const marketPersonaFormNotice = $("marketPersonaFormNotice");
const marketPersonaName = $("marketPersonaName");
const marketPersonaPronouns = $("marketPersonaPronouns");
const marketPersonaAppearance = $("marketPersonaAppearance");
const marketPersonaBackground = $("marketPersonaBackground");
const marketPersonaDetails = $("marketPersonaDetails");
const marketPersonaExampleDialogues = $("marketPersonaExampleDialogues");
const marketActivityOverlay = $("marketActivityOverlay");
const marketActivityEyebrow = $("marketActivityEyebrow");
const marketActivityTitle = $("marketActivityTitle");
const marketActivityDetail = $("marketActivityDetail");
const marketPopupModal = $("marketPopupModal");
const marketPopupClose = $("marketPopupClose");
const marketPopupCancel = $("marketPopupCancel");
const marketPopupConfirm = $("marketPopupConfirm");
const marketPopupTitle = $("marketPopupTitle");
const marketPopupEyebrow = $("marketPopupEyebrow");
const marketPopupDescription = $("marketPopupDescription");
const marketPopupField = $("marketPopupField");
const marketPopupInputLabel = $("marketPopupInputLabel");
const marketPopupInput = $("marketPopupInput");
const themeNameTargets = document.querySelectorAll("[data-theme-name]");

const themes = {
    "fakegpt": {name: "FakeGPT"},
    "fraud": {name: "Fraud"},
    "germini": {name: "Germini"},
    "slopilot": {name: "Slopilot"},
    "beta-ai": {name: "Beta AI"},
    "confusity": {name: "Confusity"}
};

const validMarketSorts = new Set(["best", "newest", "most_favorited", "most_popular", "top_rated", "alphabetical"]);
let marketPersonasByType = {assistant: [], user: []};
let assistantPersonas = [];
let userPersonas = [];
let pendingMarketPersona = null;
let editingPersonaId = null;
let activeUserPersonaId = null;
let activeMarketView = "ai-characters";
let marketSorts = {assistant: "best", user: "best"};
let marketActivityDepth = 0;
let marketPreviewStep = 1;
let marketPopupResolver = null;

async function request(url, data, method = "POST") {
    try {
        const res = await fetch(url, {
            method,
            headers: {"Content-Type": "application/json"},
            body: data ? JSON.stringify(data) : undefined
        });
        return await res.json();
    } catch {
        return {error: "Network error - please try again."};
    }
}

const get = (url) => request(url, null, "GET");
const post = (url, data) => request(url, data, "POST");
const put = (url, data) => request(url, data, "PUT");

function applyTheme(themeKey) {
    const nextTheme = themes[themeKey] ? themeKey : "fakegpt";
    document.body.dataset.theme = nextTheme;
    document.title = `${themes[nextTheme].name} Market`;
    themeNameTargets.forEach((target) => {
        target.textContent = themes[nextTheme].name;
    });
}

function setMarketStatus(message, state = "") {
    marketStatus.textContent = message;
    marketStatus.className = state ? `status persona-status ${state}` : "status persona-status";
}

function closeMarketPopup(value = null) {
    marketPopupModal.classList.add("hidden");
    if (marketPopupResolver) {
        const resolve = marketPopupResolver;
        marketPopupResolver = null;
        resolve(value);
    }
}

function promptMarketPopup({
    eyebrow = "Action",
    title = "Enter a value",
    description = "",
    label = "Value",
    value = "",
    placeholder = "",
    confirmLabel = "Confirm"
} = {}) {
    marketPopupEyebrow.textContent = eyebrow;
    marketPopupTitle.textContent = title;
    marketPopupDescription.textContent = description;
    marketPopupInputLabel.textContent = label;
    marketPopupInput.value = value;
    marketPopupInput.placeholder = placeholder;
    marketPopupConfirm.textContent = confirmLabel;
    marketPopupField.classList.remove("hidden");
    marketPopupModal.classList.remove("hidden");
    marketPopupInput.focus();
    marketPopupInput.select();
    return new Promise((resolve) => {
        marketPopupResolver = resolve;
    });
}

function setPersonaFormNotice(message = "", state = "") {
    if (!message) {
        marketPersonaFormNotice.textContent = "";
        marketPersonaFormNotice.className = "status hidden";
        return;
    }
    marketPersonaFormNotice.textContent = message;
    marketPersonaFormNotice.className = state ? `status ${state}` : "status";
}

function setMarketActivity(active, {
    eyebrow = "Please wait",
    title = "Opening roleplay",
    detail = "The AI character is preparing the first message."
} = {}) {
    if (!marketActivityOverlay || !marketActivityEyebrow || !marketActivityTitle || !marketActivityDetail) return;
    if (active) {
        marketActivityDepth += 1;
        marketActivityEyebrow.textContent = eyebrow;
        marketActivityTitle.textContent = title;
        marketActivityDetail.textContent = detail;
        marketActivityOverlay.classList.remove("hidden");
        return;
    }
    marketActivityDepth = Math.max(0, marketActivityDepth - 1);
    if (marketActivityDepth === 0) {
        marketActivityOverlay.classList.add("hidden");
        marketActivityEyebrow.textContent = "Please wait";
        marketActivityTitle.textContent = "Opening roleplay";
        marketActivityDetail.textContent = "The AI character is preparing the first message.";
    }
}

function setMarketView(view) {
    const normalizedView = view === "user-personas" ? "user-personas" : "ai-characters";
    activeMarketView = normalizedView;
    marketViewButtons.forEach((item) => item.classList.toggle("active", item.dataset.marketView === normalizedView));
    marketPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.marketPanel === normalizedView));
    syncMarketQuery();
    applyMarketFilter();
}

function normalizeMarketSort(sort) {
    const normalized = String(sort || "best").trim().toLowerCase().replace(/-/g, "_");
    return validMarketSorts.has(normalized) ? normalized : "best";
}

function syncMarketQuery() {
    const params = new URLSearchParams(window.location.search);
    params.set("view", activeMarketView);
    params.set("assistantSort", marketSorts.assistant);
    params.set("userSort", marketSorts.user);
    history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function setMarketSort(personaType, sort, {reload = true} = {}) {
    const normalizedType = personaType === "user" ? "user" : "assistant";
    const normalizedSort = normalizeMarketSort(sort);
    marketSorts[normalizedType] = normalizedSort;
    if (normalizedType === "assistant" && marketAssistantSort) marketAssistantSort.value = normalizedSort;
    if (normalizedType === "user" && marketUserSort) marketUserSort.value = normalizedSort;
    syncMarketQuery();
    if (reload) {
        void loadMarketPersonas();
    }
}

function buildPersonaMeta(persona) {
    const creator = persona.creator_username || "You";
    const pronouns = persona.pronouns ? `Pronouns: ${persona.pronouns}` : "Pronouns: n/a";
    return `${creator} | ${pronouns}`;
}

function formatPersonaField(value) {
    return value && value.trim() ? value.trim() : "Not provided.";
}

function setCollapsiblePreviewText(element, value, maxLength = 220) {
    const text = formatPersonaField(value);
    element.dataset.fullText = text;
    let toggle = element.nextElementSibling;
    if (!toggle || !toggle.classList.contains("market-preview-toggle")) {
        toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "market-preview-toggle hidden";
        element.insertAdjacentElement("afterend", toggle);
        toggle.addEventListener("click", () => {
            const isExpanded = element.dataset.expanded === "true";
            element.dataset.expanded = isExpanded ? "false" : "true";
            if (element.dataset.expanded === "true") {
                element.textContent = element.dataset.fullText;
                toggle.textContent = "Show less";
            } else {
                element.textContent = `${element.dataset.fullText.slice(0, maxLength).trimEnd()}...`;
                toggle.textContent = "Show more";
            }
        });
    }

    const shouldCollapse = text !== "Not provided." && text.length > maxLength;
    element.dataset.expanded = "false";
    if (shouldCollapse) {
        element.textContent = `${text.slice(0, maxLength).trimEnd()}...`;
        toggle.textContent = "Show more";
        toggle.classList.remove("hidden");
    } else {
        element.textContent = text;
        toggle.classList.add("hidden");
    }
}

function closeMarketPreview() {
    marketPreviewModal.classList.add("hidden");
    pendingMarketPersona = null;
    marketPreviewStep = 1;
    marketPreviewUserPersonaSelect.innerHTML = "";
    marketPreviewScenario.value = "";
}

function renderMarketPreviewStep() {
    const isScenarioStep = marketPreviewStep === 2;
    const isAssistant = pendingMarketPersona?.persona_type === "assistant";
    if (marketPreviewBody) marketPreviewBody.classList.toggle("hidden", isScenarioStep && isAssistant);
    if (marketPreviewStepOne) marketPreviewStepOne.classList.toggle("hidden", isScenarioStep || pendingMarketPersona?.persona_type !== "assistant");
    if (marketPreviewStepTwo) marketPreviewStepTwo.classList.toggle("hidden", !isScenarioStep || pendingMarketPersona?.persona_type !== "assistant");
    if (marketPreviewTitle) {
        marketPreviewTitle.textContent = isAssistant && isScenarioStep ? "Set the opening scene" : "Persona details";
    }
    if (marketPreviewIntro) {
        marketPreviewIntro.textContent = pendingMarketPersona?.persona_type === "assistant"
            ? (isScenarioStep
                ? "Add an optional custom scenario. If left empty, the AI Character will invent its own opening scene."
                : "Choose who you are in this roleplay before moving on to the opening scene.")
            : "Review this persona and choose how you want to use it.";
    }
    if (marketPreviewConfirm) {
        marketPreviewConfirm.textContent = pendingMarketPersona?.persona_type !== "assistant" ? "Collect persona" : "Start roleplay";
    }
}

function populateUserPersonaChoices() {
    marketPreviewUserPersonaSelect.innerHTML = "";

    const promptOption = document.createElement("option");
    promptOption.value = "";
    promptOption.textContent = "Choose who you are in this roleplay";
    promptOption.disabled = true;
    promptOption.selected = true;
    marketPreviewUserPersonaSelect.appendChild(promptOption);

    const selfOption = document.createElement("option");
    selfOption.value = "self";
    selfOption.textContent = "Yourself (no persona)";
    marketPreviewUserPersonaSelect.appendChild(selfOption);

    userPersonas.forEach((persona) => {
        const option = document.createElement("option");
        option.value = String(persona.id);
        option.textContent = persona.name;
        option.selected = persona.id === activeUserPersonaId;
        marketPreviewUserPersonaSelect.appendChild(option);
    });

    const createOption = document.createElement("option");
    createOption.value = "create_new";
    createOption.textContent = "Create new persona";
    marketPreviewUserPersonaSelect.appendChild(createOption);
}

function openMarketPreview(persona) {
    pendingMarketPersona = persona;
    marketPreviewStep = 1;
    marketPreviewName.textContent = persona.name;
    marketPreviewMeta.textContent = buildPersonaMeta(persona);
    setCollapsiblePreviewText(marketPreviewPronouns, persona.pronouns, 80);
    setCollapsiblePreviewText(marketPreviewAppearance, persona.appearance);
    setCollapsiblePreviewText(marketPreviewBackground, persona.background);
    setCollapsiblePreviewText(marketPreviewDetails, persona.details);
    setCollapsiblePreviewText(marketPreviewExampleDialogues, persona.example_dialogues);

    const isAssistant = persona.persona_type === "assistant";
    marketPreviewUserPersonaField.classList.toggle("hidden", !isAssistant);
    if (isAssistant) {
        populateUserPersonaChoices();
        marketPreviewConfirm.classList.add("hidden");
    } else {
        marketPreviewConfirm.classList.remove("hidden");
    }
    renderMarketPreviewStep();
    marketPreviewModal.classList.remove("hidden");
}

function openPersonaForm(persona = null) {
    editingPersonaId = persona ? persona.id : null;
    marketPersonaFormTitle.textContent = persona ? "Edit AI Character" : "Create AI Character";
    marketPersonaName.value = persona?.name || "";
    marketPersonaPronouns.value = persona?.pronouns || "";
    marketPersonaAppearance.value = persona?.appearance || "";
    marketPersonaBackground.value = persona?.background || "";
    marketPersonaDetails.value = persona?.details || "";
    marketPersonaExampleDialogues.value = persona?.example_dialogues || "";
    setPersonaFormNotice("");
    marketPersonaModal.classList.remove("hidden");
    marketPersonaName.focus();
}

function closePersonaForm() {
    marketPersonaModal.classList.add("hidden");
    editingPersonaId = null;
    setPersonaFormNotice("");
}

function renderMarketList(items, listElement, type) {
    listElement.innerHTML = "";
    if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "status persona-status";
        empty.textContent = type === "assistant" ? "No AI Characters found." : "No User Personas found.";
        listElement.appendChild(empty);
        return;
    }

    items.forEach((persona) => {
        const item = document.createElement("div");
        const titleRow = document.createElement("div");
        const title = document.createElement("h4");
        const tag = document.createElement("span");
        const meta = document.createElement("p");
        const stats = document.createElement("p");
        const actions = document.createElement("div");
        const detailsBtn = document.createElement("button");
        const favoriteBtn = document.createElement("button");

        item.className = "persona-item";
        titleRow.className = "persona-title-row";
        actions.className = "persona-item-actions";
        tag.className = `persona-role-tag ${type === "assistant" ? "ai" : "user"}`;
        tag.textContent = type === "assistant" ? "AI Character" : "User";
        title.textContent = persona.name;
        meta.textContent = buildPersonaMeta(persona);
        const tags = Array.isArray(persona.tags) && persona.tags.length ? `Tags: ${persona.tags.join(", ")}` : "Tags: none";
        const rating = persona.rating_count ? `${Number(persona.rating_average || 0).toFixed(1)}★` : "Unrated";
        stats.className = "subtitle";
        stats.textContent = `${tags} | Favorites: ${persona.favorite_count || 0} | Uses: ${persona.usage_count || 0} | Rating: ${rating}`;

        detailsBtn.type = "button";
        detailsBtn.textContent = "Preview";
        detailsBtn.addEventListener("click", () => openMarketPreview(persona));
        actions.appendChild(detailsBtn);

        favoriteBtn.type = "button";
        favoriteBtn.className = persona.is_favorite ? "icon-button market-favorite-button active" : "icon-button market-favorite-button";
        favoriteBtn.textContent = persona.is_favorite ? "♥" : "♡";
        favoriteBtn.title = persona.is_favorite ? "Unfavorite persona" : "Favorite persona";
        favoriteBtn.setAttribute("aria-label", favoriteBtn.title);
        favoriteBtn.setAttribute("aria-pressed", persona.is_favorite ? "true" : "false");
        favoriteBtn.addEventListener("click", () => { void toggleFavorite(persona.id); });
        actions.appendChild(favoriteBtn);

        const rateBtn = document.createElement("button");
        rateBtn.type = "button";
        rateBtn.textContent = "Rate";
        rateBtn.addEventListener("click", () => { void ratePersona(persona.id); });
        actions.appendChild(rateBtn);

        const reportBtn = document.createElement("button");
        reportBtn.type = "button";
        reportBtn.textContent = "Report";
        reportBtn.addEventListener("click", () => { void reportPersona(persona.id); });
        actions.appendChild(reportBtn);

        if (type !== "assistant") {
            const quickActionBtn = document.createElement("button");
            quickActionBtn.type = "button";
            quickActionBtn.textContent = "Collect";
            quickActionBtn.addEventListener("click", () => {
                void collectMarketPersona(persona.id);
            });
            actions.appendChild(quickActionBtn);
        }

        titleRow.append(title, tag);
        item.append(titleRow, meta, stats, actions);
        listElement.appendChild(item);
    });
}

function filterMarketPersonas(items) {
    const query = marketSearchInput.value.trim().toLowerCase();
    if (!query) return items;
    return items.filter((persona) =>
        [persona.name, persona.creator_username, persona.pronouns, persona.appearance, persona.background, persona.details, persona.example_dialogues]
            .some((field) => field && field.toLowerCase().includes(query))
    );
}

function applyMarketFilter() {
    const assistantItems = filterMarketPersonas(marketPersonasByType.assistant);
    const userItems = filterMarketPersonas(marketPersonasByType.user);
    renderMarketList(assistantItems, marketPersonaList, "assistant");
    renderMarketList(userItems, marketUserPersonaList, "user");

    if (marketSearchInput.value.trim() && !assistantItems.length && !userItems.length) {
        setMarketStatus("No personas match your search.", "error");
        return;
    }
    if (activeMarketView === "ai-characters") {
        setMarketStatus(`${assistantItems.length} AI Character${assistantItems.length === 1 ? "" : "s"} ready for roleplay.`);
        return;
    }
    if (activeMarketView === "user-personas") {
        setMarketStatus(`${userItems.length} User Persona${userItems.length === 1 ? "" : "s"} available to collect.`);
        return;
    }
    setMarketStatus(`${assistantItems.length + userItems.length} persona${assistantItems.length + userItems.length === 1 ? "" : "s"} shown.`);
}

async function refreshMarket() {
    const [assistantRes, userRes] = await Promise.all([
        get(`/personas/market?personaType=assistant&sort=${encodeURIComponent(marketSorts.assistant)}`),
        get(`/personas/market?personaType=user&sort=${encodeURIComponent(marketSorts.user)}`)
    ]);
    if (assistantRes.error || userRes.error) {
        setMarketStatus(assistantRes.error || userRes.error, "error");
        return;
    }
    marketPersonasByType = {
        assistant: assistantRes.personas || [],
        user: userRes.personas || []
    };
    applyMarketFilter();
}

async function toggleFavorite(marketId) {
    const res = await post(`/personas/market/${marketId}/favorite`, {});
    if (res.error) return setMarketStatus(res.error, "error");
    await refreshMarket();
    setMarketStatus(res.favorite ? "Favorited persona." : "Removed favorite.", "success");
}

async function ratePersona(marketId) {
    const raw = await promptMarketPopup({
        eyebrow: "Rating",
        title: "Rate this persona",
        description: "Enter a whole number from 1 to 5.",
        label: "Rating",
        value: "5",
        placeholder: "5",
        confirmLabel: "Save rating"
    });
    if (raw === null) return;
    const rating = Number(raw);
    if (!rating) return;
    const res = await post(`/personas/market/${marketId}/rate`, {rating});
    if (res.error) return setMarketStatus(res.error, "error");
    await refreshMarket();
    setMarketStatus("Rating saved.", "success");
}

async function reportPersona(marketId) {
    const reason = await promptMarketPopup({
        eyebrow: "Report",
        title: "Report persona",
        description: "Describe the main issue.",
        label: "Reason",
        placeholder: "Abusive content",
        confirmLabel: "Continue"
    });
    if (!reason) return;
    const details = await promptMarketPopup({
        eyebrow: "Report",
        title: "Extra details",
        description: "Add optional context for the report.",
        label: "Details",
        placeholder: "Optional",
        confirmLabel: "Submit report"
    });
    if (details === null) return;
    const res = await post(`/personas/market/${marketId}/report`, {reason, details});
    if (res.error) return setMarketStatus(res.error, "error");
    setMarketStatus("Report submitted.", "success");
}

async function loadOwnedPersonas() {
    const res = await get("/personas");
    if (res.error) return false;
    assistantPersonas = res.assistantPersonas || [];
    userPersonas = res.userPersonas || [];
    activeUserPersonaId = res.activeUserPersonaId || null;
    return true;
}

async function loadMarketPersonas() {
    setMarketStatus("Loading personas...");
    const ownedOk = await loadOwnedPersonas();
    if (!ownedOk) {
        setMarketStatus("Unable to load your personas.", "error");
        return;
    }
    await refreshMarket();
}

async function collectMarketPersona(marketId) {
    setMarketStatus("Collecting User Persona...");
    const res = await post(`/personas/market/${marketId}/collect`, {equip: true});
    if (res.error) {
        setMarketStatus(res.error, "error");
        return;
    }
    await loadMarketPersonas();
    setMarketStatus("User Persona collected.", "success");
}

async function startMarketPersonaChat(marketId, userPersonaSelection, scenarioPrompt = "") {
    if (!userPersonaSelection) {
        setMarketStatus("Choose who you are before starting roleplay.", "error");
        return;
    }
    if (userPersonaSelection === "create_new") {
        window.location.href = "/settings?view=my-roleplay-companions&create=user";
        return;
    }

    setMarketStatus("Starting AI Character chat...");
    setMarketActivity(true, {
        eyebrow: "Starting roleplay",
        title: "Opening AI Character chat",
        detail: "Generating the initial message and preparing the chat window."
    });
    const userPersonaId = userPersonaSelection === "self" ? null : Number(userPersonaSelection);
    const res = await post(`/personas/market/${marketId}/chat`, {
        userPersonaId,
        scenarioPrompt: scenarioPrompt.trim()
    });
    if (res.error || !res.chat) {
        setMarketActivity(false);
        setMarketStatus(res.error || "Unable to start chat.", "error");
        return;
    }
    window.location.href = `/?chat=${res.chat.id}`;
}

async function savePersona() {
    const payload = {
        personaType: "assistant",
        name: marketPersonaName.value.trim(),
        pronouns: marketPersonaPronouns.value.trim(),
        appearance: marketPersonaAppearance.value.trim(),
        background: marketPersonaBackground.value.trim(),
        details: marketPersonaDetails.value.trim(),
        exampleDialogues: marketPersonaExampleDialogues.value.trim()
    };

    if (!payload.name) {
        setPersonaFormNotice("Character name is required.", "error");
        return;
    }

    const res = editingPersonaId
        ? await put(`/personas/${editingPersonaId}`, payload)
        : await post("/personas", payload);

    if (res.error) {
        setPersonaFormNotice(res.error, "error");
        return;
    }

    await loadMarketPersonas();
    closePersonaForm();
    setMarketView("ai-characters");
    setMarketStatus(editingPersonaId ? "AI Character updated." : "AI Character created.", "success");
}

refreshMarketBtn.addEventListener("click", () => {
    void loadMarketPersonas();
});
marketPopupConfirm.addEventListener("click", () => closeMarketPopup(marketPopupInput.value));
marketPopupCancel.addEventListener("click", () => closeMarketPopup(null));
marketPopupClose.addEventListener("click", () => closeMarketPopup(null));
marketPopupModal.addEventListener("click", (event) => {
    if (event.target === marketPopupModal) closeMarketPopup(null);
});
marketPopupInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        closeMarketPopup(marketPopupInput.value);
    }
    if (event.key === "Escape") {
        event.preventDefault();
        closeMarketPopup(null);
    }
});
marketSearchInput.addEventListener("input", applyMarketFilter);
if (marketAssistantSort) {
    marketAssistantSort.addEventListener("change", () => setMarketSort("assistant", marketAssistantSort.value));
}
if (marketUserSort) {
    marketUserSort.addEventListener("change", () => setMarketSort("user", marketUserSort.value));
}
marketViewButtons.forEach((button) => {
    button.addEventListener("click", () => setMarketView(button.dataset.marketView));
});
if (marketCreateAiCharacterBtn) {
    marketCreateAiCharacterBtn.addEventListener("click", () => openPersonaForm());
}
if (marketCreateUserPersonaBtn) {
    marketCreateUserPersonaBtn.addEventListener("click", () => {
        window.location.href = "/settings?view=my-roleplay-companions&create=user";
    });
}
marketPreviewClose.addEventListener("click", closeMarketPreview);
marketPreviewModal.addEventListener("click", (event) => {
    if (event.target === marketPreviewModal) closeMarketPreview();
});
marketPreviewUserPersonaSelect.addEventListener("change", () => {
    if (!pendingMarketPersona || pendingMarketPersona.persona_type !== "assistant") return;
    if (marketPreviewUserPersonaSelect.value === "create_new") {
        window.location.href = "/settings?view=my-roleplay-companions&create=user";
        return;
    }
    marketPreviewConfirm.classList.toggle("hidden", !marketPreviewUserPersonaSelect.value);
});
marketPreviewConfirm.addEventListener("click", async () => {
    if (!pendingMarketPersona) return;
    const marketId = pendingMarketPersona.id;
    if (pendingMarketPersona.persona_type === "assistant") {
        if (marketPreviewStep === 1) {
            if (!marketPreviewUserPersonaSelect.value) {
                setMarketStatus("Choose who you are before continuing.", "error");
                return;
            }
            marketPreviewStep = 2;
            renderMarketPreviewStep();
            marketPreviewScenario.focus();
            return;
        }
        await startMarketPersonaChat(
            marketId,
            marketPreviewUserPersonaSelect.value || "self",
            marketPreviewScenario.value || ""
        );
        closeMarketPreview();
        return;
    }
    closeMarketPreview();
    await collectMarketPersona(marketId);
});
marketPersonaClose.addEventListener("click", closePersonaForm);
marketPersonaModal.addEventListener("click", (event) => {
    if (event.target === marketPersonaModal) closePersonaForm();
});
marketPersonaForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePersona();
});

window.addEventListener("load", async () => {
    applyTheme(localStorage.getItem("krishd-theme") || "fakegpt");
    const params = new URLSearchParams(window.location.search);
    setMarketSort("assistant", params.get("assistantSort") || "best", {reload: false});
    setMarketSort("user", params.get("userSort") || "best", {reload: false});
    setMarketView(params.get("view") || "ai-characters");
    await loadMarketPersonas();
    if (params.get("create") === "assistant") {
        setMarketView("ai-characters");
        openPersonaForm();
    }
});
