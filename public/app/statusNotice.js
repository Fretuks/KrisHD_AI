export function setStatus(element, message = "", state = "", baseClass = "status") {
    if (!element) return;
    element.textContent = message;
    element.className = [baseClass, state].filter(Boolean).join(" ");
}

export function clearStatus(element, baseClass = "status") {
    setStatus(element, "", "hidden", baseClass);
}
