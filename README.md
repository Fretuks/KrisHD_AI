# Elsewhere

Elsewhere is an Express + SQLite app for account-based chat, persona management, roleplay chat sessions, and a simple persona market backed by a remote model API.

A space for every conversation. Six appearance styles (Grove, Parchment, Aurora, Current, Iris, and Graphite) each support light and dark modes. The Elsewhere identity stays consistent across styles. Internal theme and storage keys remain stable to preserve saved preferences.

## Setup

Node.js 22 or newer is required.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set at least `SESSION_SECRET`.
3. Start the app with `npm run dev` for local development or `npm start` for a normal server run.

## Scripts

- `npm start`: run the production server entrypoint.
- `npm run dev`: run the server with Node watch mode.
- `npm run lint`: syntax-check the backend and browser modules.
- `npm test`: run API tests with Node's built-in test runner.

## Environment Variables

- `PORT`: HTTP port for the Express server.
- `DB_PATH`: SQLite database path. Use `:memory:` for isolated tests.
- `SESSION_SECRET`: session signing secret. Required outside local throwaway environments.
- `COOKIE_SECURE`: set to `true` when serving over HTTPS. Required in production unless `ALLOW_INSECURE_COOKIES=true` is set.
- `ALLOW_INSECURE_COOKIES`: explicit production override for non-HTTPS deployments.
- `TRUST_PROXY`: Express trust proxy setting for reverse proxy deployments.
- `SESSION_MAX_AGE_MS`: cookie lifetime.
- `EVENT_LOOP_LAG_*`: enable and tune event-loop lag warnings.
- `SLOW_REQUEST_*`: enable and tune slow request warnings.
- `CHAT_LIMIT`: per-account maximum chat sessions.
- `CHAT_HISTORY_LIMIT`: number of recent messages included in model prompts.
- `MODEL_API_BASE_URL`: base URL of the remote model backend. The server expects `/chat` and `/tags`.
- `MODEL_REQUEST_TIMEOUT_MS`: timeout for chat generation requests.
- `MODEL_LIST_TIMEOUT_MS`: timeout for model list requests.
- `MODEL_UNLOAD_AFTER_MS`: delay before an idle model unload is attempted.
- `MODELS_CACHE_TTL_MS`: model list cache TTL.
- `AUTH_RATE_LIMIT_*`: rate-limit window and thresholds for registration/login.
- `CHAT_RATE_LIMIT_*`: rate-limit window and thresholds for chat and retry endpoints.
- `RATE_LIMIT_CLEANUP_INTERVAL_MS`: interval for pruning stale in-memory rate-limit buckets.
- `DROP_LEGACY_CHATS`: when `true`, migrate any legacy `chats` table into `chat_sessions` / `chat_messages` and remove the old table.

## Model Backend Expectations

The server is configured around an Ollama-compatible API surface:

- `POST /chat`: accepts `{ model, messages, stream: true }` and returns newline-delimited JSON stream chunks with `message.content`.
- `GET /tags`: returns the available model list.

The refactor adds explicit upstream timeout handling, cached model listing, and `GET /health` for degraded-state visibility.

## Schema Notes

Primary runtime tables are:

- `users`
- `chat_sessions`
- `chat_messages`
- `personas`
- `user_settings`
- `persona_market`

Legacy `chats` migration is handled during startup. New code only reads the session/message schema.

## Persona And Market Flow

- Assistant and user personas are stored separately through `persona_type`.
- Roleplay chats can bind an assistant persona, an optional user persona, and scenario metadata to a chat session.
- Publishing copies a local persona into `persona_market`.
- Collecting clones a market persona back into the current user's `personas` table with source metadata.

## Frontend Structure

The browser UI remains framework-free and uses native ES modules. Shared behavior lives under `public/app/`:

- `api.js`: JSON and streaming request helpers
- `constants.js`: theme and onboarding metadata
- `themeController.js`: validated theme/mode persistence and application
- `theme-bootstrap.js`: applies stored appearance before page initialization
- `personaForm.js`: shared persona form serialization
- `statusNotice.js`: shared status and error presentation
- `dom.js`: cached chat-page DOM references

`public/style.css` is a self-contained design system rebuilt around semantic tokens, shared components, and deliberate responsive breakpoints. It contains the six visual identities and their dark variants without legacy imports or precedence layers. `public/legal.css` contains only the legal-page layout.

Pure chat message, retry, memory, summary, and persona-state formatting lives in `src/services/chatMessageHelpers.js`; `chatService.js` remains responsible for orchestration and persistence.

## Legal

- [Privacy Policy](PRIVACY_POLICY.md)
- [Terms of Service](TERMS_OF_SERVICE.md)

## Page navigation

- `/` is the public landing page, even for signed-in visitors.
- `/login` and `/register` provide dedicated account forms. Registration starts a session automatically.
- `/app` is workspace home, with recent chats and optional starters.
- `/app/chats/new` opens an empty composer; sending the first message creates the conversation.
- `/app/chats/:id` opens a conversation. Legacy `/?chat=:id` links redirect here.
- `/app/personas` provides persona management, using the shared settings editor module.
- `/app/settings` contains account and appearance settings. `/settings` redirects here.
- `/market` allows visitors to browse public summaries and signed-in users to use the full persona market.

Protected pages redirect to sign-in with a local return destination. Public discovery only returns published persona summaries; using a persona requires an account.

All page routes render the same navigation from `src/pageLayout.js` into the `<!-- site-header -->` placeholder. `public/shell.css` owns the shared header, page spacing, and mobile navigation; `public/app/workspaceNavigation.js` owns sign-out. Page-specific headers contain only local titles and actions. The chat sidebar is reserved for conversation history. Public and home content share `public/pages.css` and `public/pages.js`. Page routes run before static assets and authenticated API routers; rendered pages use private, non-cacheable responses.

For environments that block child-process test workers, run `node --test --test-isolation=none`.
