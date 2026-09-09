import {get, post} from "/app/api.js?v=20260909-account-controls";

const params = new URLSearchParams(location.search);
function returnPath() {
    const candidate = params.get("next");
    if (!candidate) return "/app";
    try {
        const url = new URL(candidate, location.origin);
        if (url.origin === location.origin && (url.pathname === "/market" || /^\/app(?:\/|$)/.test(url.pathname))) return url.pathname + url.search;
    } catch { /* Use workspace home for invalid return URLs. */ }
    return "/app";
}
const session = await get("/session");
if (session.user) {
    document.querySelectorAll("[data-start-link]").forEach(link => { link.href = "/app"; link.textContent = "Open workspace"; });
}

const form = document.querySelector("#accountForm");
if (form) {
    const register = location.pathname === "/register";
    const status = document.querySelector("#accountStatus");
    const submit = document.querySelector("#accountSubmit");
    function showAccountStatus(message, error = false) {
        status.dataset.state = error ? "error" : "pending";
        status.setAttribute("role", error ? "alert" : "status");
        status.setAttribute("aria-live", error ? "assertive" : "polite");
        status.classList.toggle("hidden", !message);
        document.querySelector("#accountStatusText").textContent = message;
        if (error) status.focus();
    }
    const label = register ? "Create account" : "Sign in";
    document.title = `${label} · Elsewhere`;
    document.querySelector("#accountTitle").textContent = label;
    submit.textContent = label;
    form.elements.password.autocomplete = register ? "new-password" : "current-password";
    document.querySelector("#consentField").classList.toggle("hidden", !register);
    form.elements.consent.required = register;
    const invite = register && session.inviteOnlyRegistration;
    document.querySelector("#inviteField").classList.toggle("hidden", !invite);
    form.elements.inviteCode.required = Boolean(invite);
    if (register) {
        document.querySelector("#accountHeadline").textContent = "Your next conversation starts here.";
        document.querySelector("#accountDescription").textContent = "Choose a username and a password of at least 6 characters.";
    }
    if (session.error) showAccountStatus(session.error, true);
    const switchText = document.querySelector("#accountSwitch");
    switchText.append(register ? "Already have an account? " : "New to Elsewhere? ");
    const link = document.createElement("a");
    link.href = `${register ? "/login" : "/register"}?next=${encodeURIComponent(returnPath())}`;
    link.textContent = register ? "Sign in" : "Create account";
    switchText.append(link);
    document.querySelector("#showPassword").addEventListener("click", event => {
        const show = form.elements.password.type === "password";
        form.elements.password.type = show ? "text" : "password";
        const label = show ? "Hide password" : "Show password";
        event.currentTarget.setAttribute("aria-label", label);
        event.currentTarget.title = label;
        event.currentTarget.setAttribute("aria-pressed", String(show));
    });
    form.addEventListener("submit", async event => {
        event.preventDefault();
        submit.disabled = true;
        form.elements.username.removeAttribute("aria-invalid");
        form.elements.username.removeAttribute("aria-describedby");
        showAccountStatus(register ? "Creating your account..." : "Signing in...");
        const result = await post(register ? "/register" : "/login", {
            username: form.elements.username.value.trim(), password: form.elements.password.value,
            ...(register ? {inviteCode: form.elements.inviteCode.value.trim()} : {})
        });
        if (result.error) {
            const duplicate = register && result.error === "User already exists";
            if (duplicate) {
                form.elements.username.setAttribute("aria-invalid", "true");
                form.elements.username.setAttribute("aria-describedby", "accountStatus");
            }
            showAccountStatus(duplicate ? "That username is already taken. Choose another, or sign in below." : result.error, true);
            submit.disabled = false;
            return;
        }
        location.assign(returnPath());
    });
}

const recent = document.querySelector("#recentChats");
if (recent) {
    if (!session.user) location.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
    else {
        document.querySelector("#welcomeName").textContent = `Welcome home, ${session.user}`;
        const result = await get("/chats");
        recent.replaceChildren();
        if (result.error) recent.textContent = result.error;
        else if (!result.chats?.length) {
            const empty = document.createElement("div"); empty.className = "empty-state";
            const title = document.createElement("h3"); title.textContent = "Your first conversation is waiting";
            const copy = document.createElement("p"); copy.textContent = "Choose a starter, or bring a thought of your own.";
            const starters = document.createElement("div"); starters.className = "starter-links";
            for (const prompt of ["Explain a complex topic in simple terms.", "Help me brainstorm a story idea."]) {
                const link = document.createElement("a"); link.className = "secondary-action"; link.href = `/app/chats/new?prompt=${encodeURIComponent(prompt)}`; link.textContent = prompt; starters.append(link);
            }
            empty.append(title, copy, starters); recent.append(empty);
        } else for (const chat of result.chats.slice(0, 6)) {
            const link = document.createElement("a"); link.className = "chat-row"; link.href = `/app/chats/${chat.id}`;
            const title = document.createElement("strong"); title.textContent = chat.title || "Untitled conversation";
            const action = document.createElement("span"); action.textContent = "Continue \u2192";
            link.append(title, action); recent.append(link);
        }
    }
}

const featured = document.querySelector("#featuredPersonas");
if (featured) {
    const result = await get("/api/discover");
    const search = document.querySelector("#publicSearch");
    function render() {
        featured.replaceChildren();
        if (result.error) { featured.textContent = result.error; return; }
        const query = search?.value.trim().toLowerCase() || "";
        let personas = (result.personas || []).filter(persona => `${persona.name} ${persona.description || ""}`.toLowerCase().includes(query));
        if (!search) personas = personas.slice(0, 3);
        if (!personas.length) { featured.textContent = query ? "No personas match your search." : "The community is just getting started. Create a persona and give the next story its voice."; return; }
        for (const persona of personas) {
            const card = document.createElement("article"); card.className = "feature-card";
            const category = document.createElement("span"); category.className = "feature-number"; category.textContent = persona.persona_type === "assistant" ? "AI CHARACTER" : "USER PERSONA";
            const title = document.createElement("h3"); title.textContent = persona.name;
            const description = document.createElement("p"); description.textContent = persona.description || "A community persona, ready for a new conversation.";
            const creator = document.createElement("p"); creator.textContent = `By ${persona.creator_username}`;
            const link = document.createElement("a"); const destination = `/market?persona=${persona.id}`;
            link.href = session.user ? destination : `/login?next=${encodeURIComponent(destination)}`;
            link.textContent = session.user ? "Explore persona \u2192" : "Sign in to use persona \u2192";
            card.append(category, title, description, creator, link); featured.append(card);
        }
    }
    render(); search?.addEventListener("input", render);
}

