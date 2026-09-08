export const defaultModelProfile = {
    badge: "General",
    summary: "Best for general questions, drafting, and everyday conversation. Use a specialized model when you need stronger coding, reasoning, or roleplay behavior."
};

const modelProfileRules = [
    {
        matches: ["catgirl"],
        badge: "Roleplay",
        summary: "Best for playful catgirl character roleplay and expressive, in-character conversation. Not intended for neutral factual answers or technical work."
    },
    {
        matches: ["femboy"],
        badge: "Roleplay",
        summary: "Best for personality-led roleplay, casual conversation, and maintaining a stylized character voice. Not intended for precise research or technical tasks."
    },
    {
        matches: ["buenzli", "bünzli"],
        badge: "Roleplay",
        summary: "Best for Swiss-flavored character roleplay, local humor, and casual conversation. Choose a general model for neutral writing or factual questions."
    },
    {
        matches: ["deepseek-r1", "deepseek-r1-distill"],
        badge: "Reasoning",
        summary: "Best for problems that benefit from deliberate reasoning, such as logic, mathematics, planning, and difficult technical questions. It can be slower and more verbose for simple chat."
    },
    {
        matches: ["codellama", "code-llama", "deepseek-coder", "qwen2.5-coder", "qwen3-coder", "starcoder", "codestral", "coder"],
        badge: "Coding",
        summary: "Best for writing, explaining, reviewing, and debugging code. Choose a general model for creative conversation or broad non-technical questions."
    },
    {
        matches: ["dolphin"],
        badge: "Creative",
        summary: "Best for open-ended conversation, brainstorming, creative writing, and roleplay. Its answers can be less restrained and less dependable for factual or safety-critical topics."
    },
    {
        matches: ["mixtral"],
        badge: "Versatile",
        summary: "Best for detailed writing, summarization, multilingual tasks, and general problem-solving. It is a capable all-rounder but may respond more slowly than smaller models."
    },
    {
        matches: ["mistral"],
        badge: "Balanced",
        summary: "Best for everyday questions, concise writing, summaries, and light coding. A strong default when you want a balance of speed and answer quality."
    },
    {
        matches: ["gemma"],
        badge: "Efficient",
        summary: "Best for quick answers, rewriting, summarization, and lightweight general chat. Larger or reasoning-focused models are better for complex multi-step problems."
    },
    {
        matches: ["qwen"],
        badge: "Versatile",
        summary: "Best for multilingual conversation, structured writing, instruction following, and general technical tasks. Coder variants are the better choice for code-heavy work."
    },
    {
        matches: ["llama"],
        badge: "General",
        summary: "Best for general conversation, writing, summarization, and broad knowledge tasks. Specialized coding or reasoning models may perform better in those areas."
    },
    {
        matches: ["phi"],
        badge: "Compact",
        summary: "Best for fast, focused questions, short summaries, and lightweight assistance. Its compact size makes it less suitable for demanding reasoning or long, nuanced responses."
    }
];

function describeBuild(model) {
    const parameterSize = String(model?.details?.parameter_size || "").trim();
    const quantization = String(model?.details?.quantization_level || "").trim();
    const details = [parameterSize, quantization].filter(Boolean);
    return details.length ? ` Available build: ${details.join(", ")}.` : "";
}

export function getModelProfile(model = {}) {
    const modelId = String(model.model || model.name || "");
    const modelName = String(model.name || model.model || "");
    const family = String(model?.details?.family || "");
    const families = Array.isArray(model?.details?.families) ? model.details.families.join(" ") : "";
    const haystack = `${modelId} ${modelName} ${family} ${families}`.toLowerCase();
    const match = modelProfileRules.find((profile) => profile.matches.some((token) => haystack.includes(token)));
    const profile = match || defaultModelProfile;

    return {
        badge: profile.badge,
        summary: `${profile.summary}${describeBuild(model)}`
    };
}
