# Changelog

All notable changes to Kotori Mail Bird are documented in this file.

## [0.3.0] - 2026-08-03

### Added

- Gmail connect page explaining the requested `gmail.readonly` and `gmail.compose` scopes, with a link into the OAuth start route.
- Onboarding gate: the assistant shell now redirects to `/connect` for any tenant without an `ACTIVE` Gmail connection, and the connect page itself redirects to `/inbox` once one exists.
- Inbox connect-success and first-sync states after the OAuth callback completes.
- Settings mailbox card with manual "Sync now" and "Disconnect" controls, backed by the sync-status and disconnect API routes.
- `listConnections` Convex query returning each tenant's Gmail connections with their sync state.

### Fixed

- OAuth callback now reads account identity from the verified Google `id_token` instead of the userinfo endpoint (#29).
- Callback failures redirect back to `/connect` with an error code instead of returning a raw 500 (#35).
- The PKCE cookie is cleared with a path matching the one it was set with (#36).
- The connect success confirmation on `/inbox` is no longer dropped by the root redirect (#33).
- `listInbox` reads are bounded and no longer issue one Convex read per thread (#37).

### Security

- Encrypted Gmail credentials are no longer serialized to the client (#45).
- Gmail authorization now also requests the `openid` and `email` identity scopes needed to verify the connecting Google account. These are identity-only: they are not persisted to `gmailConnections.scopes`. Gmail data permissions remain exactly `gmail.readonly` and `gmail.compose`, with no send scope, endpoint, method, or job.

## [0.2.0] - 2026-08-02

### Changed

- Migrated application data, authentication, scheduled work, and background processing to the existing managed Convex project `kotori-db`.
- Upgraded the package-manager toolchain to pnpm 11.18.0 and Node.js 22.13 or newer across local development, CI, and container builds.
- Removed legacy BullMQ and ioredis runtime configuration after the Convex Workpool migration.

### Security

- Pinned patched `sharp` 0.35.3 and `postcss` 8.5.25 releases across the dependency graph.
- Added Dependabot coverage for pnpm, GitHub Actions, and Docker dependencies.
- Added CodeQL analysis for JavaScript and TypeScript changes and a weekly scheduled scan.

### Operations

- Prepared the frontend and Caddy VPS runbook, but deferred the live VPS rollout for v0.2.0 pending explicit deployment approval.
