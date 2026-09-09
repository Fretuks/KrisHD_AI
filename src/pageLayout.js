const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

export function renderSiteHeader({user, pathname}) {
    const destinations = user
        ? [["/app", "Home"], ["/app/chats", "Chats"], ["/app/personas", "My personas"], ["/market", "Discover"], ["/app/settings", "Settings"]]
        : [["/market", "Discover"]];
    const navigation = destinations.map(([href, label]) => {
        const active = pathname === href || (href === "/app/chats" && pathname.startsWith("/app/chats/"));
        return `<a href="${href}"${active ? ' aria-current="page"' : ""}>${label}</a>`;
    }).join("");
    const account = user
        ? `<span class="shell-username" title="${escapeHtml(user)}">${escapeHtml(user)}</span><button type="button" data-sign-out class="secondary-action shell-sign-out">Sign out</button>`
        : `<a href="/login"${pathname === "/login" ? ' aria-current="page"' : ""}>Sign in</a><a class="primary-action" href="/register"${pathname === "/register" ? ' aria-current="page"' : ""}>Create account</a>`;
    return `<a class="skip-link" href="#main">Skip to content</a>
<header class="shell-header">
    <a class="shell-brand" href="/" aria-label="Elsewhere landing page"><span class="logo doorway-mark" aria-hidden="true"></span><span>elsewhere</span></a>
    <nav class="shell-nav" aria-label="Main navigation">${navigation}</nav>
    <div class="shell-account">${account}</div>
</header>
<p id="shellNotice" class="shell-notice hidden" role="alert"></p>`;
}
