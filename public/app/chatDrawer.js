import {chatDrawer, chatDrawerButton, chatDrawerCloseBtn} from "./dom.js";

let lastFocusedElement = null;

const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "textarea:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "summary",
    "[tabindex]:not([tabindex='-1'])"
].join(",");

function getFocusableElements() {
    if (!chatDrawer) return [];
    return Array.from(chatDrawer.querySelectorAll(focusableSelector))
        .filter((element) => element instanceof HTMLElement && element.offsetParent !== null);
}

function syncChatDrawerState(isOpen) {
    if (!chatDrawer || !chatDrawerButton) return;
    if (isOpen) {
        lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        document.body.classList.remove("sidebar-open");
    }
    chatDrawer.classList.toggle("hidden", !isOpen);
    chatDrawerButton.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("chat-drawer-open", isOpen);
    if (isOpen) {
        window.requestAnimationFrame(() => {
            const firstFocusable = getFocusableElements()[0];
            (chatDrawerCloseBtn || firstFocusable)?.focus();
        });
    } else if (lastFocusedElement) {
        lastFocusedElement.focus();
        lastFocusedElement = null;
    }
}

function isChatDrawerOpen() {
    return Boolean(chatDrawer && !chatDrawer.classList.contains("hidden"));
}

function openChatDrawer() {
    syncChatDrawerState(true);
}

function closeChatDrawer() {
    syncChatDrawerState(false);
}

function toggleChatDrawer() {
    syncChatDrawerState(!isChatDrawerOpen());
}

function handleDocumentClick(event) {
    if (!isChatDrawerOpen()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (chatDrawerButton?.contains(target)) return;
    if (chatDrawer?.querySelector(".chat-drawer-panel")?.contains(target)) return;
    closeChatDrawer();
}

function handleDocumentKeydown(event) {
    if (!isChatDrawerOpen()) return;
    if (event.key === "Escape") {
        closeChatDrawer();
        return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = getFocusableElements();
    if (!focusableElements.length) return;

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return;
    }
    if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

if (chatDrawerButton && chatDrawer) {
    chatDrawerButton.addEventListener("click", () => {
        toggleChatDrawer();
    });
}

if (chatDrawerCloseBtn) {
    chatDrawerCloseBtn.addEventListener("click", closeChatDrawer);
}

document.addEventListener("click", handleDocumentClick);
document.addEventListener("keydown", handleDocumentKeydown);

export {
    closeChatDrawer,
    isChatDrawerOpen,
    openChatDrawer,
    toggleChatDrawer
};
