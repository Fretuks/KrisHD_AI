const authDiv = document.getElementById("auth");
const chatDiv = document.getElementById("chat");
const authMsg = document.getElementById("authMsg");
const messagesDiv = document.getElementById("messages");

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const loginUsernameInput = document.getElementById("loginUsername");
const loginPasswordInput = document.getElementById("loginPassword");
const registerUsernameInput = document.getElementById("registerUsername");
const registerPasswordInput = document.getElementById("registerPassword");
const loginSubmit = document.getElementById("loginSubmit");
const registerSubmit = document.getElementById("registerSubmit");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("send");
const authScreens = document.querySelectorAll(".auth-screen");
const toggleButtons = document.querySelectorAll(".auth-toggle .toggle");
const chatList = document.getElementById("chatList");
const newChatBtn = document.getElementById("newChat");
const renameChatBtn = document.getElementById("renameChat");
const deleteChatBtn = document.getElementById("deleteChat");
const activeChatTitle = document.getElementById("activeChatTitle");
const personaList = document.getElementById("personaList");
const personaForm = document.getElementById("personaForm");
const personaFormTitle = document.getElementById("personaFormTitle");
const personaNameInput = document.getElementById("personaName");
const personaPronounsInput = document.getElementById("personaPronouns");
const personaAppearanceInput = document.getElementById("personaAppearance");
const personaBackgroundInput = document.getElementById("personaBackground");
const personaDetailsInput = document.getElementById("personaDetails");
const newPersonaBtn = document.getElementById("newPersona");
const clearPersonaBtn = document.getElementById("clearPersona");
const personaCancelBtn = document.getElementById("personaCancel");
const activePersonaStatus = document.getElementById("activePersonaStatus");
const personaModal = document.getElementById("personaModal");
const personaCloseBtn = document.getElementById("personaClose");

let isProcessing = false;
let chatSessions = [];
let activeChatId = null;
let personas = [];
let activePersonaId = null;
let editingPersonaId = null;

const displayModels = async () => {
    const select = document.getElementById("model");

    fetch("/models")
        .then(response => response.json())
        .then(data => {
            select.innerHTML = "";

            data.models.forEach(model => {
                const option = document.createElement("option");
                option.value = model.model;
                option.textContent = model.name;
                select.appendChild(option);
            });
        })
        .catch(err => {
            console.error("Failed to load models:", err);
            select.innerHTML = `<option>Error loading models</option>`;
        });
}

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

function setAuthMessage(msg, state = "") {
    authMsg.textContent = msg;
    authMsg.className = state ? `status ${state}` : 'status';
}

function setMessageContent(element, content) {
    if (window.marked && window.DOMPurify) {
        const rendered = marked.parse(content, {breaks: true});
        element.innerHTML = DOMPurify.sanitize(rendered);
        return;
    }
    element.textContent = content;
}

function addMessage(content, isUser = false, isLoading = false, saveToHistory = true) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${isUser ? 'user' : 'bot'}${isLoading ? ' loading' : ''}`;
    if (isLoading) {
        msgDiv.innerHTML = `
             <div class="typing-indicator">
                 <div class="typing-dot"></div>
                 <div class="typing-dot"></div>
                 <div class="typing-dot"></div>
             </div>
         `;
    } else {
        const header = document.createElement('div');
        header.className = 'msg-header';
        header.textContent = isUser ? 'You' : 'DeepFake';
        const body = document.createElement('div');
        body.className = 'msg-content';
        setMessageContent(body, content);
        msgDiv.appendChild(header);
        msgDiv.appendChild(body);
    }
    messagesDiv.appendChild(msgDiv);
    setTimeout(() => {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }, 100);

    return msgDiv;
}

function clearMessages() {
    messagesDiv.innerHTML = '';
}


function getChatById(chatId) {
    return chatSessions.find(chat => chat.id === chatId);
}

function bumpChat(chatId) {
    const index = chatSessions.findIndex(chat => chat.id === chatId);
    if (index <= 0) return;
    const [chat] = chatSessions.splice(index, 1);
    chatSessions.unshift(chat);
    renderChatList();
}

function updateChatActionState() {
    const hasChat = Boolean(activeChatId);
    renameChatBtn.disabled = !hasChat;
    deleteChatBtn.disabled = !hasChat;
}


function renderChatList() {
    chatList.innerHTML = '';
    if (!chatSessions.length) {
        const empty = document.createElement('p');
        empty.className = 'status';
        empty.textContent = 'No chats yet. Start a new one!';
        chatList.appendChild(empty);
        return;
    }
    chatSessions.forEach(chat => {
        const item = document.createElement('div');
        item.className = `chat-item${chat.id === activeChatId ? ' active' : ''}`;
        const title = document.createElement('span');
        title.textContent = chat.title;
        const actions = document.createElement('button');
        actions.type = 'button';
        actions.textContent = '✕';
        actions.title = 'Delete chat';
        actions.addEventListener('click', (event) => {
            event.stopPropagation();
            deleteChat(chat.id);
        });
        item.appendChild(title);
        item.appendChild(actions);
        item.addEventListener('click', () => setActiveChat(chat.id));
        chatList.appendChild(item);
    });
}

function setActivePersonaStatus() {
    const activePersona = personas.find(persona => persona.id === activePersonaId);
    if (activePersona) {
        activePersonaStatus.textContent = `Equipped: ${activePersona.name}`;
    } else {
        activePersonaStatus.textContent = 'No persona equipped.';
    }
    clearPersonaBtn.disabled = !activePersonaId;
}

function openPersonaForm(persona = null) {
    personaModal.classList.remove("hidden");
    if (persona) {
        editingPersonaId = persona.id;
        personaFormTitle.textContent = "Edit persona";
        personaNameInput.value = persona.name || "";
        personaPronounsInput.value = persona.pronouns || "";
        personaAppearanceInput.value = persona.appearance || "";
        personaBackgroundInput.value = persona.background || "";
        personaDetailsInput.value = persona.details || "";
    } else {
        editingPersonaId = null;
        personaFormTitle.textContent = "Create persona";
        personaNameInput.value = "";
        personaPronounsInput.value = "";
        personaAppearanceInput.value = "";
        personaBackgroundInput.value = "";
        personaDetailsInput.value = "";
    }

    personaNameInput.focus();
}

function closePersonaForm() {
    personaModal.classList.add("hidden");
    editingPersonaId = null;
}

function renderPersonaList() {
    personaList.innerHTML = '';
    if (!personas.length) {
        const empty = document.createElement('p');
        empty.className = 'status persona-status';
        empty.textContent = 'No personas yet. Create one to get started.';
        personaList.appendChild(empty);
        setActivePersonaStatus();
        return;
    }
    personas.forEach(persona => {
        const item = document.createElement('div');
        item.className = `persona-item${persona.id === activePersonaId ? ' active' : ''}`;
        const title = document.createElement('h4');
        title.textContent = persona.name;
        const meta = document.createElement('p');
        meta.textContent = persona.pronouns ? `Pronouns: ${persona.pronouns}` : 'Pronouns: —';
        const actions = document.createElement('div');
        actions.className = 'persona-item-actions';

        const equipBtn = document.createElement('button');
        equipBtn.type = 'button';
        equipBtn.textContent = persona.id === activePersonaId ? 'Equipped' : 'Equip';
        equipBtn.disabled = persona.id === activePersonaId;
        equipBtn.addEventListener('click', () => equipPersona(persona.id));

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => openPersonaForm(persona));

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => deletePersona(persona.id));

        actions.appendChild(equipBtn);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(title);
        item.appendChild(meta);
        item.appendChild(actions);
        personaList.appendChild(item);
    });
    setActivePersonaStatus();
}

async function loadPersonas() {
    const res = await get('/personas');
    if (res.error) return;
    personas = res.personas || [];
    activePersonaId = res.activePersonaId || null;
    renderPersonaList();
}

async function equipPersona(personaId) {
    const res = await post(`/personas/${personaId}/equip`, {});
    if (res.error) return;
    activePersonaId = personaId;
    renderPersonaList();
}

async function clearPersona() {
    const res = await post('/personas/clear', {});
    if (res.error) return;
    activePersonaId = null;
    renderPersonaList();
}

async function savePersona() {
    const payload = {
        name: personaNameInput.value.trim(),
        pronouns: personaPronounsInput.value.trim(),
        appearance: personaAppearanceInput.value.trim(),
        background: personaBackgroundInput.value.trim(),
        details: personaDetailsInput.value.trim()
    };
    if (!payload.name) return;
    let res;
    if (editingPersonaId) {
        res = await request(`/personas/${editingPersonaId}`, payload, "PUT");
    } else {
        res = await post('/personas', payload);
    }
    if (res.error) return;
    await loadPersonas();
    closePersonaForm();
}

async function deletePersona(personaId) {
    const persona = personas.find(item => item.id === personaId);
    if (!persona) return;
    const confirmDelete = confirm(`Delete persona "${persona.name}"?`);
    if (!confirmDelete) return;
    const res = await request(`/personas/${personaId}`, null, "DELETE");
    if (res.error) return;
    await loadPersonas();
}

function setLoadingState(loading) {
    isProcessing = loading;
    sendBtn.disabled = loading;
    msgInput.disabled = loading;

    if (loading) {
        sendBtn.classList.add('loading');
        msgInput.placeholder = "Processing response...";
    } else {
        sendBtn.classList.remove('loading');
        msgInput.placeholder = "Type your message...";
    }
}

function showAuthScreen(target) {
    authScreens.forEach(screen => {
        screen.classList.toggle('active', screen.id === `${target}Screen`);
    });
    toggleButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.target === target);
    });
    setAuthMessage('', '');
}

function setActiveChat(chatId) {
    activeChatId = chatId;
    const chat = getChatById(chatId);
    activeChatTitle.textContent = chat ? chat.title : 'New chat';
    updateChatActionState();
    renderChatList();
    if (chatId) {
        loadChatMessages(chatId);
    } else {
        clearMessages();
    }
}


async function loadChatSessions() {
    const res = await get('/chats');
    if (res.error) return;
    chatSessions = res.chats || [];
    renderChatList();
    const activeExists = chatSessions.find(chat => chat.id === activeChatId);
    if (activeExists) {
        setActiveChat(activeChatId);
        return;
    }
    if (!chatSessions.length) {
        await createNewChat();
        return;
    }
    setActiveChat(chatSessions[0].id);
}

async function loadChatMessages(chatId) {
    const res = await get(`/chats/${chatId}/messages`);
    if (res.error) return;
    clearMessages();
    (res.messages || []).forEach(msg => {
        addMessage(msg.content, msg.role === 'user', false, false);

    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function createNewChat() {
    const res = await post('/chats', {title: 'New chat'});
    if (res.error || !res.chat) return;
    chatSessions.unshift(res.chat);
    setActiveChat(res.chat.id);
    renderChatList();
}

async function renameChat(chatId) {
    const chat = getChatById(chatId);
    if (!chat) return;
    const nextTitle = prompt('Rename chat', chat.title);
    if (!nextTitle) return;
    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) return;
    const res = await request(`/chats/${chatId}`, {title: trimmedTitle}, "PUT");
    if (res.error) return;
    chat.title = trimmedTitle;
    activeChatTitle.textContent = trimmedTitle;
    renderChatList();
}


async function deleteChat(chatId) {
    const chat = getChatById(chatId);
    if (!chat) return;
    const confirmDelete = confirm(`Delete "${chat.title}"? This cannot be undone.`);
    if (!confirmDelete) return;
    const res = await request(`/chats/${chatId}`, null, "DELETE");
    if (res.error) return;
    chatSessions = chatSessions.filter(item => item.id !== chatId);
    if (activeChatId === chatId) {
        if (chatSessions.length) {
            setActiveChat(chatSessions[0].id);
        } else {
            activeChatId = null;
            await createNewChat();
        }
    }
    renderChatList();
}

async function checkSession() {
    const res = await get('/session');
    if (res.user) {
        authDiv.style.display = "none";
        chatDiv.style.display = "block";
        await loadChatSessions();
        await loadPersonas();
        msgInput.focus();
        return true;
    }
    return false;
}

async function loadServerChat() {
    await loadChatSessions();
    await loadPersonas();
}

async function handleAuth(endpoint, credentials) {
    const {username, password} = credentials;
    const submitBtn = endpoint === "login" ? loginSubmit : registerSubmit;

    if (!username || !password) {
        setAuthMessage("Please enter both username and password.", 'error');
        return;
    }

    submitBtn.disabled = true;
    setAuthMessage("Processing...", '');

    const res = await post(`/${endpoint}`, {username, password});

    submitBtn.disabled = false;

    if (res.error) {
        setAuthMessage(res.error, 'error');
    } else {
        if (endpoint === "login") {
            setAuthMessage("Login successful! Redirecting to chat...", 'success');
            authDiv.style.display = "none";
            chatDiv.style.display = "block";
            await loadServerChat();
            msgInput.focus();
        } else {
            setAuthMessage("Registration successful — you can now log in!", 'success');
            showAuthScreen('login');
            loginUsernameInput.value = username;
            loginPasswordInput.focus();
        }
    }
}

async function sendMessage() {
    if (isProcessing) return;
    const msg = msgInput.value.trim();
    if (!msg) return;
    if (!activeChatId) {
        await createNewChat();
    }
    const currentChat = getChatById(activeChatId);
    if (currentChat && currentChat.title === 'New chat') {
        const autoTitle = msg.length > 40 ? `${msg.slice(0, 40)}…` : msg;
        currentChat.title = autoTitle;
        activeChatTitle.textContent = autoTitle;
        renderChatList();
        await request(`/chats/${activeChatId}`, {title: autoTitle}, "PUT");
    }
    addMessage(msg, true);
    msgInput.value = "";
    msgInput.style.height = 'auto';
    setLoadingState(true);
    const loadingMsg = addMessage('', false, true, false);
    try {
        const model = document.getElementById("model").value;
        const res = await post("/chat", {message: msg, model, chatId: activeChatId});
        if (messagesDiv.contains(loadingMsg)) {
            messagesDiv.removeChild(loadingMsg);
        }
        if (res.reply) {
            addMessage(res.reply, false);
            bumpChat(activeChatId);
        } else {
            addMessage(`[Error: ${res.error}]`, false);
        }
    } catch (error) {
        if (messagesDiv.contains(loadingMsg)) {
            messagesDiv.removeChild(loadingMsg);
        }
        addMessage(`[Error: Network error]`, false);
    } finally {
        setLoadingState(false);
        msgInput.focus();
    }
}

toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => showAuthScreen(btn.dataset.target));
});

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleAuth("login", {
        username: loginUsernameInput.value.trim(),
        password: loginPasswordInput.value.trim()
    });
});

registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleAuth("register", {
        username: registerUsernameInput.value.trim(),
        password: registerPasswordInput.value.trim()
    });
});

document.getElementById("logout").onclick = async () => {
    await post("/logout", {});
    chatDiv.style.display = "none";
    authDiv.style.display = "grid";
    clearMessages();
    chatSessions = [];
    activeChatId = null;
    personas = [];
    activePersonaId = null;
    setAuthMessage("Logged out.", 'success');
    showAuthScreen('login');
    loginUsernameInput.value = "";
    loginPasswordInput.value = "";
};

sendBtn.onclick = sendMessage;

msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

newChatBtn.addEventListener('click', () => createNewChat());

renameChatBtn.addEventListener('click', () => {
    if (activeChatId) {
        renameChat(activeChatId);
    }
});

deleteChatBtn.addEventListener('click', () => {
    if (activeChatId) {
        deleteChat(activeChatId);
    }
});

msgInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

newPersonaBtn.addEventListener('click', () => openPersonaForm());

clearPersonaBtn.addEventListener('click', () => clearPersona());

personaForm.addEventListener('submit', (event) => {
    event.preventDefault();
    savePersona();
});

personaCloseBtn.addEventListener("click", closePersonaForm);

personaModal.addEventListener("click", (e) => {
    if (e.target === personaModal) closePersonaForm();
});

window.addEventListener('load', () => {
    checkSession();
    displayModels();
});
