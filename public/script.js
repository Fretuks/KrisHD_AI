const authDiv = document.getElementById("auth");
const chatDiv = document.getElementById("chat");
const authMsg = document.getElementById("authMsg");
const messagesDiv = document.getElementById("messages");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("login");
const registerBtn = document.getElementById("register");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("send");

let isProcessing = false;
let chatHistory = JSON.parse(localStorage.getItem('chatHistory')) || [];

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

function setAuthMessage(msg, isError = false) {
    authMsg.textContent = msg;
    authMsg.className = isError ? 'error' : 'success';
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

        // Save to history (but not loading messages)
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

    // Smooth scroll to bottom
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
        msgInput.placeholder = "Verarbeite Antwort...";
    } else {
        sendBtn.classList.remove('loading');
        msgInput.placeholder = "Type your message...";
    }
}

async function checkSession() {
    const res = await get('/api/session');
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
    const res = await get("/api/chat/history");
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

async function handleAuth(endpoint) {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    if (!username || !password) {
        setAuthMessage("Please enter both username and password.", true);
        return;
    }
    loginBtn.disabled = true;
    registerBtn.disabled = true;
    setAuthMessage("Processing...", false);

    const res = await post(`/api/${endpoint}`, {username, password});

    loginBtn.disabled = false;
    registerBtn.disabled = false;

    if (res.error) {
        setAuthMessage(res.error, true);
    } else {
        if (endpoint === "login") {
            setAuthMessage("Login successful!", false);
            authDiv.style.display = "none";
            chatDiv.style.display = "grid";
            await loadServerChat();
            msgInput.focus();
        } else {
            setAuthMessage("Registration successful — you can now log in!", false);
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
        const res = await post("/api/chat", { message: msg, model });
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

loginBtn.onclick = () => handleAuth("login");
registerBtn.onclick = () => handleAuth("register");

passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAuth("login");
});

document.getElementById("logout").onclick = async () => {
    await post("/api/logout", {});
    chatDiv.style.display = "none";
    authDiv.style.display = "grid";
    clearChatHistory();
    setAuthMessage("Logged out.", false);
    usernameInput.value = "";
    passwordInput.value = "";
};

sendBtn.onclick = sendMessage;

msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

document.getElementById("clearChat").onclick = async () => {
    await post("/api/chat/clear", {});
    clearChatHistory();
};

msgInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

window.addEventListener('load', () => {
    checkSession();
});