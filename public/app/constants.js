export const requestedChatId = Number(new URLSearchParams(window.location.search).get("chat")) || null;

export const onboardingPrompts = {
    ask: ["Explain this topic in simple terms.", "Compare these options and recommend one."],
    brainstorm: ["Give me 10 practical ideas for this problem.", "Suggest 3 creative directions and tradeoffs."],
    roleplay: ["Start a roleplay scene with immediate tension.", "Give me a dramatic opening with clear stakes."]
};

export const themes = {
    "fakegpt": {name: "FakeGPT", short: "FG"},
    "fraud": {name: "Fraud", short: "FR"},
    "germini": {name: "Germini", short: "GE"},
    "slopilot": {name: "Slopilot", short: "SP"},
    "beta-ai": {name: "Beta AI", short: "BA"},
    "confusity": {name: "Confusity", short: "CF"}
};

export const defaultModelProfile = {
    badge: "General",
    summary: "General-purpose chat model. Start here if you are unsure which model to use."
};
