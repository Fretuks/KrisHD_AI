const $ = (id) => document.getElementById(id);
const settingsNotice = $("settingsNotice");
const settingsThemeSelect = $("settingsThemeSelect");
const settingsThemeName = $("settingsThemeName");
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

function setNotice(message, state = "") {
    settingsNotice.textContent = message;
    settingsNotice.className = state ? `status ${state}` : "status";
}

function applyTheme(themeKey, persist = true) {
    const nextTheme = themes[themeKey] ? themeKey : "fakegpt";
    document.body.dataset.theme = nextTheme;
    document.title = "Settings";
    settingsThemeSelect.value = nextTheme;
    if (settingsThemeName) settingsThemeName.textContent = themes[nextTheme].name;
    if (persist) localStorage.setItem("krishd-theme", nextTheme);
}

function setSettingsView(view) {
    settingsNavItems.forEach((item) => item.classList.toggle("active", item.dataset.settingsView === view));
    settingsPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.settingsPanel === view));
}

async function loadProfile() {
    const res = await request("/settings/profile", null, "GET");
    if (res.error) {
        setNotice(res.error, "error");
        return;
    }
    currentUsernameInput.value = res.username || "";
    newUsernameInput.value = res.username || "";
    setNotice("Settings loaded.");
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
    const newPassword = newPasswordInput.value;
    const repeatPassword = repeatPasswordInput.value;
    if (!currentPassword || !newPassword || !repeatPassword) {
        setNotice("Fill in all password fields.", "error");
        return;
    }
    if (newPassword !== repeatPassword) {
        setNotice("New passwords do not match.", "error");
        return;
    }
    const res = await request("/settings/password", {currentPassword, newPassword}, "PUT");
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

settingsNavItems.forEach((item) => item.addEventListener("click", () => setSettingsView(item.dataset.settingsView)));

window.addEventListener("load", async () => {
    applyTheme(localStorage.getItem("krishd-theme") || "fakegpt", false);
    setSettingsView("personal");
    await loadProfile();
});
