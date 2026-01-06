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

let isProcessing = false;
let chatHistory = JSON.parse(localStorage.getItem('chatHistory')) || [];

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

async function post(url, data) {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (err) {
        return {error: "Network error — please try again."};
    }
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
        msgDiv.textContent = content;

        if (saveToHistory) {
            chatHistory.push({
                content: content,
                isUser: isUser,
                timestamp: Date.now()
            });
            localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
        }
    }

    messagesDiv.appendChild(msgDiv);

    setTimeout(() => {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }, 100);

    return msgDiv;
}

function loadChatHistory() {
    messagesDiv.innerHTML = '';
    chatHistory.forEach(msg => {
        addMessage(msg.content, msg.isUser, false, false);
    });
}

function clearChatHistory() {
    chatHistory = [];
    localStorage.removeItem('chatHistory');
    messagesDiv.innerHTML = '';
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

async function checkSession() {
    const res = await get('/session');
    if (res.user) {
        authDiv.style.display = "none";
        chatDiv.style.display = "grid";
        loadChatHistory();
        msgInput.focus();
        return true;
    }
    return false;
}

async function loadServerChat() {
    const res = await get("/chat/history");
    if (res.history && res.history.length) {
        messagesDiv.innerHTML = '';
        res.history.forEach(msg => {
            addMessage(
                msg.content,
                msg.role === "user",
                false,
                false
            );
        });
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

async function handleAuth(endpoint, credentials) {
    const { username, password } = credentials;
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
            chatDiv.style.display = "grid";
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
    addMessage(`You: ${msg}`, true);
    msgInput.value = "";
    msgInput.style.height = 'auto';
    setLoadingState(true);
    const loadingMsg = addMessage('', false, true, false);
    try {
        const model = document.getElementById("model").value;
        const res = await post("/chat", {message: msg, model});
        if (messagesDiv.contains(loadingMsg)) {
            messagesDiv.removeChild(loadingMsg);
        }
        if (res.reply) {
            addMessage(`DeepFake: ${res.reply}`, false);
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
    clearChatHistory();
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

document.getElementById("clearChat").onclick = async () => {
    await post("/chat/clear", {});
    clearChatHistory();
};

msgInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

window.addEventListener('load', () => {
    checkSession();
    displayModels();
});
