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
Google OAuth must be configured with an Auth.js callback URL ending in
`/api/auth/callback/google`.
