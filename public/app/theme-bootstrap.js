(() => {
    const themes = new Set(["fakegpt", "fraud", "germini", "slopilot", "beta-ai", "confusity"]);
    const storedTheme = localStorage.getItem("krishd-theme");
    const storedMode = localStorage.getItem("krishd-theme-mode");
    const theme = themes.has(storedTheme) ? storedTheme : "fakegpt";
    const mode = storedMode === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeMode = mode;
    document.addEventListener("readystatechange", () => {
        if (!document.body) return;
        document.body.dataset.theme = theme;
        document.body.dataset.themeMode = mode;
    });
})();
