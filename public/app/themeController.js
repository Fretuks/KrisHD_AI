import {themes} from "./constants.js?v=20260909-account-controls";

export const THEME_STORAGE_KEY = "krishd-theme";
export const THEME_MODE_STORAGE_KEY = "krishd-theme-mode";
export const DEFAULT_THEME = "fakegpt";
export const DEFAULT_THEME_MODE = "light";

export function normalizeTheme(themeKey) {
    return Object.hasOwn(themes, themeKey) ? themeKey : DEFAULT_THEME;
}

export function normalizeThemeMode(modeKey) {
    return modeKey === "dark" ? "dark" : DEFAULT_THEME_MODE;
}

export function readStoredAppearance() {
    return {
        theme: normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY)),
        mode: normalizeThemeMode(localStorage.getItem(THEME_MODE_STORAGE_KEY))
    };
}

export function applyTheme(themeKey, {
    persist = true,
    title = null,
    themeSelect = null,
    nameTargets = document.querySelectorAll("[data-brand-name]"),
    logoTargets = document.querySelectorAll("[data-brand-logo]")
} = {}) {
    const nextTheme = normalizeTheme(themeKey);
    const theme = themes[nextTheme];
    document.documentElement.dataset.theme = nextTheme;
    document.body.dataset.theme = nextTheme;
    if (typeof title === "function") document.title = title(theme);
    if (typeof title === "string") document.title = title;
    nameTargets.forEach((target) => { target.textContent = "elsewhere"; });
    logoTargets.forEach((target) => { target.textContent = ""; target.classList.add("doorway-mark"); });
    if (themeSelect) themeSelect.value = nextTheme;
    if (persist) localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    document.dispatchEvent(new CustomEvent("appearancechange", {detail: {theme: nextTheme}}));
    return nextTheme;
}

export function applyThemeMode(modeKey, {persist = true, modeSelect = null} = {}) {
    const nextMode = normalizeThemeMode(modeKey);
    document.documentElement.dataset.themeMode = nextMode;
    document.body.dataset.themeMode = nextMode;
    if (modeSelect) modeSelect.value = nextMode;
    if (persist) localStorage.setItem(THEME_MODE_STORAGE_KEY, nextMode);
    document.dispatchEvent(new CustomEvent("appearancechange", {detail: {mode: nextMode}}));
    return nextMode;
}

export function initializeAppearance(options = {}) {
    const appearance = readStoredAppearance();
    applyTheme(appearance.theme, {...options, persist: false});
    applyThemeMode(appearance.mode, {
        persist: false,
        modeSelect: options.modeSelect || null
    });
    return appearance;
}
