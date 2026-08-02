# Changelog

All notable changes to Kotori Mail Bird are documented in this file.

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
