# Kotori Mail Bird

Kotori Mail Bird is a mobile-first Gmail assistant that classifies inbox threads,
summarizes requested actions, generates reviewable reply options with DeepSeek,
and creates Gmail drafts. It never sends email automatically.

Development and deployment documentation will be expanded on the
`feature/gmail-assistant-mvp` branch.

## Local development

Requirements: Node.js 20.19 or newer, pnpm 10, and Docker.

1. Copy `.env.example` to `.env` and replace the placeholder secrets.
2. Start dependencies with `docker compose up -d`.
3. Install packages with `pnpm install`.
4. Apply the database migration with `pnpm db:migrate`.
5. Optionally load local fixtures with `NODE_ENV=development pnpm db:seed`.
6. Start the application with `pnpm dev`.

The seed command refuses to run outside development or against a non-local database host.
Google sign-in and Gmail authorization are separate grants. Configure the Auth.js
Google client with `/api/auth/callback/google`; configure the Gmail client with
`/api/gmail/callback`. The Gmail grant requests only `gmail.readonly` and
`gmail.compose`, uses PKCE and signed state, and requires offline consent so refresh
tokens can be encrypted at rest. `APP_URL` must be the public application origin and
`GMAIL_OAUTH_REDIRECT_URI` must exactly match the callback registered with Google.

## Gmail and background jobs

- `GET /api/gmail/connect` begins an authenticated Gmail connection flow. An optional
  `tenantId` query parameter selects one of the user's workspaces.
- `GET /api/gmail/callback` verifies state/PKCE, persists encrypted credentials, and
  enqueues the bounded initial sync.
- `POST /api/gmail/disconnect` with `{ "connectionId": "..." }` revokes the grant.
- `POST /api/gmail/sync` queues a manual sync; pass `full: true` for a bounded resync.
  `GET /api/gmail/sync?connectionId=...` returns connection, sync, and recent job state.
- `POST /api/gmail/drafts` with `{ "draftId": "..." }` creates a Gmail draft through
  the background queue. Threading requires the original `Message-ID` and references.

Run the web process with `pnpm start` and the separate BullMQ process with
`pnpm worker`. Redis-backed polling runs every five minutes. Jobs use stable dedupe
keys, database leases, five exponential-backoff attempts, and `DEAD_LETTER` terminal
state; inspect `ProcessingJob` and `SyncState` for operations. Initial and expired-history
resyncs are deliberately capped at 14 days and 200 inbox threads. Message HTML is
allowlist-sanitized and only required headers are retained.

There is intentionally no email-send capability: the product only creates drafts for
review in Gmail.

## DeepSeek analysis and reply review

Set `DEEPSEEK_API_KEY`; `DEEPSEEK_BASE_URL` and `DEEPSEEK_MODEL` default to the
DeepSeek chat API. `POST /api/ai/analyze` queues versioned structured thread analysis,
and `GET /api/ai/analyze?threadId=...` returns only schema-validated results.
`POST /api/ai/replies` queues reply generation with an intent, tone, length, identity,
closing, and explicit acknowledgements for every returned review flag. The model is
constrained to JSON mode and exactly three distinct drafts; malformed, empty, truncated,
or schema-invalid output is rejected before storage or display.

Email content is sanitized, bounded, isolated as untrusted prompt data, and cannot request
tools or override instructions. Deterministic gates cover financial commitments,
legal/contracts, recruitment, complaints, sensitive information, deadlines/promises,
missing mentioned attachments, and multiple recipients. Editing, rejecting, and approving
a reply uses `PATCH /api/ai/replies/:id` and is recorded in the audit history. Approval
creates only a local reviewable draft record; it does not send email.
