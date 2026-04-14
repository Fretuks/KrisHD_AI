const $ = (id) => document.getElementById(id);
const settingsNotice = $("settingsNotice");
const settingsThemeSelect = $("settingsThemeSelect");
const workspaceModeSelect = $("workspaceModeSelect");
const currentUsernameInput = $("currentUsername");
const newUsernameInput = $("newUsername");
const usernamePasswordInput = $("usernamePassword");
const currentPasswordInput = $("currentPassword");
const newPasswordInput = $("newPassword");
const repeatPasswordInput = $("repeatPassword");
const usernameForm = $("usernameForm");
const passwordForm = $("passwordForm");
const settingsNavItems = document.querySelectorAll("[data-settings-view]");
const settingsPanels = document.querySelectorAll("[data-settings-panel]");
const createAiCharacterBtn = $("createAiCharacter");
const createUserPersonaBtn = $("createUserPersona");
const settingsAiCharacterList = $("settingsAiCharacterList");
const settingsUserPersonaList = $("settingsUserPersonaList");
const settingsPersonaModal = $("settingsPersonaModal");
const settingsPersonaClose = $("settingsPersonaClose");
const settingsPersonaForm = $("settingsPersonaForm");
const settingsPersonaFormTitle = $("settingsPersonaFormTitle");
const settingsPersonaFormNotice = $("settingsPersonaFormNotice");
const settingsPersonaHelper = $("settingsPersonaHelper");
const settingsPersonaType = $("settingsPersonaType");
const settingsPersonaName = $("settingsPersonaName");
const settingsPersonaPronouns = $("settingsPersonaPronouns");
const settingsPersonaAppearance = $("settingsPersonaAppearance");
const settingsPersonaBackground = $("settingsPersonaBackground");
const settingsPersonaDetails = $("settingsPersonaDetails");
const settingsPersonaExamplesField = $("settingsPersonaExamplesField");
const settingsPersonaExampleDialogues = $("settingsPersonaExampleDialogues");
const settingsPopupModal = $("settingsPopupModal");
const settingsPopupClose = $("settingsPopupClose");
const settingsPopupCancel = $("settingsPopupCancel");
const settingsPopupConfirm = $("settingsPopupConfirm");
const settingsPopupTitle = $("settingsPopupTitle");
const settingsPopupEyebrow = $("settingsPopupEyebrow");
const settingsPopupDescription = $("settingsPopupDescription");
const settingsPopupField = $("settingsPopupField");
const settingsPopupInputLabel = $("settingsPopupInputLabel");
const settingsPopupInput = $("settingsPopupInput");

const themes = {
    "fakegpt": {name: "FakeGPT"},
    "fraud": {name: "Fraud"},
    "germini": {name: "Germini"},
    "slopilot": {name: "Slopilot"},
    "beta-ai": {name: "Beta AI"},
    "confusity": {name: "Confusity"}
};

let assistantPersonas = [];
let userPersonas = [];
let publishedPersonaIds = new Set();
let editingPersonaId = null;
let settingsPopupResolver = null;

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
const del = (url) => request(url, null, "DELETE");

function setNotice(message, state = "") {
    settingsNotice.textContent = message;
    settingsNotice.className = state ? `status ${state}` : "status";
}

function setPersonaNotice(message = "", state = "") {
    if (!message) {
        settingsPersonaFormNotice.textContent = "";
        settingsPersonaFormNotice.className = "status hidden";
        return;
    }
    settingsPersonaFormNotice.textContent = message;
    settingsPersonaFormNotice.className = state ? `status ${state}` : "status";
}

function closeSettingsPopup(value = null) {
    settingsPopupModal.classList.add("hidden");
    if (settingsPopupResolver) {
        const resolve = settingsPopupResolver;
        settingsPopupResolver = null;
        resolve(value);
    }
}

function promptSettingsPopup({
    eyebrow = "Action",
    title = "Enter a value",
    description = "",
    label = "Value",
    value = "",
    placeholder = "",
    confirmLabel = "Confirm"
} = {}) {
    settingsPopupEyebrow.textContent = eyebrow;
    settingsPopupTitle.textContent = title;
    settingsPopupDescription.textContent = description;
    settingsPopupInputLabel.textContent = label;
    settingsPopupInput.value = value;
    settingsPopupInput.placeholder = placeholder;
    settingsPopupConfirm.textContent = confirmLabel;
    settingsPopupModal.classList.remove("hidden");
    settingsPopupInput.focus();
    settingsPopupInput.select();
    return new Promise((resolve) => {
        settingsPopupResolver = resolve;
    });
}

function applyTheme(themeKey, persist = true) {
    const nextTheme = themes[themeKey] ? themeKey : "fakegpt";
    document.body.dataset.theme = nextTheme;
    document.title = "Settings";
    settingsThemeSelect.value = nextTheme;
    if (persist) localStorage.setItem("krishd-theme", nextTheme);
}

function setSettingsView(view) {
    const normalizedView = ["my-ai-characters", "my-personas"].includes(view) ? "my-roleplay-companions" : view;
    settingsNavItems.forEach((item) => item.classList.toggle("active", item.dataset.settingsView === normalizedView));
    settingsPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.settingsPanel === normalizedView));
    const params = new URLSearchParams(window.location.search);
    params.set("view", normalizedView);
    history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function formatMeta(persona) {
    return persona.pronouns ? `Pronouns: ${persona.pronouns}` : "Pronouns: n/a";
}

function syncPersonaExamplesField() {
    const isAssistant = settingsPersonaType.value === "assistant";
    settingsPersonaExamplesField.classList.toggle("hidden", !isAssistant);
    settingsPersonaHelper.textContent = isAssistant
        ? "Create the character you want to roleplay with."
        : "Create the persona you want to speak as in roleplay.";
    $("settingsPersonaSave").textContent = isAssistant ? "Save AI Character" : "Save persona";
}

function openPersonaModal(persona = null, personaType = "assistant") {
    editingPersonaId = persona ? persona.id : null;
    settingsPersonaType.disabled = Boolean(persona);
    settingsPersonaType.value = persona ? persona.persona_type : personaType;
    settingsPersonaFormTitle.textContent = persona
        ? `Edit ${settingsPersonaType.value === "assistant" ? "AI Character" : "persona"}`
        : `Create ${personaType === "assistant" ? "AI Character" : "persona"}`;
    settingsPersonaName.value = persona?.name || "";
    settingsPersonaPronouns.value = persona?.pronouns || "";
    settingsPersonaAppearance.value = persona?.appearance || "";
    settingsPersonaBackground.value = persona?.background || "";
    settingsPersonaDetails.value = persona?.details || "";
    settingsPersonaExampleDialogues.value = persona?.example_dialogues || "";
    syncPersonaExamplesField();
    setPersonaNotice("");
    settingsPersonaModal.classList.remove("hidden");
    settingsPersonaName.focus();
}

function closePersonaModal() {
    settingsPersonaModal.classList.add("hidden");
    editingPersonaId = null;
    setPersonaNotice("");
}

function renderPersonaList(personas, listElement, type) {
    listElement.innerHTML = "";
    if (!personas.length) {
        const empty = document.createElement("div");
        const message = document.createElement("p");
        const button = document.createElement("button");
        empty.className = "persona-empty-state";
        message.className = "status persona-status";
        message.textContent = type === "assistant" ? "No AI Characters yet." : "No user personas yet.";
        button.type = "button";
        button.className = "secondary-action";
        button.textContent = type === "assistant" ? "Create AI Character" : "Create user persona";
        button.addEventListener("click", () => openPersonaModal(null, type));
        empty.append(message, button);
        listElement.appendChild(empty);
        return;
    }

    personas.forEach((persona) => {
        const item = document.createElement("div");
        const titleRow = document.createElement("div");
        const title = document.createElement("h4");
        const tag = document.createElement("span");
        const meta = document.createElement("p");
        const actions = document.createElement("div");

        item.className = "persona-item";
        titleRow.className = "persona-title-row";
        actions.className = "persona-item-actions";
        tag.className = `persona-role-tag ${type === "assistant" ? "ai" : "user"}`;
        tag.textContent = type === "assistant" ? "AI Character" : "User";
        title.textContent = persona.name;
        meta.textContent = formatMeta(persona);

        [
            ["Edit", () => openPersonaModal(persona)],
            ["Clone", () => clonePersona(persona.id)],
            ["History", () => showPersonaHistory(persona.id)],
            [publishedPersonaIds.has(persona.id) ? "Update listing" : "Publish", () => publishPersona(persona.id)],
            ["Delete", () => deletePersona(persona.id)]
        ]
            .filter(([label]) => Boolean(label))
            .forEach(([label, handler]) => {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = label;
                button.addEventListener("click", handler);
                actions.appendChild(button);
            });

        if (publishedPersonaIds.has(persona.id)) {
            const unpublishButton = document.createElement("button");
            unpublishButton.type = "button";
            unpublishButton.textContent = "Unpublish";
            unpublishButton.addEventListener("click", () => unpublishPersona(persona.id));
            actions.appendChild(unpublishButton);
        }

        titleRow.append(title, tag);
        item.append(titleRow, meta, actions);
        listElement.appendChild(item);
    });
}

async function loadProfile() {
    const res = await get("/settings/profile");
    if (res.error) {
        setNotice(res.error, "error");
        return false;
    }
    currentUsernameInput.value = res.username || "";
    newUsernameInput.value = res.username || "";
    return true;
}

async function loadPersonas() {
    const res = await get("/personas");
    if (res.error) {
        setNotice(res.error, "error");
        return false;
    }
    assistantPersonas = res.assistantPersonas || [];
    userPersonas = res.userPersonas || [];
    publishedPersonaIds = new Set(res.publishedPersonaIds || []);
    renderPersonaList(assistantPersonas, settingsAiCharacterList, "assistant");
    renderPersonaList(userPersonas, settingsUserPersonaList, "user");
    return true;
}

async function savePersona() {
    const wasEditing = Boolean(editingPersonaId);
    const payload = {
        personaType: settingsPersonaType.value,
        name: settingsPersonaName.value.trim(),
        pronouns: settingsPersonaPronouns.value.trim(),
        appearance: settingsPersonaAppearance.value.trim(),
        background: settingsPersonaBackground.value.trim(),
        details: settingsPersonaDetails.value.trim(),
        exampleDialogues: settingsPersonaType.value === "assistant" ? settingsPersonaExampleDialogues.value.trim() : ""
    };

    if (!payload.name) {
        setPersonaNotice("Name is required.", "error");
        return;
    }

    const res = editingPersonaId
        ? await put(`/personas/${editingPersonaId}`, payload)
        : await post("/personas", payload);

    if (res.error) {
        setPersonaNotice(res.error, "error");
        return;
    }

    await loadPersonas();
    closePersonaModal();
    setSettingsView("my-roleplay-companions");
    setNotice(wasEditing ? "Persona updated." : "Persona created.", "success");
}

async function deletePersona(id) {
    const res = await del(`/personas/${id}`);
    if (res.error) {
        setNotice(res.error, "error");
        return;
    }
    await loadPersonas();
    setNotice("Persona deleted.", "success");
}

async function publishPersona(id) {
    const tagsInput = await promptSettingsPopup({
        eyebrow: "Marketplace",
        title: "Persona tags",
        description: "Add optional comma-separated tags to improve discovery.",
        label: "Tags",
        placeholder: "mentor, fantasy, villain",
        confirmLabel: "Publish"
    });
    if (tagsInput === null) return;
    const tags = String(tagsInput || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const res = await post(`/personas/${id}/publish`, {tags});
    if (res.error) {
        setNotice(res.error, "error");
        return;
    }
    await loadPersonas();
    setNotice("Persona published.", "success");
}

async function clonePersona(id) {
    const res = await post(`/personas/${id}/clone`, {});
    if (res.error) return setNotice(res.error, "error");
    await loadPersonas();
    setNotice("Persona cloned.", "success");
}

async function showPersonaHistory(id) {
    const res = await get(`/personas/${id}/versions`);
    if (res.error) return setNotice(res.error, "error");
    const versions = res.versions || [];
    const summary = versions.length
        ? versions.map((version) => `v${version.version_number} - ${new Date(version.created_at).toLocaleString()}`).join("\n")
        : "No saved versions yet.";
    const choice = await promptSettingsPopup({
        eyebrow: "Persona history",
        title: "Restore a version",
        description: summary,
        label: "Version number",
        placeholder: "1",
        confirmLabel: "Restore"
    });
    if (choice === null) return;
    const selected = Number(choice);
    if (!selected) return;
    const version = versions.find((item) => item.version_number === selected);
    if (!version) return setNotice("Version not found.", "error");
    const restore = await post(`/personas/${id}/versions/${version.id}/restore`, {});
    if (restore.error) return setNotice(restore.error, "error");
    await loadPersonas();
    setNotice(`Restored persona version ${selected}.`, "success");
}

async function unpublishPersona(id) {
    const res = await post(`/personas/${id}/unpublish`, {});
    if (res.error) {
        setNotice(res.error, "error");
        return;
    }
    await loadPersonas();
    setNotice("Persona unpublished.", "success");
}

usernameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = newUsernameInput.value.trim();
    const password = usernamePasswordInput.value;
    if (!username || !password) {
        setNotice("New username and current password are required.", "error");
        return;
    }
    const res = await request("/settings/username", {username, password}, "PUT");
    if (res.error) {
        setNotice(res.error, "error");
        return;
    }
    currentUsernameInput.value = res.username;
    newUsernameInput.value = res.username;
    usernamePasswordInput.value = "";
    setNotice("Username updated.", "success");
});

passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentPassword = currentPasswordInput.value;
    const nextPassword = newPasswordInput.value;
    const repeatPassword = repeatPasswordInput.value;
    if (!currentPassword || !nextPassword || !repeatPassword) {
        setNotice("Fill in all password fields.", "error");
        return;
    }
    if (nextPassword !== repeatPassword) {
        setNotice("New passwords do not match.", "error");
        return;
    }
    const res = await request("/settings/password", {currentPassword, newPassword: nextPassword}, "PUT");
    if (res.error) {
        setNotice(res.error, "error");
        return;
    }
    currentPasswordInput.value = "";
    newPasswordInput.value = "";
    repeatPasswordInput.value = "";
    setNotice("Password updated.", "success");
});

settingsThemeSelect.addEventListener("change", (event) => {
    applyTheme(event.target.value);
    setNotice("Theme updated.", "success");
});
workspaceModeSelect.addEventListener("change", (event) => {
    const mode = event.target.value === "advanced" ? "advanced" : "basic";
    localStorage.setItem("krishd-workspace-mode", mode);
    setNotice(`Workspace mode set to ${mode}.`, "success");
});

settingsNavItems.forEach((item) => item.addEventListener("click", () => setSettingsView(item.dataset.settingsView)));
createAiCharacterBtn.addEventListener("click", () => openPersonaModal(null, "assistant"));
createUserPersonaBtn.addEventListener("click", () => openPersonaModal(null, "user"));
settingsPersonaClose.addEventListener("click", closePersonaModal);
settingsPersonaModal.addEventListener("click", (event) => {
    if (event.target === settingsPersonaModal) closePersonaModal();
});
settingsPersonaType.addEventListener("change", syncPersonaExamplesField);
settingsPersonaForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePersona();
});
settingsPopupConfirm.addEventListener("click", () => closeSettingsPopup(settingsPopupInput.value));
settingsPopupCancel.addEventListener("click", () => closeSettingsPopup(null));
settingsPopupClose.addEventListener("click", () => closeSettingsPopup(null));
settingsPopupModal.addEventListener("click", (event) => {
    if (event.target === settingsPopupModal) closeSettingsPopup(null);
});
settingsPopupInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        closeSettingsPopup(settingsPopupInput.value);
    }
    if (event.key === "Escape") {
        event.preventDefault();
        closeSettingsPopup(null);
    }
});

window.addEventListener("load", async () => {
    applyTheme(localStorage.getItem("krishd-theme") || "fakegpt", false);
    workspaceModeSelect.value = localStorage.getItem("krishd-workspace-mode") || "basic";
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view") || "personal";
    setSettingsView(view);
    const [profileOk, personasOk] = await Promise.all([loadProfile(), loadPersonas()]);
    if (profileOk && personasOk) setNotice("Settings loaded.");

    const create = params.get("create");
    if (create === "assistant") {
        setSettingsView("my-roleplay-companions");
        openPersonaModal(null, "assistant");
    } else if (create === "user") {
        setSettingsView("my-roleplay-companions");
        openPersonaModal(null, "user");
    }
});
