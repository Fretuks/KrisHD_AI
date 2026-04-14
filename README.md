# KrisHD_AI

KrisHD_AI is an Express + SQLite app for account-based chat, persona management, roleplay chat sessions, and a simple persona market backed by a remote model API.

## Setup

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
- `COOKIE_SECURE`: set to `true` when serving over HTTPS.
- `SESSION_MAX_AGE_MS`: cookie lifetime.
- `CHAT_LIMIT`: per-account maximum chat sessions.
- `CHAT_HISTORY_LIMIT`: number of recent messages included in model prompts.
- `MODEL_API_BASE_URL`: base URL of the remote model backend. The server expects `/chat` and `/tags`.
- `MODEL_REQUEST_TIMEOUT_MS`: timeout for chat generation requests.
- `MODEL_LIST_TIMEOUT_MS`: timeout for model list requests.
- `MODEL_UNLOAD_AFTER_MS`: delay before an idle model unload is attempted.
- `MODELS_CACHE_TTL_MS`: model list cache TTL.
- `AUTH_RATE_LIMIT_*`: rate-limit window and thresholds for registration/login.
- `CHAT_RATE_LIMIT_*`: rate-limit window and thresholds for chat and retry endpoints.
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

The main browser entrypoint is still `public/script.js`, but shared API/bootstrap concerns are now split into `public/app/` modules:

- `api.js`: JSON request helpers
- `constants.js`: theme and onboarding constants
- `dom.js`: cached DOM references

This keeps the next round of UI extraction lower-risk without changing the app's behavior surface.

## Legal

- [Privacy Policy](PRIVACY_POLICY.md)
- [Terms of Service](TERMS_OF_SERVICE.md)
