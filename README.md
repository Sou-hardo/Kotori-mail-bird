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

Requirements: Node.js 22.13+, pnpm 11.18.0, access to the existing Convex project `kotori-db`, Google OAuth clients, and Gmail API access. pnpm 11 requires Node.js 22.13 or newer.

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev:convex
pnpm dev
```

When Convex asks which project to use, select the existing `kotori-db` project rather than creating a new one. Keep the generated `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, and `NEXT_PUBLIC_CONVEX_SITE_URL` values in local environment files only.

Set Convex backend variables with `pnpm convex env set`: `SITE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, the Gmail OAuth values, `CREDENTIAL_ENCRYPTION_KEY`, DeepSeek values, and optional VAPID values. The Next.js environment needs `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `APP_URL`, the mailbox callback values, and the same credential-encryption key.

Google sign-in callback: `/api/auth/callback/google`. Separate mailbox callback: `/api/gmail/callback`. The mailbox grant must return a refresh token and exactly the allowed Gmail scopes. The Gmail OAuth client must also permit the `openid` and `email` identity scopes alongside `gmail.readonly` and `gmail.compose`, or consent fails; these identity scopes verify the connecting Google account and are not persisted to the stored connection's scope list.

## First run

A user signs in with Google, is redirected to `/connect` because no `ACTIVE` Gmail connection exists yet, and grants Gmail access there. The OAuth callback verifies the granted scopes and the account identity, stores the encrypted connection, enqueues an initial sync, and returns the user to `/inbox`, which shows the connect confirmation while the first sync runs. From then on `/connect` redirects straight to `/inbox`. Settings exposes a mailbox card to trigger a manual sync or disconnect the mailbox; disconnecting returns the account to the gated state and back through `/connect` on the next visit.

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

The managed backend for this release is the existing Convex project `kotori-db`. Deploy Convex first with `pnpm convex:deploy`, setting production backend variables in the Convex dashboard.

The live VPS rollout of the Next.js frontend and Caddy is deferred. The commands below are the release runbook for the eventual approved rollout; they do not indicate that v0.2.0 is currently live on the VPS:

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f compose.production.yml build
docker compose --env-file .env.production -f compose.production.yml up -d
curl -fsS https://mail.example.com/api/health
```

The production example contains only values used by the VPS frontend. Keep backend-only Better Auth, Google sign-in, DeepSeek, and private VAPID secrets in Convex rather than copying them to the VPS environment.

Convex provides managed persistence, deployment history, and platform backups; define recovery and retention requirements in the Convex project plan. Preserve `CREDENTIAL_ENCRYPTION_KEY` in an encrypted secret manager because rotating it without re-encrypting grants makes existing Gmail connections unreadable.

See [the v0.2.0 release notes](docs/releases/v0.2.0.md) for release scope and rollout status.
