# Kotori Mail Bird

Kotori is a mobile-first Gmail assistant backed by managed Convex Cloud. Better Auth provides Google-only sign-in; Gmail authorization remains a separate offline grant limited to `gmail.readonly` and `gmail.compose`. Kotori can create a Gmail draft only after explicit review and approval, and has no send scope, endpoint, method, or job.

## Architecture and safety

- Convex owns all application/auth data, tenant authorization, scheduled work, and cron jobs. Dates are stored as epoch milliseconds and converted to ISO strings at the Next.js boundary.
- Better Auth uses only Google `openid email profile`. A transactional auth trigger creates the app user, tenant, and `OWNER` membership.
- Two Convex Workpools isolate Gmail sync (parallelism 2) from general work (parallelism 5). Actions retry five times with exponential backoff; `processingJobs` records dedupe, attempt, output/error, and `DEAD_LETTER` state.
- Gmail polling runs every five minutes. Reminder work is scheduled at `dueAt`; edits and deletes cancel the prior work item. Batched retention starts daily at 03:17 UTC and removes email threads older than 90 days.
- Gmail credentials are separately encrypted at rest. OAuth state is signed, short-lived, principal-bound, and protected with PKCE. Better Auth tokens are never reused for Gmail.
- AI output remains bounded, schema-oriented, sanitized, editable, and explicitly acknowledged for high-risk content. Audit metadata stores hashes and redacted context, never reply bodies.

## Local development

Requirements: Node.js 20.19+, pnpm 10.28+, a Convex account/project, Google OAuth clients, and Gmail API access.

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev:convex
pnpm dev
```

Set Convex backend variables with `pnpm convex env set`: `SITE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, the Gmail OAuth values, `CREDENTIAL_ENCRYPTION_KEY`, DeepSeek values, and optional VAPID values. The Next.js environment needs `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `APP_URL`, the mailbox callback values, and the same credential-encryption key.

Google sign-in callback: `/api/auth/callback/google`. Separate mailbox callback: `/api/gmail/callback`. The mailbox grant must return a refresh token and exactly the allowed Gmail scopes.

## Validation and deployment

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:no-send
pnpm test:e2e
pnpm build
```

Deploy Convex first with `pnpm convex:deploy`, setting production backend variables in the Convex dashboard. The VPS runs only the Next.js frontend and Caddy:

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f compose.production.yml build
docker compose --env-file .env.production -f compose.production.yml up -d
curl -fsS https://mail.example.com/api/health
```

Convex provides managed persistence, deployment history, and platform backups; define recovery and retention requirements in the Convex project plan. Preserve `CREDENTIAL_ENCRYPTION_KEY` in an encrypted secret manager because rotating it without re-encrypting grants makes existing Gmail connections unreadable.
