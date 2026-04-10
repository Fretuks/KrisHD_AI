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
const startRoleplayBtn = $("startRoleplay");
const chatListLoading = $("chatListLoading"), chatListLoadingText = $("chatListLoadingText");
const renameChatBtn = $("renameChat"), clearChatBtn = $("clearChat"), exportChatBtn = $("exportChat");
const activeChatTitle = $("activeChatTitle"), sessionUser = $("sessionUser");
const chatActivityOverlay = $("chatActivityOverlay"), chatActivityEyebrow = $("chatActivityEyebrow"), chatActivityTitle = $("chatActivityTitle"), chatActivityDetail = $("chatActivityDetail");
const contextChipButton = $("contextChipButton"), contextPopover = $("contextPopover"), contextSummaryLabel = $("contextSummaryLabel");
const chatActionsMenuButton = $("chatActionsMenuButton"), chatActionsPopover = $("chatActionsPopover");
const chatModePill = $("chatModePill"), chatCharacterPill = $("chatCharacterPill"), chatUserPersonaPill = $("chatUserPersonaPill"), chatScenePill = $("chatScenePill");
const personaList = $("personaList"), userPersonaList = $("userPersonaList");
const personaForm = $("personaForm"), personaFormTitle = $("personaFormTitle"), personaTypeSelect = $("personaType");
const personaNameInput = $("personaName"), personaPronounsInput = $("personaPronouns"), personaAppearanceInput = $("personaAppearance");
const personaBackgroundInput = $("personaBackground"), personaDetailsInput = $("personaDetails");
const personaExamplesField = $("personaExamplesField"), personaExampleDialoguesInput = $("personaExampleDialogues");
const personaFormNotice = $("personaFormNotice");
const roleplayNewPersonaBtn = $("roleplayNewPersona"), clearUserPersonaBtn = $("clearUserPersona");
const activePersonaStatus = $("activePersonaStatus"), activeUserPersonaStatus = $("activeUserPersonaStatus");
const personaModal = $("personaModal"), personaCloseBtn = $("personaClose"), personaMenuButton = $("personaMenuButton"), personaPopover = $("personaPopover");
const roleplayStarterModal = $("roleplayStarterModal"), roleplayStarterClose = $("roleplayStarterClose"), roleplayStarterCancel = $("roleplayStarterCancel"), roleplayStarterConfirm = $("roleplayStarterConfirm");
const roleplayStarterNotice = $("roleplayStarterNotice"), roleplayCharacterSelect = $("roleplayCharacterSelect"), roleplayUserPersonaSelect = $("roleplayUserPersonaSelect");
const roleplayScenarioInput = $("roleplayScenarioInput"), roleplayStarterSuggestions = $("roleplayStarterSuggestions");
const popupModal = $("popupModal"), popupCloseBtn = $("popupClose"), popupCancelBtn = $("popupCancel"), popupConfirmBtn = $("popupConfirm");
const popupTitle = $("popupTitle"), popupEyebrow = $("popupEyebrow"), popupDescription = $("popupDescription"), popupField = $("popupField");
const popupInputLabel = $("popupInputLabel"), popupInput = $("popupInput");
const appNotice = $("appNotice"), quickPrompts = $("quickPrompts");
const onboardingModal = $("onboardingModal"), onboardingTitle = $("onboardingTitle"), onboardingSubtitle = $("onboardingSubtitle");
const onboardingChoices = $("onboardingChoices"), onboardingBack = $("onboardingBack"), onboardingContinue = $("onboardingContinue"), onboardingSkip = $("onboardingSkip");
const authScreens = document.querySelectorAll(".auth-screen"), toggleButtons = document.querySelectorAll(".auth-toggle .toggle");
const themeNameTargets = document.querySelectorAll("[data-theme-name]"), themeLogoTargets = document.querySelectorAll("[data-theme-logo]");
const modelMenu = document.querySelector(".model-menu"), personaMenu = document.querySelector(".persona-menu");
const requestedChatId = Number(new URLSearchParams(window.location.search).get("chat")) || null;

let isProcessing = false, activeChatId = null, editingPersonaId = null, editingPersonaType = "assistant", currentUsername = "";
let chatSessions = [], currentMessages = [], assistantPersonas = [], userPersonas = [];
let activeUserPersonaId = null, currentSummary = null, publishedPersonaIds = new Set();
let popupResolver = null, popupMode = null, popupLastFocus = null;
let roleplayPresetCharacterId = null;
let noticeTimer = null;
let workspaceMode = localStorage.getItem("krishd-workspace-mode") || "basic";
let onboardingStep = 1, onboardingIntent = "ask";
let chatLoadingDepth = 0;
let chatActivityDepth = 0;
let messageRetryState = new Map();

const onboardingPrompts = {
    ask: ["Explain this topic in simple terms.", "Compare these options and recommend one."],
    brainstorm: ["Give me 10 practical ideas for this problem.", "Suggest 3 creative directions and tradeoffs."],
    roleplay: ["Start a roleplay scene with immediate tension.", "Give me a dramatic opening with clear stakes."]
};

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
function setNotice(message = "", state = "") {
    if (!appNotice) return {message, state};
    if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
    }
    if (!message) {
        appNotice.textContent = "";
        appNotice.className = "status inline-status hidden";
        return {message, state};
    }
    appNotice.textContent = message;
    appNotice.className = state ? `status inline-status ${state}` : "status inline-status";
    noticeTimer = window.setTimeout(() => {
        if (appNotice.textContent === message) {
            appNotice.textContent = "";
            appNotice.className = "status inline-status hidden";
        }
    }, state === "error" ? 6000 : 3200);
    return {message, state};
}
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

function setChatLoading(active, message = "Loading chats...") {
    if (!chatListLoading || !chatListLoadingText) return;
    if (active) {
        chatLoadingDepth += 1;
        chatListLoadingText.textContent = message;
        chatListLoading.classList.remove("hidden");
        return;
    }
    chatLoadingDepth = Math.max(0, chatLoadingDepth - 1);
    if (chatLoadingDepth === 0) {
        chatListLoading.classList.add("hidden");
        chatListLoadingText.textContent = "Loading chats...";
    }
}

function setChatActivity(active, {eyebrow = "Please wait", title = "Preparing chat", detail = "The assistant is still working."} = {}) {
    if (!chatActivityOverlay || !chatActivityEyebrow || !chatActivityTitle || !chatActivityDetail) return;
    if (active) {
        chatActivityDepth += 1;
        chatActivityEyebrow.textContent = eyebrow;
        chatActivityTitle.textContent = title;
        chatActivityDetail.textContent = detail;
        chatActivityOverlay.classList.remove("hidden");
        return;
    }
    chatActivityDepth = Math.max(0, chatActivityDepth - 1);
    if (chatActivityDepth === 0) {
        chatActivityOverlay.classList.add("hidden");
        chatActivityEyebrow.textContent = "Please wait";
        chatActivityTitle.textContent = "Preparing chat";
        chatActivityDetail.textContent = "The assistant is still working.";
    }
}

function applyWorkspaceMode(nextMode, persist = true) {
    workspaceMode = nextMode === "advanced" ? "advanced" : "basic";
    document.body.dataset.workspaceMode = workspaceMode;
    if (persist) localStorage.setItem("krishd-workspace-mode", workspaceMode);
    if (workspaceMode === "basic") {
        closeModelPopover();
        closePersonaPopover();
    }
    if (modelMenu) modelMenu.classList.toggle("hidden", workspaceMode === "basic");
    if (personaMenu) personaMenu.classList.toggle("hidden", workspaceMode === "basic");
    updateComposerPlaceholder();
    renderQuickPrompts();
}

function hasCompletedOnboarding() {
    return localStorage.getItem("krishd-onboarding-complete") === "true";
}

function markOnboardingCompleted() {
    localStorage.setItem("krishd-onboarding-complete", "true");
    closeOnboarding();
}

function closeOnboarding() {
    if (!onboardingModal) return;
    onboardingModal.classList.add("hidden");
}

function renderOnboardingStep() {
    if (!onboardingChoices || !onboardingTitle || !onboardingSubtitle) return;
    onboardingChoices.innerHTML = "";
    onboardingBack.classList.toggle("hidden", onboardingStep === 1);
    onboardingContinue.classList.toggle("hidden", onboardingStep === 2);
    if (onboardingStep === 1) {
        onboardingTitle.textContent = "What do you want to do?";
        onboardingSubtitle.textContent = "Choose one path. You can switch anytime.";
        [["ask", "Ask questions"], ["brainstorm", "Brainstorm ideas"], ["roleplay", "Roleplay with a character"]].forEach(([key, label]) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `secondary-action${onboardingIntent === key ? " active" : ""}`;
            button.textContent = label;
            button.addEventListener("click", () => {
                onboardingIntent = key;
                renderOnboardingStep();
            });
            onboardingChoices.appendChild(button);
        });
        return;
    }
    onboardingTitle.textContent = "Choose a starter";
    onboardingSubtitle.textContent = "Pick one template and send your first message.";
    onboardingPrompts[onboardingIntent].forEach((template) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-action";
        button.textContent = template;
        button.addEventListener("click", async () => {
            if (onboardingIntent === "roleplay") {
                closeOnboarding();
                if (assistantPersonas.length) {
                    openRoleplayStarter();
                } else {
                    openPersonaForm(null, "assistant");
                }
                return;
            }
            if (!activeChatId) await createNewChat();
            msgInput.value = template;
            msgInput.dispatchEvent(new Event("input"));
            msgInput.focus();
            closeOnboarding();
        });
        onboardingChoices.appendChild(button);
    });
}

function maybeShowOnboarding() {
    if (!onboardingModal || hasCompletedOnboarding()) return;
    onboardingStep = 1;
    onboardingIntent = "ask";
    renderOnboardingStep();
    onboardingModal.classList.remove("hidden");
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
function summarizeText(value, limit = 96) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    return normalized.length > limit ? `${normalized.slice(0, limit - 3).trimEnd()}...` : normalized;
}
function getPersonaName(id, items) {
    return items.find((persona) => persona.id === id)?.name || "";
}
function getRoleplayStarterSuggestions() {
    const assistantPersonaId = Number(roleplayCharacterSelect?.value);
    const userPersonaId = roleplayUserPersonaSelect?.value ? Number(roleplayUserPersonaSelect.value) : null;
    const assistantName = getPersonaName(assistantPersonaId, assistantPersonas) || "the character";
    const userName = userPersonaId ? getPersonaName(userPersonaId, userPersonas) : "me";
    return [
        `${assistantName} unexpectedly crosses paths with ${userName} in a place that matters to them both.`,
        `${assistantName} already knows something important about ${userName} and confronts them with it.`,
        `${assistantName} and ${userName} are forced to cooperate while something goes wrong around them.`,
        `${assistantName} meets ${userName} in a quiet, intimate scene with unresolved tension.`,
        `${assistantName} draws ${userName} into a high-stakes problem that starts immediately.`
    ];
}
function updateRoleplaySuggestions() {
    if (!roleplayStarterSuggestions) return;
    roleplayStarterSuggestions.innerHTML = "";
    getRoleplayStarterSuggestions().forEach((suggestion) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "prompt-chip";
        button.textContent = suggestion;
        button.addEventListener("click", () => {
            if (roleplayScenarioInput) {
                roleplayScenarioInput.value = suggestion;
                roleplayScenarioInput.focus();
            }
        });
        roleplayStarterSuggestions.appendChild(button);
    });
}
function getQuickPromptsForChat(chat) {
    return [];
}
function renderQuickPrompts() {
    if (!quickPrompts) return;
    const activeChat = getChatById(activeChatId);
    const prompts = getQuickPromptsForChat(activeChat);
    const visiblePrompts = workspaceMode === "basic" ? prompts.slice(0, 3) : prompts;
    quickPrompts.innerHTML = "";
    quickPrompts.classList.toggle("hidden", visiblePrompts.length === 0);
    visiblePrompts.forEach((prompt) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "prompt-chip";
        button.textContent = prompt;
        button.addEventListener("click", () => {
            msgInput.value = prompt;
            msgInput.dispatchEvent(new Event("input"));
            msgInput.focus();
        });
        quickPrompts.appendChild(button);
    });
}
function updateComposerPlaceholder() {
    const activeChat = getChatById(activeChatId);
    if (!activeChat) {
        msgInput.placeholder = "Create a chat to begin...";
        return;
    }
    if (activeChat.assistant_persona_id) {
        msgInput.placeholder = "Continue the scene...";
        return;
    }
    msgInput.placeholder = workspaceMode === "basic" ? "Ask anything..." : "Type your message...";
}

function updateSendState() {
    const hasText = Boolean(msgInput.value.trim());
    sendBtn.disabled = isProcessing || !hasText;
}

function getNewestMessage() {
    return currentMessages.length ? currentMessages[currentMessages.length - 1] : null;
}

function getMessageIndexById(messageId) {
    return currentMessages.findIndex((message) => message.id === messageId);
}

async function resolveMessageTarget(messageId, fallbackIndex = -1) {
    if (messageId) {
        const index = getMessageIndexById(messageId);
        if (index >= 0) {
            return {index, message: currentMessages[index]};
        }
    }
    if (activeChatId) {
        await setActiveChat(activeChatId);
    }
    if (messageId) {
        const index = getMessageIndexById(messageId);
        if (index >= 0) {
            return {index, message: currentMessages[index]};
        }
    }
    if (fallbackIndex >= 0 && fallbackIndex < currentMessages.length) {
        return {index: fallbackIndex, message: currentMessages[fallbackIndex]};
    }
    return null;
}

function getMessageEndpoint(target, suffix = "") {
    if (!activeChatId || !target) return "";
    if (target.message?.id) return `/chats/${activeChatId}/messages/${target.message.id}${suffix}`;
    if (target.index >= 0) return `/chats/${activeChatId}/messages/by-index/${target.index}${suffix}`;
    return "";
}

function getPreviousUserMessageId(messageId) {
    const index = getMessageIndexById(messageId);
    if (index <= 0) return null;
    for (let i = index - 1; i >= 0; i -= 1) {
        if (currentMessages[i].role === "user" && currentMessages[i].id) {
            return currentMessages[i].id;
        }
    }
    return null;
}

function getRetryStateFromMessage(message) {
    const variants = Array.isArray(message?.retryVariants) && message.retryVariants.length
        ? [...message.retryVariants]
        : [message?.content || ""];
    const requestedActiveIndex = Number(message?.retryActiveIndex);
    const activeIndex = Number.isInteger(requestedActiveIndex)
        ? Math.min(Math.max(requestedActiveIndex, 0), variants.length - 1)
        : 0;
    return {
        variants,
        activeIndex,
        retriesUsed: Number(message?.retryRetriesUsed || 0),
        promptMessageId: message?.retryPromptMessageId ?? getPreviousUserMessageId(message?.id)
    };
}

function syncRetryStateFromMessage(message) {
    if (!message?.id) return null;
    const state = getRetryStateFromMessage(message);
    messageRetryState.set(message.id, state);
    return state;
}

function ensureRetryState(message) {
    if (!message?.id) return null;
    let state = messageRetryState.get(message.id);
    if (!state) {
        state = syncRetryStateFromMessage(message);
    }
    return state;
}

async function editChatMessage(messageId, fallbackIndex = -1) {
    const target = await resolveMessageTarget(messageId, fallbackIndex);
    if (!target) return setNotice("Message is not ready yet. Try again.", "error");
    const {index, message} = target;
    const nextContent = await promptPopup({
        eyebrow: message.role === "user" ? "Your message" : "Assistant message",
        title: "Edit message",
        description: "Update this message.",
        label: "Message",
        value: message.content,
        confirmLabel: "Save"
    });
    const content = (nextContent || "").trim();
    if (!content) return;
    const endpoint = getMessageEndpoint(target);
    if (!endpoint) return setNotice("Message is not ready yet. Try again.", "error");
    const res = await put(endpoint, {content});
    if (res.error || !res.message) {
        return setNotice(res.error || "Unable to edit message.", "error");
    }
    currentMessages[index] = {...currentMessages[index], ...res.message};
    syncRetryStateFromMessage(currentMessages[index]);
    renderMessages();
    setNotice("Message updated.", "success");
}

async function deleteChatMessage(messageId, fallbackIndex = -1) {
    const target = await resolveMessageTarget(messageId, fallbackIndex);
    if (!target) return setNotice("Message is not ready yet. Try again.", "error");
    const {index, message} = target;
    const confirmed = await confirmPopup({
        eyebrow: message.role === "user" ? "Your message" : "Assistant message",
        title: "Delete message",
        description: "Delete this message from the chat?",
        confirmLabel: "Delete",
        danger: true
    });
    if (!confirmed) return;
    const endpoint = getMessageEndpoint(target);
    if (!endpoint) return setNotice("Message is not ready yet. Try again.", "error");
    const res = await del(endpoint);
    if (res.error) return setNotice(res.error, "error");
    currentMessages = currentMessages.filter((item) => item.id !== message.id);
    if (message.id) {
        messageRetryState.delete(message.id);
        for (const [key, state] of messageRetryState.entries()) {
            if (state.promptMessageId === message.id) {
                messageRetryState.delete(key);
            }
        }
    }
    renderMessages();
    await loadSummary();
    setNotice("Message deleted.", "success");
}

async function retryLatestAssistantMessage(messageId, fallbackIndex = -1) {
    const target = await resolveMessageTarget(messageId, fallbackIndex);
    if (!target) return setNotice("Message is not ready yet. Try again.", "error");
    const newest = getNewestMessage();
    const sameNewest = target.index === currentMessages.length - 1;
    if (!newest || !sameNewest || newest.role !== "bot") {
        return setNotice("Only the newest assistant message can be retried.", "error");
    }
    const state = ensureRetryState(newest) || {variants: [newest.content || ""], activeIndex: 0, retriesUsed: 0, promptMessageId: null};
    if (!state || state.retriesUsed >= 5) {
        return setNotice("Retry limit reached (5).", "error");
    }
    setLoadingState(true, {
        eyebrow: "Regenerating",
        title: "Generating another version",
        detail: "The assistant is rewriting the latest reply."
    });
    setNotice("Regenerating reply...");
    try {
        const endpoint = getMessageEndpoint(target, "/retry");
        if (!endpoint) return setNotice("Message is not ready yet. Try again.", "error");
        const res = await post(endpoint, {model: modelSelect.value});
        if (res.error || !res.message?.content) {
            return setNotice(res.error || "Unable to retry message.", "error");
        }
        const updateIndex = target.message?.id ? getMessageIndexById(target.message.id) : target.index;
        if (updateIndex >= 0) {
            currentMessages[updateIndex] = {...currentMessages[updateIndex], ...res.message};
            syncRetryStateFromMessage(currentMessages[updateIndex]);
        }
        const nextState = res.message?.id ? messageRetryState.get(res.message.id) : state;
        setNotice(`Reply regenerated (${nextState?.retriesUsed || state.retriesUsed}/5).`, "success");
    } finally {
        setLoadingState(false);
        renderMessages();
    }
}

async function switchRetryVariant(messageId, direction, fallbackIndex = -1) {
    const target = await resolveMessageTarget(messageId, fallbackIndex);
    if (!target) return setNotice("Message is not ready yet. Try again.", "error");
    const newest = getNewestMessage();
    const sameNewest = target.index === currentMessages.length - 1;
    if (!newest || !sameNewest || newest.role !== "bot") {
        return setNotice("Variants can only be switched on the newest assistant message.", "error");
    }
    const state = target.message?.id ? messageRetryState.get(target.message.id) : null;
    if (!state || state.variants.length < 2) return;
    const nextIndex = state.activeIndex + direction;
    if (nextIndex < 0 || nextIndex >= state.variants.length) return;
    const targetContent = state.variants[nextIndex];
    const endpoint = getMessageEndpoint(target);
    if (!endpoint) return setNotice("Message is not ready yet. Try again.", "error");
    const res = await put(endpoint, {content: targetContent, retryActiveIndex: nextIndex});
    if (res.error || !res.message) {
        return setNotice(res.error || "Unable to switch variant.", "error");
    }
    const updateIndex = target.message?.id ? getMessageIndexById(target.message.id) : target.index;
    if (updateIndex >= 0) {
        currentMessages[updateIndex] = {...currentMessages[updateIndex], ...res.message};
        syncRetryStateFromMessage(currentMessages[updateIndex]);
    }
    renderMessages();
}

function addMessage(contentOrMessage, isUser = false, isLoading = false, options = {}) {
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
        const message = typeof contentOrMessage === "object" && contentOrMessage
            ? contentOrMessage
            : {id: null, role: isUser ? "user" : "bot", content: String(contentOrMessage || "")};
        const isMessageUser = message.role === "user";
        msgDiv.className = `msg ${isMessageUser ? "user" : "bot"}`;
        const header = document.createElement("div"), body = document.createElement("div"), actions = document.createElement("div");
        header.className = "msg-header"; body.className = "msg-content";
        actions.className = "msg-actions";
        const activeChat = getChatById(activeChatId);
        header.textContent = isMessageUser ? "You" : (activeChat?.assistant_persona_name || "Assistant");
        setMessageContent(body, message.content);

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "msg-action-btn";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => {
            void editChatMessage(message.id, options.messageIndex ?? -1);
        });
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "msg-action-btn";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
            void deleteChatMessage(message.id, options.messageIndex ?? -1);
        });
        actions.appendChild(deleteBtn);

        if (options.isNewest && message.role === "bot") {
            const state = message.id ? ensureRetryState(message) : {retriesUsed: 0, variants: [], activeIndex: 0};
            const retryBtn = document.createElement("button");
            retryBtn.type = "button";
            retryBtn.className = "msg-action-btn";
            retryBtn.textContent = `Retry (${state.retriesUsed}/5)`;
            retryBtn.disabled = state.retriesUsed >= 5 || isProcessing;
            retryBtn.addEventListener("click", () => {
                void retryLatestAssistantMessage(message.id, options.messageIndex ?? -1);
            });
            actions.appendChild(retryBtn);

            if (state.variants.length > 1) {
                const prevBtn = document.createElement("button");
                prevBtn.type = "button";
                prevBtn.className = "msg-action-btn";
                prevBtn.textContent = "Prev";
                prevBtn.disabled = state.activeIndex <= 0;
                prevBtn.addEventListener("click", () => {
                    void switchRetryVariant(message.id, -1, options.messageIndex ?? -1);
                });

                const nextBtn = document.createElement("button");
                nextBtn.type = "button";
                nextBtn.className = "msg-action-btn";
                nextBtn.textContent = "Next";
                nextBtn.disabled = state.activeIndex >= state.variants.length - 1;
                nextBtn.addEventListener("click", () => {
                    void switchRetryVariant(message.id, 1, options.messageIndex ?? -1);
                });

                const indexBadge = document.createElement("span");
                indexBadge.className = "msg-variant-index";
                indexBadge.textContent = `${state.activeIndex + 1}/${state.variants.length}`;
                actions.append(prevBtn, indexBadge, nextBtn);
            }
        }

        msgDiv.append(header, body);
        if (actions.childElementCount) {
            msgDiv.appendChild(actions);
        }
    }
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return msgDiv;
}

function renderMessages() {
    messagesDiv.innerHTML = "";
    const chat = getChatById(activeChatId);
    if (!currentMessages.length && (!chat || chat.assistant_persona_id)) {
        renderMessageEmptyState();
    } else {
        currentMessages.forEach((msg, index) => addMessage(msg, msg.role === "user", false, {
            messageIndex: index,
            isNewest: index === currentMessages.length - 1
        }));
    }
    updateChatParticipants();
    updateChatActionState();
    renderQuickPrompts();
    updateComposerPlaceholder();
}

function createStarterAction(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
}

function createMessageStarterPrompt(label, prompt) {
    return createStarterAction(label, "secondary-action", async () => {
        if (!activeChatId) await createNewChat();
        msgInput.value = prompt;
        msgInput.dispatchEvent(new Event("input"));
        msgInput.focus();
    });
}

function renderMessageEmptyState() {
    const empty = document.createElement("section");
    const title = document.createElement("h3");
    const description = document.createElement("p");
    const actions = document.createElement("div");
    const chat = getChatById(activeChatId);

    empty.className = "messages-empty";
    title.className = "messages-empty-title";
    description.className = "messages-empty-copy";
    actions.className = "messages-empty-actions";

    if (!chat) {
        title.textContent = "Start your first conversation";
        description.textContent = "Create a chat, or jump directly into roleplay.";
        actions.append(
            createStarterAction("New chat", "primary-action", () => { void createNewChat(); }),
            createStarterAction("Start roleplay", "secondary-action", () => {
                if (assistantPersonas.length) {
                    openRoleplayStarter();
                    return;
                }
                openPersonaForm(null, "assistant");
            }),
            createMessageStarterPrompt("Try a starter prompt", "Help me plan my day in 3 steps.")
        );
    } else if (chat.assistant_persona_id) {
        title.textContent = "Your scene is ready";
        description.textContent = "Send your first line, or use a prompt to set the tone.";
        actions.append(
            createMessageStarterPrompt("Add tension", "Open with a tense line that raises the stakes immediately."),
            createMessageStarterPrompt("Set the scene", "Describe what your character notices first in this scene."),
            createStarterAction("Pick another roleplay setup", "secondary-action", () => openRoleplayStarter())
        );
    } else {
        return;
    }

    empty.append(title, description, actions);
    messagesDiv.appendChild(empty);
}

function updateWorkspaceCopy() {
    const activeChat = getChatById(activeChatId);
    if (activeChatTitle) {
        activeChatTitle.textContent = activeChat ? activeChat.title : "New chat";
    }
    if (sessionUser) {
        sessionUser.textContent = currentUsername || "-";
    }
    updateChatParticipants();
    renderQuickPrompts();
    updateComposerPlaceholder();
}

function setRoleplayStarterNotice(message = "", state = "") {
    if (!roleplayStarterNotice) return;
    if (!message) {
        roleplayStarterNotice.textContent = "";
        roleplayStarterNotice.className = "status hidden";
        return;
    }
    roleplayStarterNotice.textContent = message;
    roleplayStarterNotice.className = state ? `status ${state}` : "status";
}

function updateChatParticipants() {
    const chat = getChatById(activeChatId);
    if (!chatModePill || !chatCharacterPill || !chatUserPersonaPill || !chatScenePill) return;
    if (!chat) {
        chatModePill.textContent = "No chat selected";
        chatCharacterPill.classList.add("hidden");
        chatUserPersonaPill.classList.add("hidden");
        chatScenePill.classList.add("hidden");
        if (contextSummaryLabel) contextSummaryLabel.textContent = "None";
        return;
    }
    if (chat.assistant_persona_id) {
        chatModePill.textContent = "Roleplay mode";
        chatCharacterPill.textContent = `Character: ${chat.assistant_persona_name || chat.title}`;
        chatCharacterPill.classList.remove("hidden");
        if (chat.user_persona_id) {
            chatUserPersonaPill.textContent = `You as: ${chat.user_persona_name || "User persona"}`;
            chatUserPersonaPill.classList.remove("hidden");
        } else {
            chatUserPersonaPill.textContent = "You as: yourself";
            chatUserPersonaPill.classList.remove("hidden");
        }
        if (chat.scenario_summary) {
            chatScenePill.textContent = `Scene: ${summarizeText(chat.scenario_summary, 112)}`;
            chatScenePill.classList.remove("hidden");
        } else {
            chatScenePill.classList.add("hidden");
        }
        if (contextSummaryLabel) contextSummaryLabel.textContent = chat.assistant_persona_name || "Roleplay";
        return;
    }
    chatModePill.textContent = "Assistant mode";
    chatCharacterPill.classList.add("hidden");
    chatUserPersonaPill.classList.add("hidden");
    chatScenePill.classList.add("hidden");
    if (contextSummaryLabel) contextSummaryLabel.textContent = "Assistant";
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
    const activeChat = getChatById(activeChatId);
    const hasChat = Boolean(activeChat);
    renameChatBtn.disabled = !hasChat || Boolean(activeChat?.assistant_persona_id);
    clearChatBtn.disabled = !hasChat;
    exportChatBtn.disabled = !hasChat || currentMessages.length === 0;
}

function maybeShowPersonaNudge() {
    if (localStorage.getItem("krishd-persona-nudge-shown") === "true") return;
    const assistantOnlyChats = chatSessions.filter((chat) => !chat.assistant_persona_id).length;
    if (assistantOnlyChats < 3) return;
    localStorage.setItem("krishd-persona-nudge-shown", "true");
    setNotice("Want to personalize responses? Try personas in Tools.", "success");
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
        const item = document.createElement("div"), content = document.createElement("div"), title = document.createElement("span"), meta = document.createElement("small"), remove = document.createElement("button");
        item.className = `chat-item${chat.id === activeChatId ? " active" : ""}`;
        content.className = "chat-item-copy";
        title.textContent = chat.title;
        meta.className = "chat-item-meta";
        meta.textContent = chat.assistant_persona_id
            ? `Roleplay${chat.user_persona_name ? ` · ${chat.user_persona_name}` : ""}`
            : "Assistant chat";
        remove.type = "button"; remove.textContent = "Delete";
        remove.addEventListener("click", async (event) => { event.stopPropagation(); await deleteChat(chat.id); });
        content.append(title, meta);
        item.append(content, remove);
        item.addEventListener("click", () => setActiveChat(chat.id));
        chatList.appendChild(item);
    });
}

function updateActivePersonaStatus(items, activeId, statusEl, emptyText, prefix) {
    const active = items.find((persona) => persona.id === activeId);
    statusEl.textContent = active ? `${prefix}: ${active.name}` : emptyText;
}

function setActivePersonaStatus() {
    if (activePersonaStatus) {
        activePersonaStatus.textContent = assistantPersonas.length
            ? "Choose an AI Character, pair it with a user persona if needed, and start the scene."
            : "No AI Characters yet. Create one to start a roleplay.";
    }
    updateActivePersonaStatus(userPersonas, activeUserPersonaId, activeUserPersonaStatus, "No default user persona set.", "Default user persona");
    if (clearUserPersonaBtn) clearUserPersonaBtn.disabled = !activeUserPersonaId;
    updateContextRail();
}

function openPersonaForm(persona = null, personaType = "assistant") {
    closePersonaPopover();
    closePopup(false);
    personaModal.classList.remove("hidden");
    if (persona) {
        editingPersonaId = persona.id; editingPersonaType = persona.persona_type || "assistant";
        personaFormTitle.textContent = `Edit ${editingPersonaType === "user" ? "your persona" : "AI Character"}`;
        personaTypeSelect.value = editingPersonaType; personaTypeSelect.disabled = true;
        personaNameInput.value = persona.name || ""; personaPronounsInput.value = persona.pronouns || "";
        personaAppearanceInput.value = persona.appearance || ""; personaBackgroundInput.value = persona.background || ""; personaDetailsInput.value = persona.details || "";
        personaExampleDialoguesInput.value = persona.example_dialogues || "";
    } else {
        editingPersonaId = null; editingPersonaType = personaType;
        personaFormTitle.textContent = `Create ${personaType === "user" ? "your persona" : "AI Character"}`;
        personaTypeSelect.value = personaType; personaTypeSelect.disabled = false;
        personaNameInput.value = ""; personaPronounsInput.value = ""; personaAppearanceInput.value = ""; personaBackgroundInput.value = ""; personaDetailsInput.value = "";
        personaExampleDialoguesInput.value = "";
    }
    personaExamplesField.classList.toggle("hidden", personaTypeSelect.value !== "assistant");
    setPersonaFormNotice("");
    personaNameInput.focus();
}

function closePersonaForm() { personaModal.classList.add("hidden"); editingPersonaId = null; editingPersonaType = "assistant"; personaTypeSelect.disabled = false; setPersonaFormNotice(""); }
function closePersonaPopover() { personaPopover.classList.add("hidden"); personaMenuButton.setAttribute("aria-expanded", "false"); }
function closeContextPopover() {
    if (!contextPopover || !contextChipButton) return;
    contextPopover.classList.add("hidden");
    contextChipButton.setAttribute("aria-expanded", "false");
}
function closeChatActionsPopover() {
    if (!chatActionsPopover || !chatActionsMenuButton) return;
    chatActionsPopover.classList.add("hidden");
    chatActionsMenuButton.setAttribute("aria-expanded", "false");
}
function closeAuxiliaryPopovers() {
    closeModelPopover();
    closePersonaPopover();
    closeContextPopover();
    closeChatActionsPopover();
}
function populateRoleplayStarter() {
    if (!roleplayCharacterSelect || !roleplayUserPersonaSelect) return;
    roleplayCharacterSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose AI Character";
    placeholder.disabled = true;
    placeholder.selected = true;
    roleplayCharacterSelect.appendChild(placeholder);
    assistantPersonas.forEach((persona) => {
        const option = document.createElement("option");
        option.value = String(persona.id);
        option.textContent = persona.name;
        option.selected = persona.id === roleplayPresetCharacterId;
        roleplayCharacterSelect.appendChild(option);
    });
    if (roleplayPresetCharacterId) {
        roleplayCharacterSelect.value = String(roleplayPresetCharacterId);
    }
    roleplayUserPersonaSelect.innerHTML = "";
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "Myself (no user persona)";
    roleplayUserPersonaSelect.appendChild(noneOption);
    userPersonas.forEach((persona) => {
        const option = document.createElement("option");
        option.value = String(persona.id);
        option.textContent = persona.name;
        option.selected = persona.id === activeUserPersonaId;
        roleplayUserPersonaSelect.appendChild(option);
    });
    if (assistantPersonas.length === 0) {
        setRoleplayStarterNotice("Create an AI Character first, then start roleplay.", "error");
        roleplayStarterConfirm.disabled = true;
    } else {
        setRoleplayStarterNotice("");
        roleplayStarterConfirm.disabled = false;
    }
    updateRoleplaySuggestions();
}
function openRoleplayStarter(characterId = null) {
    closeAuxiliaryPopovers();
    roleplayPresetCharacterId = characterId;
    populateRoleplayStarter();
    if (roleplayScenarioInput) roleplayScenarioInput.value = "";
    setRoleplayStarterNotice("");
    roleplayStarterModal.classList.remove("hidden");
    if (roleplayCharacterSelect.options.length) roleplayCharacterSelect.focus();
}
function closeRoleplayStarter() {
    if (!roleplayStarterModal) return;
    roleplayStarterModal.classList.add("hidden");
    roleplayPresetCharacterId = null;
    roleplayStarterConfirm.disabled = false;
    if (roleplayScenarioInput) roleplayScenarioInput.value = "";
    setRoleplayStarterNotice("");
}
function closeModelPopover() {
    if (!modelPopover || !modelMenuButton) return;
    modelPopover.classList.add("hidden");
    modelMenuButton.setAttribute("aria-expanded", "false");
}
function isPopupOpen() { return popupModal && !popupModal.classList.contains("hidden"); }
function finishPopup(result) {
    if (typeof popupResolver === "function") popupResolver(result);
    popupResolver = null;
    popupMode = null;
}
function closePopup(resolveValue = null) {
    if (!popupModal || popupModal.classList.contains("hidden")) return;
    popupModal.classList.add("hidden");
    popupField.classList.add("hidden");
    popupInput.value = "";
    popupConfirmBtn.disabled = false;
    const nextFocus = popupLastFocus;
    popupLastFocus = null;
    finishPopup(resolveValue);
    if (nextFocus instanceof HTMLElement) nextFocus.focus();
}
function openPopup(options) {
    if (!popupModal) return Promise.resolve(null);
    if (isPopupOpen()) closePopup(null);
    popupLastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    popupMode = options.mode;
    popupEyebrow.textContent = options.eyebrow || "Action";
    popupTitle.textContent = options.title || "Confirm action";
    popupDescription.textContent = options.description || "";
    popupConfirmBtn.textContent = options.confirmLabel || "Confirm";
    popupCancelBtn.textContent = options.cancelLabel || "Cancel";
    popupConfirmBtn.classList.toggle("danger", Boolean(options.danger));
    popupField.classList.toggle("hidden", options.mode !== "prompt");
    if (options.mode === "prompt") {
        popupInputLabel.textContent = options.label || "Value";
        popupInput.value = options.value || "";
        popupInput.placeholder = options.placeholder || "";
    } else {
        popupInput.value = "";
    }
    popupModal.classList.remove("hidden");
    return new Promise((resolve) => {
        popupResolver = resolve;
        requestAnimationFrame(() => {
            if (options.mode === "prompt") {
                popupInput.focus();
                popupInput.select();
            } else {
                popupConfirmBtn.focus();
            }
        });
    });
}
function confirmPopup(options) {
    return openPopup({...options, mode: "confirm"}).then((result) => Boolean(result));
}
function promptPopup(options) {
    return openPopup({...options, mode: "prompt"}).then((result) => typeof result === "string" ? result : null);
}

function renderPersonaList(items, activeId, listElement, personaType) {
    if (!listElement) {
        setActivePersonaStatus();
        return;
    }
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
        item.className = `persona-item${personaType === "user" && persona.id === activeId ? " active" : ""}`; titleRow.className = "persona-title-row"; actions.className = "persona-item-actions";
        tag.className = `persona-role-tag ${personaType === "user" ? "user" : "ai"}`; tag.textContent = personaType === "user" ? "You" : "AI";
        title.textContent = persona.name; meta.textContent = persona.pronouns ? `Pronouns: ${persona.pronouns}` : "Pronouns: n/a";
        [[personaType === "assistant" ? "Start roleplay" : "Set default", () => equipPersona(persona.id, personaType), personaType === "user" && persona.id === activeId],
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
    activeUserPersonaId = res.activeUserPersonaId || null; publishedPersonaIds = new Set(res.publishedPersonaIds || []);
    renderPersonaList(userPersonas, activeUserPersonaId, userPersonaList, "user");
    populateRoleplayStarter();
    setActivePersonaStatus();
    updateWorkspaceCopy();
}

async function equipPersona(id, type) {
    if (type === "assistant") {
        openRoleplayStarter(id);
        return;
    }
    const res = await post(`/personas/${id}/equip-user`, {});
    if (res.error) return setNotice(res.error, "error");
    activeUserPersonaId = id;
    renderPersonaList(userPersonas, activeUserPersonaId, userPersonaList, "user");
    setNotice("User persona updated.", "success");
}

async function clearPersona(type) {
    if (type !== "user") return;
    const res = await post("/personas/user/clear", {});
    if (res.error) return setNotice(res.error, "error");
    activeUserPersonaId = null;
    renderPersonaList(userPersonas, activeUserPersonaId, userPersonaList, "user");
    setNotice("Persona cleared.", "success");
}

async function savePersona() {
    const payload = {
        personaType: personaTypeSelect.value,
        name: personaNameInput.value.trim(),
        pronouns: personaPronounsInput.value.trim(),
        appearance: personaAppearanceInput.value.trim(),
        background: personaBackgroundInput.value.trim(),
        details: personaDetailsInput.value.trim(),
        exampleDialogues: personaTypeSelect.value === "assistant" ? personaExampleDialoguesInput.value.trim() : ""
    };
    if (!payload.name) return setPersonaFormNotice("Persona name is required.", "error");
    const res = editingPersonaId ? await put(`/personas/${editingPersonaId}`, payload) : await post("/personas", payload);
    if (res.error) return setPersonaFormNotice(res.error, "error");
    const wasEditing = Boolean(editingPersonaId);
    await loadPersonas();
    if (payload.personaType === "assistant") await loadChatSessions();
    closePersonaForm(); setNotice(wasEditing ? "Persona updated." : "Persona created.", "success");
}

async function deletePersona(id) {
    const persona = assistantPersonas.find((item) => item.id === id) || userPersonas.find((item) => item.id === id);
    if (!persona) return;
    const confirmed = await confirmPopup({
        eyebrow: persona.persona_type === "user" ? "Your persona" : "AI Character",
        title: "Delete persona",
        description: `Delete "${persona.name}"? This removes it from your library and any active slot.`,
        confirmLabel: "Delete",
        danger: true
    });
    if (!confirmed) return;
    const res = await del(`/personas/${id}`);
    if (res.error) return setNotice(res.error, "error");
    await loadPersonas();
    if (persona.persona_type === "assistant") await loadChatSessions();
    setNotice("Persona deleted.", "success");
}
async function publishPersona(id) { const res = await post(`/personas/${id}/publish`, {}); if (res.error) return setNotice(res.error, "error"); await loadPersonas(); setNotice("Persona published.", "success"); }
async function unpublishPersona(id) { const res = await post(`/personas/${id}/unpublish`, {}); if (res.error) return setNotice(res.error, "error"); await loadPersonas(); setNotice("Persona unpublished.", "success"); }

function setLoadingState(loading, overlayOptions = null) {
    isProcessing = loading;
    msgInput.disabled = loading;
    sendBtn.classList.toggle("loading", loading);
    if (loading) {
        msgInput.placeholder = "Processing response...";
        setChatActivity(true, overlayOptions || undefined);
    } else {
        setChatActivity(false);
        updateComposerPlaceholder();
    }
    updateSendState();
}

function showAuthScreen(target) {
    authScreens.forEach((screen) => screen.classList.toggle("active", screen.id === `${target}Screen`));
    toggleButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.target === target));
    setAuthMessage("");
}

async function setActiveChat(id) {
    setChatLoading(true, "Opening chat...");
    setChatActivity(true, {
        eyebrow: "Opening chat",
        title: "Loading conversation",
        detail: "Fetching messages and restoring the current scene."
    });
    activeChatId = id;
    messageRetryState = new Map();
    updateWorkspaceCopy(); renderChatList(); updateChatActionState();
    const res = await get(`/chats/${id}/messages`);
    if (res.error) {
        setChatLoading(false);
        setChatActivity(false);
        return setNotice(res.error, "error");
    }
    const existing = getChatById(id);
    if (res.chat && existing) Object.assign(existing, res.chat);
    currentMessages = res.messages || []; renderMessages();
    updateSendState();
    setChatLoading(false);
    setChatActivity(false);
}

async function loadChatSessions() {
    setChatLoading(true, "Loading chats...");
    const res = await get("/chats");
    if (res.error) {
        setChatLoading(false);
        return setNotice(res.error, "error");
    }
    chatSessions = res.chats || []; renderChatList();
    if (chatSessions.length) {
        const preferredChatId = (requestedChatId && getChatById(requestedChatId)) ? requestedChatId : activeChatId && getChatById(activeChatId) ? activeChatId : chatSessions[0].id;
        setChatLoading(false);
        return setActiveChat(preferredChatId);
    }
    activeChatId = null;
    currentMessages = [];
    renderMessages();
    updateWorkspaceCopy();
    updateSendState();
    setChatLoading(false);
    return setNotice("Pick a starting action to begin.", "success");
}

async function createNewChat() {
    setChatLoading(true, "Creating chat...");
    setChatActivity(true, {
        eyebrow: "Creating chat",
        title: "Opening a new conversation",
        detail: "Setting up a fresh chat so you can start sending messages."
    });
    const res = await post("/chats", {title: "New chat"});
    if (res.error || !res.chat) {
        setChatLoading(false);
        setChatActivity(false);
        return setNotice(res.error || "Unable to create chat.", "error");
    }
    chatSessions.unshift(res.chat); await loadSummary(); renderChatList(); await setActiveChat(res.chat.id); setNotice("New chat created.", "success");
    msgInput.focus();
    setChatLoading(false);
    setChatActivity(false);
}

async function startRoleplay() {
    setChatLoading(true, "Starting roleplay...");
    setChatActivity(true, {
        eyebrow: "Starting roleplay",
        title: "Building the opening scene",
        detail: "Generating the first beat and opening the roleplay chat."
    });
    const assistantPersonaId = Number(roleplayCharacterSelect.value);
    const userPersonaId = roleplayUserPersonaSelect.value ? Number(roleplayUserPersonaSelect.value) : null;
    const scenarioPrompt = roleplayScenarioInput?.value.trim() || "";
    if (!assistantPersonaId) {
        setChatLoading(false);
        setChatActivity(false);
        return setRoleplayStarterNotice("Choose a character to start the roleplay.", "error");
    }
    roleplayStarterConfirm.disabled = true;
    setRoleplayStarterNotice("Building the opening scene...");
    const res = await post("/roleplays/start", {
        assistantPersonaId,
        userPersonaId,
        scenarioPrompt,
        model: modelSelect.value
    });
    roleplayStarterConfirm.disabled = false;
    if (res.error || !res.chat) {
        setChatLoading(false);
        setChatActivity(false);
        return setRoleplayStarterNotice(res.error || "Unable to start roleplay.", "error");
    }
    closeRoleplayStarter();
    await loadChatSessions();
    await setActiveChat(res.chat.id);
    setNotice(res.generatedInitialMessage ? "Roleplay started with a fresh scene." : "Roleplay reopened.", "success");
    setChatLoading(false);
    setChatActivity(false);
}

async function renameChat(id) {
    const chat = getChatById(id);
    const nextTitle = chat ? await promptPopup({
        eyebrow: "Conversation",
        title: "Rename chat",
        description: "Choose a new title for this thread.",
        label: "Chat title",
        value: chat.title,
        placeholder: "New chat",
        confirmLabel: "Save"
    }) : "";
    const title = (nextTitle || "").trim();
    if (!chat || !title) return;
    const res = await put(`/chats/${id}`, {title});
    if (res.error) return setNotice(res.error, "error");
    chat.title = title; updateWorkspaceCopy(); renderChatList(); setNotice("Chat renamed.", "success");
}

async function clearChat(id) {
    const chat = getChatById(id);
    if (!chat) return;
    const confirmed = await confirmPopup({
        eyebrow: "Conversation",
        title: "Clear messages",
        description: `Clear all messages in "${chat.title}"? The chat will stay, but its history will be removed.`,
        confirmLabel: "Clear",
        danger: true
    });
    if (!confirmed) return;
    const res = await post(`/chats/${id}/clear`, {});
    if (res.error) return setNotice(res.error, "error");
    messageRetryState = new Map();
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
    setChatLoading(true, "Deleting chat...");
    const chat = getChatById(id);
    if (!chat) {
        setChatLoading(false);
        return;
    }
    const confirmed = await confirmPopup({
        eyebrow: "Conversation",
        title: "Delete chat",
        description: `Delete "${chat.title}"? This permanently removes the conversation.`,
        confirmLabel: "Delete",
        danger: true
    });
    if (!confirmed) {
        setChatLoading(false);
        return;
    }
    const res = await del(`/chats/${id}`);
    if (res.error) {
        setChatLoading(false);
        return setNotice(res.error, "error");
    }
    chatSessions = chatSessions.filter((item) => item.id !== id);
    if (activeChatId === id) { activeChatId = null; currentMessages = []; renderMessages(); }
    messageRetryState = new Map();
    await loadSummary(); renderChatList();
    if (chatSessions.length) await setActiveChat(chatSessions[0].id); else await createNewChat();
    setNotice("Chat deleted.", "success");
    setChatLoading(false);
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
    maybeShowOnboarding();
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
        maybeShowOnboarding();
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
    if (currentChat && !currentChat.assistant_persona_id && currentChat.title === "New chat") {
        const autoTitle = message.length > 40 ? `${message.slice(0, 40)}...` : message;
        currentChat.title = autoTitle; updateWorkspaceCopy(); renderChatList(); await put(`/chats/${activeChatId}`, {title: autoTitle});
    }
    currentMessages.push({role: "user", content: message}); addMessage(message, true); updateChatActionState();
    msgInput.value = ""; msgInput.style.height = "auto"; setLoadingState(true, {
        eyebrow: "Assistant replying",
        title: "Generating response",
        detail: "The assistant is reading your message and preparing a reply."
    }); setNotice("Generating reply...");
    const loadingMsg = addMessage("", false, true);
    try {
        const res = await post("/chat", {message, model: modelSelect.value, chatId: activeChatId});
        if (messagesDiv.contains(loadingMsg)) messagesDiv.removeChild(loadingMsg);
        if (res.reply) {
            await setActiveChat(activeChatId);
            await loadSummary();
            markOnboardingCompleted();
            maybeShowPersonaNudge();
            setNotice("Reply received.", "success");
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
    closeContextPopover();
    closeChatActionsPopover();
    const isHidden = personaPopover.classList.contains("hidden");
    personaPopover.classList.toggle("hidden", !isHidden);
    personaMenuButton.setAttribute("aria-expanded", String(isHidden));
}

function toggleModelPopover(event) {
    event.stopPropagation();
    closePersonaPopover();
    closeContextPopover();
    closeChatActionsPopover();
    const isHidden = modelPopover.classList.contains("hidden");
    modelPopover.classList.toggle("hidden", !isHidden);
    modelMenuButton.setAttribute("aria-expanded", String(isHidden));
}

function toggleContextPopover(event) {
    if (!contextPopover || !contextChipButton) return;
    event.stopPropagation();
    closeModelPopover();
    closePersonaPopover();
    closeChatActionsPopover();
    const isHidden = contextPopover.classList.contains("hidden");
    contextPopover.classList.toggle("hidden", !isHidden);
    contextChipButton.setAttribute("aria-expanded", String(isHidden));
}

function toggleChatActionsPopover(event) {
    if (!chatActionsPopover || !chatActionsMenuButton) return;
    event.stopPropagation();
    closeModelPopover();
    closePersonaPopover();
    closeContextPopover();
    const isHidden = chatActionsPopover.classList.contains("hidden");
    chatActionsPopover.classList.toggle("hidden", !isHidden);
    chatActionsMenuButton.setAttribute("aria-expanded", String(isHidden));
}

toggleButtons.forEach((btn) => btn.addEventListener("click", () => showAuthScreen(btn.dataset.target)));
loginForm.addEventListener("submit", (event) => { event.preventDefault(); void handleAuth("login", {username: loginUsernameInput.value.trim(), password: loginPasswordInput.value.trim()}); });
registerForm.addEventListener("submit", (event) => { event.preventDefault(); void handleAuth("register", {username: registerUsernameInput.value.trim(), password: registerPasswordInput.value.trim()}); });
$("logout").addEventListener("click", async () => {
    await post("/logout", {}); chatDiv.style.display = "none"; authDiv.style.display = "grid";
    activeChatId = null; currentUsername = ""; currentSummary = null; chatSessions = []; currentMessages = []; assistantPersonas = []; userPersonas = [];
    messageRetryState = new Map();
    activeUserPersonaId = null; publishedPersonaIds = new Set(); messagesDiv.innerHTML = ""; renderChatList(); updateChatActionState();
    updateComposerPlaceholder();
    updateSendState();
    showAuthScreen("login"); setAuthMessage("Logged out.", "success"); setNotice("Ready.");
});
sendBtn.addEventListener("click", () => { void sendMessage(); });
msgInput.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } });
msgInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = `${Math.min(this.scrollHeight, 180)}px`;
    updateSendState();
});
newChatBtn.addEventListener("click", () => { void createNewChat(); });
if (startRoleplayBtn) {
    startRoleplayBtn.addEventListener("click", () => {
        window.location.href = "/market?view=ai-characters";
    });
}
renameChatBtn.addEventListener("click", () => { if (activeChatId) void renameChat(activeChatId); });
clearChatBtn.addEventListener("click", () => { if (activeChatId) void clearChat(activeChatId); }); exportChatBtn.addEventListener("click", exportCurrentChat);
chatSearchInput.addEventListener("input", renderChatList); modelSelect.addEventListener("change", () => { updateModelHelp(); updateContextRail(); });
roleplayNewPersonaBtn.addEventListener("click", () => openPersonaForm(null, "assistant"));
clearUserPersonaBtn.addEventListener("click", () => { void clearPersona("user"); });
personaForm.addEventListener("submit", (event) => { event.preventDefault(); void savePersona(); }); personaCloseBtn.addEventListener("click", closePersonaForm);
personaTypeSelect.addEventListener("change", () => {
    const isAssistant = personaTypeSelect.value === "assistant";
    personaExamplesField.classList.toggle("hidden", !isAssistant);
    if (!isAssistant) personaExampleDialoguesInput.value = "";
});
personaModal.addEventListener("click", (event) => { if (event.target === personaModal) closePersonaForm(); });
roleplayStarterClose.addEventListener("click", closeRoleplayStarter);
roleplayStarterCancel.addEventListener("click", closeRoleplayStarter);
roleplayStarterConfirm.addEventListener("click", () => { void startRoleplay(); });
roleplayCharacterSelect.addEventListener("change", updateRoleplaySuggestions);
roleplayUserPersonaSelect.addEventListener("change", updateRoleplaySuggestions);
roleplayStarterModal.addEventListener("click", (event) => { if (event.target === roleplayStarterModal) closeRoleplayStarter(); });
popupConfirmBtn.addEventListener("click", () => {
    if (popupMode === "prompt") {
        closePopup(popupInput.value);
        return;
    }
    closePopup(true);
});
popupCancelBtn.addEventListener("click", () => closePopup(false));
popupCloseBtn.addEventListener("click", () => closePopup(false));
popupModal.addEventListener("click", (event) => { if (event.target === popupModal) closePopup(false); });
popupInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        closePopup(popupInput.value);
    }
});
if (modelMenuButton && modelPopover) {
    modelMenuButton.addEventListener("click", toggleModelPopover);
    modelPopover.addEventListener("click", (event) => event.stopPropagation());
}
if (personaMenuButton && personaPopover) {
    personaMenuButton.addEventListener("click", togglePersonaPopover);
    personaPopover.addEventListener("click", (event) => event.stopPropagation());
}
if (contextChipButton && contextPopover) {
    contextChipButton.addEventListener("click", toggleContextPopover);
    contextPopover.addEventListener("click", (event) => event.stopPropagation());
}
if (chatActionsMenuButton && chatActionsPopover) {
    chatActionsMenuButton.addEventListener("click", toggleChatActionsPopover);
    chatActionsPopover.addEventListener("click", (event) => event.stopPropagation());
}
if (onboardingContinue) {
    onboardingContinue.addEventListener("click", () => {
        onboardingStep = 2;
        renderOnboardingStep();
    });
}
if (onboardingBack) {
    onboardingBack.addEventListener("click", () => {
        onboardingStep = 1;
        renderOnboardingStep();
    });
}
if (onboardingSkip) {
    onboardingSkip.addEventListener("click", markOnboardingCompleted);
}
if (onboardingModal) {
    onboardingModal.addEventListener("click", (event) => {
        if (event.target === onboardingModal) markOnboardingCompleted();
    });
}
document.addEventListener("click", () => { closeAuxiliaryPopovers(); });
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeAuxiliaryPopovers();
        closeRoleplayStarter();
        closePersonaForm();
        closePopup(false);
        closeOnboarding();
    }
});
window.addEventListener("load", async () => {
    applyTheme(localStorage.getItem("krishd-theme") || "fakegpt", false);
    applyWorkspaceMode(localStorage.getItem("krishd-workspace-mode") || "basic", false);
    setNotice("Ready.");
    updateChatActionState();
    updateSendState();
    await checkSession();
});
