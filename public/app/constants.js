export const requestedChatId = Number(window.location.pathname.match(/^\/app\/chats\/(\d+)$/)?.[1] || new URLSearchParams(window.location.search).get("chat")) || null;

export const onboardingPrompts = {
    ask: ["Explain this topic in simple terms.", "Compare these options and recommend one."],
    brainstorm: ["Give me 10 practical ideas for this problem.", "Suggest 3 creative directions and tradeoffs."],
    roleplay: ["Start a roleplay scene with immediate tension.", "Give me a dramatic opening with clear stakes."]
};

// Stable keys preserve existing saved appearance preferences.
export const themes = {
    "fakegpt": {name: "Grove", short: "GR"},
    "fraud": {name: "Parchment", short: "PA"},
    "germini": {name: "Aurora", short: "AU"},
    "slopilot": {name: "Current", short: "CU"},
    "beta-ai": {name: "Iris", short: "IR"},
    "confusity": {name: "Graphite", short: "GP"}
};
