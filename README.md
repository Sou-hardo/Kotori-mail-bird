# Kotori Mail Bird

Kotori Mail Bird is a self-hosted, mobile-first Gmail assistant. It syncs inbox threads, classifies and summarizes them, generates three editable DeepSeek reply options, and—only after explicit approval—can create a Gmail draft. It has no email-send endpoint, queue, scope, or Gmail send method.

## Safety and privacy model

- Google access is limited to `gmail.readonly` and `gmail.compose`; `gmail.send`, `gmail.modify`, and full-mail scopes are never requested.
- AI output is schema-validated, sanitized, editable, and gated for financial, legal, hiring, complaint, sensitive-data, deadline, attachment, and multi-recipient risks.
- Approval creates a local draft. A separate user action creates a draft in Gmail. Sending remains exclusively in Gmail under the user's control.
- Credentials are encrypted at rest with a dedicated 32-byte key. OAuth state is signed, short-lived, and bound to the authenticated user and tenant with PKCE.
- All mailbox queries are tenant-scoped after membership verification. Identity, reminder, notification, and push records are user-scoped.
- Email threads older than 90 days are removed daily, cascading to messages, attachments, analyses, reply options, and drafts. Audit metadata never stores reply bodies; redacted audit events are removed after one year.
- CI contains a structural guard that fails if Gmail send methods, endpoints, scopes, or send queue names appear in application source.

## Local setup

Requirements: Node.js 20.19+, pnpm 10.28+, Docker with Compose v2, and a Google Cloud project.

```bash
cp .env.example .env
docker compose up -d
pnpm install --frozen-lockfile
pnpm db:migrate
NODE_ENV=development pnpm db:seed   # optional local fixtures
pnpm dev
```

Run `pnpm worker` in a second terminal. The seed refuses non-development execution and non-local database hosts. The local Compose file exposes PostgreSQL on 5432 and Redis on 6379; it is not the production stack.

Generate secrets with `openssl rand -base64 32`. `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` must be different; keep both out of source control. Changing the encryption key makes stored Gmail grants unreadable, so preserve it in an encrypted password manager and backup procedure.

## Google OAuth and Gmail API

In Google Cloud Console:

1. Create or select a project and enable the Gmail API.
2. Configure the OAuth consent screen. For testing mode, add each test account; for external production use, complete Google's verification requirements for the requested sensitive scopes.
3. Create a Web application OAuth client for Auth.js. Add `http://localhost:3000/api/auth/callback/google` locally and `https://mail.example.com/api/auth/callback/google` in production.
4. Create a second Web application client for the mailbox grant (recommended separation). Add `http://localhost:3000/api/gmail/callback` locally and `https://mail.example.com/api/gmail/callback` in production.
5. Put the sign-in client in `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, and the mailbox client in `GMAIL_OAUTH_CLIENT_ID`/`GMAIL_OAUTH_CLIENT_SECRET`. Set `GMAIL_OAUTH_REDIRECT_URI` to the exact mailbox callback.

Google sign-in and Gmail authorization are separate grants. The Gmail flow requests offline consent for refresh tokens plus only `gmail.readonly` and `gmail.compose`. If a refresh token is not returned, revoke the app grant in the Google account and reconnect.

## DeepSeek and Web Push

Set `DEEPSEEK_API_KEY`. `DEEPSEEK_BASE_URL` defaults to `https://api.deepseek.com` and `DEEPSEEK_MODEL` to `deepseek-chat`. Email content is bounded and marked as untrusted data in prompts; malformed or truncated model output is rejected.

Push is optional. Generate VAPID keys with `pnpm exec web-push generate-vapid-keys`, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and a `mailto:` `VAPID_SUBJECT`, and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the same public key for local builds. The production image receives the public key at build time from `VAPID_PUBLIC_KEY`.

## Database and worker operations

- Development migration: `pnpm db:migrate`
- Production migration: `pnpm exec prisma migrate deploy`
- Schema validation/generation: `pnpm db:validate && pnpm db:generate`
- Development seed: `NODE_ENV=development pnpm db:seed`
- One-off privacy cleanup: `pnpm retention`

The separate BullMQ worker handles bounded Gmail sync, analysis, reply generation, Gmail draft creation, reminders, push, and retention. Jobs use stable dedupe keys, leases, five exponential-backoff attempts, and terminal `DEAD_LETTER` state. Gmail polling runs every five minutes; retention runs daily at 03:17 UTC.

## Testing and quality gates

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:no-send
pnpm db:validate
pnpm db:generate
pnpm build
```

Tests do not contact Gmail or DeepSeek. Route-level health tests mock the database; Gmail tests use fake clients. GitHub Actions runs the same checks with representative non-secret environment values.

## VPS production deployment

Use a current Debian/Ubuntu VPS with Docker Engine and Compose v2. Point the domain's A/AAAA records to the VPS and allow inbound TCP 80/443 and UDP 443. Do not expose PostgreSQL or Redis publicly.

```bash
git clone <repository-url> kotori && cd kotori
cp .env.production.example .env.production
$EDITOR .env.production
docker compose --env-file .env.production -f compose.production.yml build
docker compose --env-file .env.production -f compose.production.yml up -d
docker compose --env-file .env.production -f compose.production.yml ps
curl -fsS https://mail.example.com/api/health
```

The one-shot `migrate` service must succeed before web and worker start. Caddy obtains and renews TLS certificates, proxies only to the internal web container, compresses responses, and adds HSTS, clickjacking, MIME-sniffing, referrer, permissions, and server-disclosure headers. Application containers run as unprivileged users with `no-new-privileges`; PostgreSQL, Redis AOF, and Caddy certificate/config state use named volumes.

For upgrades, pull the desired commit, rerun `build`, then `up -d`. Review migrations and take a database backup first. Inspect with `docker compose --env-file .env.production -f compose.production.yml logs -f web worker migrate caddy`. The readiness endpoint returns 200 only when the process can query PostgreSQL; Caddy waits for that health check.

## Backup and restore

Back up PostgreSQL daily and before every upgrade. Store encrypted copies off-host; database dumps include mailbox content and encrypted OAuth credentials. Also back up `.env.production` separately in an encrypted secret store. Redis contains reconstructable job state and normally does not need disaster-recovery backup, while Caddy certificates can be reissued.

```bash
mkdir -p backups
docker compose --env-file .env.production -f compose.production.yml exec -T postgres \
  pg_dump -U kotori -d kotori --format=custom > "backups/kotori-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Test restores regularly. To restore, stop web/worker, recreate an empty database, restore, run migrations, and restart:

```bash
docker compose --env-file .env.production -f compose.production.yml stop web worker
docker compose --env-file .env.production -f compose.production.yml exec -T postgres \
  dropdb -U kotori --if-exists kotori
docker compose --env-file .env.production -f compose.production.yml exec -T postgres \
  createdb -U kotori kotori
docker compose --env-file .env.production -f compose.production.yml exec -T postgres \
  pg_restore -U kotori -d kotori --clean --if-exists < backups/kotori-YYYYMMDDTHHMMSSZ.dump
docker compose --env-file .env.production -f compose.production.yml run --rm migrate
docker compose --env-file .env.production -f compose.production.yml up -d
```

Retention applies to the live database, not historical backups. Enforce matching expiry in backup storage (90 days unless a stricter policy applies), restrict access, and record restore tests. Users should disconnect Gmail before account offboarding; revocation is attempted and local encrypted credentials are marked revoked.
