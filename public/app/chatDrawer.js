import {chatDrawer, chatDrawerButton, chatDrawerCloseBtn} from "./dom.js";

function syncChatDrawerState(isOpen) {
    if (!chatDrawer || !chatDrawerButton) return;
    if (isOpen) document.body.classList.remove("sidebar-open");
    chatDrawer.classList.toggle("hidden", !isOpen);
    chatDrawerButton.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("chat-drawer-open", isOpen);
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
    if (event.key === "Escape") closeChatDrawer();
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
