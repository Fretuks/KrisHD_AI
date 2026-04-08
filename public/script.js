const $ = (id) => document.getElementById(id);
const authDiv = $("auth"), chatDiv = $("chat"), authMsg = $("authMsg");
const messagesDiv = $("messages"), modelSelect = $("model");
const modelMenuButton = $("modelMenuButton"), modelPopover = $("modelPopover"), modelBadgeName = $("modelBadgeName");
const modelCount = $("modelCount");
const modelHelpTitle = $("modelHelpTitle"), modelHelpBadge = $("modelHelpBadge"), modelHelpSummary = $("modelHelpSummary");
const loginForm = $("loginForm"), registerForm = $("registerForm"), msgInput = $("msgInput"), sendBtn = $("send");
const loginUsernameInput = $("loginUsername"), loginPasswordInput = $("loginPassword");
const registerUsernameInput = $("registerUsername"), registerPasswordInput = $("registerPassword");
const loginSubmit = $("loginSubmit"), registerSubmit = $("registerSubmit");
const chatList = $("chatList"), chatSearchInput = $("chatSearch"), newChatBtn = $("newChat");
const renameChatBtn = $("renameChat"), clearChatBtn = $("clearChat"), exportChatBtn = $("exportChat");
const activeChatTitle = $("activeChatTitle"), sessionUser = $("sessionUser");
const personaList = $("personaList"), userPersonaList = $("userPersonaList");
const personaForm = $("personaForm"), personaFormTitle = $("personaFormTitle"), personaTypeSelect = $("personaType");
const personaNameInput = $("personaName"), personaPronounsInput = $("personaPronouns"), personaAppearanceInput = $("personaAppearance");
const personaBackgroundInput = $("personaBackground"), personaDetailsInput = $("personaDetails");
const personaFormNotice = $("personaFormNotice");
const newPersonaBtn = $("newPersona"), newUserPersonaBtn = $("newUserPersona"), clearPersonaBtn = $("clearPersona"), clearUserPersonaBtn = $("clearUserPersona");
const activePersonaStatus = $("activePersonaStatus"), activeUserPersonaStatus = $("activeUserPersonaStatus");
const personaModal = $("personaModal"), personaCloseBtn = $("personaClose"), personaMenuButton = $("personaMenuButton"), personaPopover = $("personaPopover");
const authScreens = document.querySelectorAll(".auth-screen"), toggleButtons = document.querySelectorAll(".auth-toggle .toggle");
const themeNameTargets = document.querySelectorAll("[data-theme-name]"), themeLogoTargets = document.querySelectorAll("[data-theme-logo]");

let isProcessing = false, activeChatId = null, editingPersonaId = null, editingPersonaType = "assistant", currentUsername = "";
let chatSessions = [], currentMessages = [], assistantPersonas = [], userPersonas = [];
let activePersonaId = null, activeUserPersonaId = null, currentSummary = null, publishedPersonaIds = new Set();

const themes = {
    "fakegpt": {name: "FakeGPT", short: "FG"},
    "fraud": {name: "Fraud", short: "FR"},
    "germini": {name: "Germini", short: "GE"},
    "slopilot": {name: "Slopilot", short: "SP"},
    "beta-ai": {name: "Beta AI", short: "BA"},
    "confusity": {name: "Confusity", short: "CF"}
};

const defaultModelProfile = {
    badge: "General",
    summary: "General-purpose chat model. Start here if you are unsure which model to use."
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
const put = (url, data) => request(url, data, "PUT");
const del = (url) => request(url, null, "DELETE");

function setAuthMessage(message, state = "") { authMsg.textContent = message; authMsg.className = state ? `status ${state}` : "status"; }
function setNotice(message, state = "") { return {message, state}; }
function setPersonaFormNotice(message = "", state = "") {
    if (!personaFormNotice) return;
    if (!message) {
        personaFormNotice.textContent = "";
        personaFormNotice.className = "status hidden";
        return;
    }
    personaFormNotice.textContent = message;
    personaFormNotice.className = state ? `status ${state}` : "status";
}
function setMessageContent(el, content) {
    const markdownParser = window.marked;
    const purifier = window.DOMPurify;
    if (markdownParser?.parse && purifier?.sanitize) {
        el.innerHTML = purifier.sanitize(markdownParser.parse(content, {breaks: true}));
    } else {
        el.textContent = content;
    }
}
function getChatById(id) { return chatSessions.find((chat) => chat.id === id); }

function addMessage(content, isUser = false, isLoading = false) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `msg ${isUser ? "user" : "bot"}${isLoading ? " loading" : ""}`;
    if (isLoading) {
        msgDiv.innerHTML = `
            <div class="loading-shell" aria-live="polite" aria-label="Assistant is responding">
                <div class="loading-bars">
                    <span class="loading-bar"></span>
                    <span class="loading-bar"></span>
                    <span class="loading-bar"></span>
                    <span class="loading-bar"></span>
                </div>
                <div class="loading-copy">
                    <strong>Thinking</strong>
                </div>
            </div>`;
    } else {
        const header = document.createElement("div"), body = document.createElement("div");
        header.className = "msg-header"; body.className = "msg-content";
        header.textContent = isUser ? "You" : "Assistant";
        setMessageContent(body, content);
        msgDiv.append(header, body);
    }
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return msgDiv;
}

function renderMessages() {
    messagesDiv.innerHTML = "";
    currentMessages.forEach((msg) => addMessage(msg.content, msg.role === "user"));
    updateChatActionState();
}

function updateWorkspaceCopy() {
    const activeChat = getChatById(activeChatId);
    if (activeChatTitle) {
        activeChatTitle.textContent = activeChat ? activeChat.title : "New chat";
    }
    if (sessionUser) {
        sessionUser.textContent = currentUsername || "-";
    }
}

function updateContextRail() {
    return modelSelect?.selectedOptions[0]?.textContent || "";
}

function getModelProfile(modelId, modelName) {
    const haystack = `${modelId || ""} ${modelName || ""}`.toLowerCase();
    if (haystack.includes("codellama") || haystack.includes("code")) {
        return {
            badge: "Coding",
            summary: "Best for code generation, debugging, and technical explanations. Usually stronger on programming tasks than on creative chat."
        };
    }
    if (haystack.includes("gemma")) {
        return {
            badge: "Fast",
            summary: "A lighter general chat model. Good for quick answers and lower-latency replies, with less depth than larger models."
        };
    }
    if (haystack.includes("dolphin")) {
        return {
            badge: "Chatty",
            summary: "Instruction-following conversational model. Good for open-ended chat, brainstorming, and longer natural responses."
        };
    }
    if (haystack.includes("mistral")) {
        return {
            badge: "Balanced",
            summary: "Strong default for everyday use. Usually a good balance between speed, clarity, and response quality."
        };
    }
    if (haystack.includes("catgirl") || haystack.includes("femboy") || haystack.includes("buenzli")) {
        return {
            badge: "Persona",
            summary: "Specialized character-style model. Best for roleplay or stylized voice, and less reliable for factual or neutral answers."
        };
    }
    return defaultModelProfile;
}

function updateModelHelp() {
    if (!modelSelect || !modelHelpTitle || !modelHelpBadge || !modelHelpSummary) return;
    const selectedOption = modelSelect.selectedOptions[0];
    if (!selectedOption || selectedOption.disabled) {
        if (modelCount) modelCount.textContent = "No models";
        if (modelBadgeName) modelBadgeName.textContent = "Unavailable";
        modelHelpBadge.dataset.badge = "waiting";
        modelHelpTitle.textContent = "Choose a model";
        modelHelpBadge.textContent = "Waiting";
        modelHelpSummary.textContent = "Pick a model to see what it is best suited for.";
        return;
    }
    if (modelCount) {
        const totalModels = Array.from(modelSelect.options).filter((option) => !option.disabled).length;
        modelCount.textContent = `${totalModels} ${totalModels === 1 ? "model" : "models"}`;
    }
    const modelId = selectedOption.value;
    const modelName = selectedOption.textContent || modelId;
    const profile = getModelProfile(modelId, modelName);
    if (modelBadgeName) modelBadgeName.textContent = modelName;
    modelHelpTitle.textContent = modelName;
    modelHelpBadge.textContent = profile.badge;
    modelHelpBadge.dataset.badge = profile.badge.toLowerCase();
    modelHelpSummary.textContent = profile.summary;
}

function applyTheme(themeKey, persist = true) {
    const nextTheme = themes[themeKey] ? themeKey : "fakegpt";
    const theme = themes[nextTheme];
    document.body.dataset.theme = nextTheme;
    document.title = theme.name;
    themeNameTargets.forEach((target) => { target.textContent = theme.name; });
    themeLogoTargets.forEach((target) => { target.textContent = theme.short; });
    if (persist) localStorage.setItem("krishd-theme", nextTheme);
    updateWorkspaceCopy();
    updateContextRail();
}

function updateChatActionState() {
    const hasChat = Boolean(activeChatId);
    renameChatBtn.disabled = !hasChat;
    clearChatBtn.disabled = !hasChat;
    exportChatBtn.disabled = !hasChat || currentMessages.length === 0;
}

function renderChatList() {
    const query = chatSearchInput.value.trim().toLowerCase();
    const filtered = chatSessions.filter((chat) => !query || chat.title.toLowerCase().includes(query));
    chatList.innerHTML = "";
    if (!filtered.length) {
        const empty = document.createElement("p");
        empty.className = "status";
        empty.textContent = query ? "No chats match this search." : "No chats yet. Start a new one.";
        chatList.appendChild(empty);
        return;
    }
    filtered.forEach((chat) => {
        const item = document.createElement("div"), title = document.createElement("span"), remove = document.createElement("button");
        item.className = `chat-item${chat.id === activeChatId ? " active" : ""}`;
        title.textContent = chat.title; remove.type = "button"; remove.textContent = "Delete";
        remove.addEventListener("click", async (event) => { event.stopPropagation(); await deleteChat(chat.id); });
        item.append(title, remove);
        item.addEventListener("click", () => setActiveChat(chat.id));
        chatList.appendChild(item);
    });
}

function updateActivePersonaStatus(items, activeId, statusEl, emptyText, prefix) {
    const active = items.find((persona) => persona.id === activeId);
    statusEl.textContent = active ? `${prefix}: ${active.name}` : emptyText;
}

function setActivePersonaStatus() {
    updateActivePersonaStatus(assistantPersonas, activePersonaId, activePersonaStatus, "No AI persona equipped.", "AI persona equipped");
    updateActivePersonaStatus(userPersonas, activeUserPersonaId, activeUserPersonaStatus, "No user persona set.", "User persona active");
    clearPersonaBtn.disabled = !activePersonaId;
    clearUserPersonaBtn.disabled = !activeUserPersonaId;
    updateContextRail();
}

function openPersonaForm(persona = null, personaType = "assistant") {
    closePersonaPopover();
    personaModal.classList.remove("hidden");
    if (persona) {
        editingPersonaId = persona.id; editingPersonaType = persona.persona_type || "assistant";
        personaFormTitle.textContent = `Edit ${editingPersonaType === "user" ? "your persona" : "AI persona"}`;
        personaTypeSelect.value = editingPersonaType; personaTypeSelect.disabled = true;
        personaNameInput.value = persona.name || ""; personaPronounsInput.value = persona.pronouns || "";
        personaAppearanceInput.value = persona.appearance || ""; personaBackgroundInput.value = persona.background || ""; personaDetailsInput.value = persona.details || "";
    } else {
        editingPersonaId = null; editingPersonaType = personaType;
        personaFormTitle.textContent = `Create ${personaType === "user" ? "your persona" : "AI persona"}`;
        personaTypeSelect.value = personaType; personaTypeSelect.disabled = false;
        personaNameInput.value = ""; personaPronounsInput.value = ""; personaAppearanceInput.value = ""; personaBackgroundInput.value = ""; personaDetailsInput.value = "";
    }
    setPersonaFormNotice("");
    personaNameInput.focus();
}

function closePersonaForm() { personaModal.classList.add("hidden"); editingPersonaId = null; editingPersonaType = "assistant"; personaTypeSelect.disabled = false; setPersonaFormNotice(""); }
function closePersonaPopover() { personaPopover.classList.add("hidden"); personaMenuButton.setAttribute("aria-expanded", "false"); }
function closeModelPopover() {
    modelPopover.classList.add("hidden");
    modelMenuButton.setAttribute("aria-expanded", "false");
}

function renderPersonaList(items, activeId, listElement, personaType) {
    listElement.innerHTML = "";
    if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "status persona-status";
        empty.textContent = "No personas yet. Create one to get started.";
        listElement.appendChild(empty);
        setActivePersonaStatus();
        return;
    }
    items.forEach((persona) => {
        const item = document.createElement("div"), titleRow = document.createElement("div"), title = document.createElement("h4");
        const tag = document.createElement("span"), meta = document.createElement("p"), actions = document.createElement("div");
        item.className = `persona-item${persona.id === activeId ? " active" : ""}`; titleRow.className = "persona-title-row"; actions.className = "persona-item-actions";
        tag.className = `persona-role-tag ${personaType === "user" ? "user" : "ai"}`; tag.textContent = personaType === "user" ? "You" : "AI";
        title.textContent = persona.name; meta.textContent = persona.pronouns ? `Pronouns: ${persona.pronouns}` : "Pronouns: n/a";
        [["Equip", () => equipPersona(persona.id, personaType), persona.id === activeId],
            ["Edit", () => openPersonaForm(persona), false],
            [publishedPersonaIds.has(persona.id) ? "Update listing" : "Publish", () => publishPersona(persona.id), false],
            ["Delete", () => deletePersona(persona.id), false]]
            .forEach(([label, handler, disabled]) => {
                const btn = document.createElement("button");
                btn.type = "button"; btn.textContent = label; btn.disabled = disabled; btn.addEventListener("click", handler); actions.appendChild(btn);
            });
        if (publishedPersonaIds.has(persona.id)) {
            const btn = document.createElement("button");
            btn.type = "button"; btn.textContent = "Unpublish"; btn.addEventListener("click", () => unpublishPersona(persona.id)); actions.appendChild(btn);
        }
        titleRow.append(title, tag); item.append(titleRow, meta, actions); listElement.appendChild(item);
    });
    setActivePersonaStatus();
}

async function loadSummary() {
    updateWorkspaceCopy();
    return currentSummary;
}

async function loadPersonas() {
    const res = await get("/personas");
    if (res.error) return setNotice(res.error, "error");
    assistantPersonas = res.assistantPersonas || []; userPersonas = res.userPersonas || [];
    activePersonaId = res.activePersonaId || null; activeUserPersonaId = res.activeUserPersonaId || null; publishedPersonaIds = new Set(res.publishedPersonaIds || []);
    renderPersonaList(assistantPersonas, activePersonaId, personaList, "assistant");
    renderPersonaList(userPersonas, activeUserPersonaId, userPersonaList, "user");
    updateWorkspaceCopy();
}

async function equipPersona(id, type) {
    const res = await post(type === "user" ? `/personas/${id}/equip-user` : `/personas/${id}/equip`, {});
    if (res.error) return setNotice(res.error, "error");
    if (type === "user") activeUserPersonaId = id; else activePersonaId = id;
    renderPersonaList(assistantPersonas, activePersonaId, personaList, "assistant");
    renderPersonaList(userPersonas, activeUserPersonaId, userPersonaList, "user");
    setNotice(type === "user" ? "User persona updated." : "AI persona updated.", "success");
}

async function clearPersona(type) {
    const res = await post(type === "user" ? "/personas/user/clear" : "/personas/clear", {});
    if (res.error) return setNotice(res.error, "error");
    if (type === "user") activeUserPersonaId = null; else activePersonaId = null;
    renderPersonaList(assistantPersonas, activePersonaId, personaList, "assistant");
    renderPersonaList(userPersonas, activeUserPersonaId, userPersonaList, "user");
    setNotice("Persona cleared.", "success");
}

async function savePersona() {
    const payload = {personaType: personaTypeSelect.value, name: personaNameInput.value.trim(), pronouns: personaPronounsInput.value.trim(), appearance: personaAppearanceInput.value.trim(), background: personaBackgroundInput.value.trim(), details: personaDetailsInput.value.trim()};
    if (!payload.name) return setPersonaFormNotice("Persona name is required.", "error");
    const res = editingPersonaId ? await put(`/personas/${editingPersonaId}`, payload) : await post("/personas", payload);
    if (res.error) return setPersonaFormNotice(res.error, "error");
    const wasEditing = Boolean(editingPersonaId);
    await loadPersonas(); closePersonaForm(); setNotice(wasEditing ? "Persona updated." : "Persona created.", "success");
}

async function deletePersona(id) {
    const persona = assistantPersonas.find((item) => item.id === id) || userPersonas.find((item) => item.id === id);
    if (!persona || !window.confirm(`Delete persona "${persona.name}"?`)) return;
    const res = await del(`/personas/${id}`);
    if (res.error) return setNotice(res.error, "error");
    await loadPersonas(); setNotice("Persona deleted.", "success");
}
async function publishPersona(id) { const res = await post(`/personas/${id}/publish`, {}); if (res.error) return setNotice(res.error, "error"); await loadPersonas(); setNotice("Persona published.", "success"); }
async function unpublishPersona(id) { const res = await post(`/personas/${id}/unpublish`, {}); if (res.error) return setNotice(res.error, "error"); await loadPersonas(); setNotice("Persona unpublished.", "success"); }

function setLoadingState(loading) {
    isProcessing = loading; sendBtn.disabled = loading; msgInput.disabled = loading;
    sendBtn.classList.toggle("loading", loading); msgInput.placeholder = loading ? "Processing response..." : "Type your message...";
}

function showAuthScreen(target) {
    authScreens.forEach((screen) => screen.classList.toggle("active", screen.id === `${target}Screen`));
    toggleButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.target === target));
    setAuthMessage("");
}

async function setActiveChat(id) {
    activeChatId = id;
    updateWorkspaceCopy(); renderChatList(); updateChatActionState();
    const res = await get(`/chats/${id}/messages`);
    if (res.error) return setNotice(res.error, "error");
    currentMessages = res.messages || []; renderMessages();
}

async function loadChatSessions() {
    const res = await get("/chats");
    if (res.error) return setNotice(res.error, "error");
    chatSessions = res.chats || []; renderChatList();
    if (chatSessions.length) return setActiveChat(activeChatId && getChatById(activeChatId) ? activeChatId : chatSessions[0].id);
    return createNewChat();
}

async function createNewChat() {
    const res = await post("/chats", {title: "New chat"});
    if (res.error || !res.chat) return setNotice(res.error || "Unable to create chat.", "error");
    chatSessions.unshift(res.chat); await loadSummary(); renderChatList(); await setActiveChat(res.chat.id); setNotice("New chat created.", "success");
}

async function renameChat(id) {
    const chat = getChatById(id), nextTitle = chat ? window.prompt("Rename chat", chat.title) : "";
    const title = (nextTitle || "").trim();
    if (!chat || !title) return;
    const res = await put(`/chats/${id}`, {title});
    if (res.error) return setNotice(res.error, "error");
    chat.title = title; updateWorkspaceCopy(); renderChatList(); setNotice("Chat renamed.", "success");
}

async function clearChat(id) {
    const chat = getChatById(id);
    if (!chat || !window.confirm(`Clear all messages in "${chat.title}"?`)) return;
    const res = await post(`/chats/${id}/clear`, {});
    if (res.error) return setNotice(res.error, "error");
    currentMessages = []; renderMessages(); await loadSummary(); setNotice("Chat cleared.", "success");
}

function exportCurrentChat() {
    const chat = getChatById(activeChatId);
    if (!chat || !currentMessages.length) return;
    const lines = [`Chat: ${chat.title}`, `Exported: ${new Date().toISOString()}`, ""];
    currentMessages.forEach((msg) => { lines.push(`${msg.role === "user" ? "You" : "Assistant"}:`); lines.push(msg.content, ""); });
    const blob = new Blob([lines.join("\n")], {type: "text/plain;charset=utf-8"}), url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `${(chat.title.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "chat")}.txt`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); setNotice("Chat exported.", "success");
}

async function deleteChat(id) {
    const chat = getChatById(id);
    if (!chat || !window.confirm(`Delete "${chat.title}"? This cannot be undone.`)) return;
    const res = await del(`/chats/${id}`);
    if (res.error) return setNotice(res.error, "error");
    chatSessions = chatSessions.filter((item) => item.id !== id);
    if (activeChatId === id) { activeChatId = null; currentMessages = []; renderMessages(); }
    await loadSummary(); renderChatList();
    if (chatSessions.length) await setActiveChat(chatSessions[0].id); else await createNewChat();
    setNotice("Chat deleted.", "success");
}

async function displayModels() {
    const res = await get("/models");
    const models = Array.isArray(res.models) ? res.models : null;
    if (res.error || !models) {
        modelSelect.innerHTML = "<option>Error loading models</option>";
        updateModelHelp();
        updateContextRail();
        return setNotice("Models could not be loaded.", "error");
    }
    modelSelect.innerHTML = "";
    models.forEach((model, index) => {
        const option = document.createElement("option");
        option.value = model.model; option.textContent = model.name; option.selected = index === 0; modelSelect.appendChild(option);
    });
    updateModelHelp();
    updateContextRail();
}

async function checkSession() {
    const res = await get("/session");
    if (!res.user) return false;
    currentUsername = res.user; authDiv.style.display = "none"; chatDiv.style.display = "block";
    await Promise.all([displayModels(), loadSummary(), loadChatSessions(), loadPersonas()]);
    msgInput.focus(); return true;
}

async function handleAuth(endpoint, credentials) {
    const {username, password} = credentials, submitBtn = endpoint === "login" ? loginSubmit : registerSubmit;
    if (!username || !password) return setAuthMessage("Please enter both username and password.", "error");
    submitBtn.disabled = true; setAuthMessage("Processing...");
    const res = await post(`/${endpoint}`, {username, password});
    submitBtn.disabled = false;
    if (res.error) return setAuthMessage(res.error, "error");
    if (endpoint === "login") {
        currentUsername = username; authDiv.style.display = "none"; chatDiv.style.display = "block";
        await Promise.all([displayModels(), loadSummary(), loadChatSessions(), loadPersonas()]);
        setNotice("Ready.", "success"); msgInput.focus();
    } else {
        setAuthMessage("Registration successful. You can now log in.", "success");
        showAuthScreen("login"); loginUsernameInput.value = username; loginPasswordInput.focus();
    }
}

async function sendMessage() {
    if (isProcessing) return;
    const message = msgInput.value.trim();
    if (!message) return;
    if (!activeChatId) await createNewChat();
    const currentChat = getChatById(activeChatId);
    if (currentChat && currentChat.title === "New chat") {
        const autoTitle = message.length > 40 ? `${message.slice(0, 40)}...` : message;
        currentChat.title = autoTitle; updateWorkspaceCopy(); renderChatList(); await put(`/chats/${activeChatId}`, {title: autoTitle});
    }
    currentMessages.push({role: "user", content: message}); addMessage(message, true); updateChatActionState();
    msgInput.value = ""; msgInput.style.height = "auto"; setLoadingState(true); setNotice("Generating reply...");
    const loadingMsg = addMessage("", false, true);
    try {
        const res = await post("/chat", {message, model: modelSelect.value, chatId: activeChatId});
        if (messagesDiv.contains(loadingMsg)) messagesDiv.removeChild(loadingMsg);
        if (res.reply) {
            currentMessages.push({role: "bot", content: res.reply}); addMessage(res.reply); await loadSummary(); setNotice("Reply received.", "success");
        } else {
            addMessage(`[Error: ${res.error}]`); setNotice(res.error || "Failed to generate reply.", "error");
        }
    } catch {
        if (messagesDiv.contains(loadingMsg)) messagesDiv.removeChild(loadingMsg);
        addMessage("[Error: Network error]"); setNotice("Network error while sending message.", "error");
    } finally {
        setLoadingState(false); msgInput.focus(); updateChatActionState();
    }
}

function togglePersonaPopover(event) {
    event.stopPropagation();
    closeModelPopover();
    const isHidden = personaPopover.classList.contains("hidden");
    personaPopover.classList.toggle("hidden", !isHidden);
    personaMenuButton.setAttribute("aria-expanded", String(isHidden));
}

function toggleModelPopover(event) {
    event.stopPropagation();
    closePersonaPopover();
    const isHidden = modelPopover.classList.contains("hidden");
    modelPopover.classList.toggle("hidden", !isHidden);
    modelMenuButton.setAttribute("aria-expanded", String(isHidden));
}

toggleButtons.forEach((btn) => btn.addEventListener("click", () => showAuthScreen(btn.dataset.target)));
loginForm.addEventListener("submit", (event) => { event.preventDefault(); void handleAuth("login", {username: loginUsernameInput.value.trim(), password: loginPasswordInput.value.trim()}); });
registerForm.addEventListener("submit", (event) => { event.preventDefault(); void handleAuth("register", {username: registerUsernameInput.value.trim(), password: registerPasswordInput.value.trim()}); });
$("logout").addEventListener("click", async () => {
    await post("/logout", {}); chatDiv.style.display = "none"; authDiv.style.display = "grid";
    activeChatId = null; currentUsername = ""; currentSummary = null; chatSessions = []; currentMessages = []; assistantPersonas = []; userPersonas = [];
    activePersonaId = null; activeUserPersonaId = null; publishedPersonaIds = new Set(); messagesDiv.innerHTML = ""; renderChatList(); updateChatActionState();
    showAuthScreen("login"); setAuthMessage("Logged out.", "success"); setNotice("Ready.");
});
sendBtn.addEventListener("click", () => { void sendMessage(); });
msgInput.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } });
msgInput.addEventListener("input", function () { this.style.height = "auto"; this.style.height = `${Math.min(this.scrollHeight, 180)}px`; });
newChatBtn.addEventListener("click", () => { void createNewChat(); });
renameChatBtn.addEventListener("click", () => { if (activeChatId) void renameChat(activeChatId); });
clearChatBtn.addEventListener("click", () => { if (activeChatId) void clearChat(activeChatId); }); exportChatBtn.addEventListener("click", exportCurrentChat);
chatSearchInput.addEventListener("input", renderChatList); modelSelect.addEventListener("change", () => { updateModelHelp(); updateContextRail(); });
newPersonaBtn.addEventListener("click", () => openPersonaForm()); newUserPersonaBtn.addEventListener("click", () => openPersonaForm(null, "user"));
clearPersonaBtn.addEventListener("click", () => { void clearPersona("assistant"); }); clearUserPersonaBtn.addEventListener("click", () => { void clearPersona("user"); });
personaForm.addEventListener("submit", (event) => { event.preventDefault(); void savePersona(); }); personaCloseBtn.addEventListener("click", closePersonaForm);
personaModal.addEventListener("click", (event) => { if (event.target === personaModal) closePersonaForm(); });
modelMenuButton.addEventListener("click", toggleModelPopover); modelPopover.addEventListener("click", (event) => event.stopPropagation());
personaMenuButton.addEventListener("click", togglePersonaPopover); personaPopover.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("click", () => { closeModelPopover(); closePersonaPopover(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeModelPopover(); closePersonaPopover(); closePersonaForm(); } });
window.addEventListener("load", async () => {
    applyTheme(localStorage.getItem("krishd-theme") || "fakegpt", false);
    setNotice("Ready."); updateChatActionState(); await checkSession();
});
