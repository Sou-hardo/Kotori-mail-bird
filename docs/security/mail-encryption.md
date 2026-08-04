# Mail data encryption and mailbox-owner authorization

This document describes the design tracked by issue #61: encrypting stored
mail content at rest and scoping mailbox access to the connecting user
instead of the whole tenant. It states plainly what the change does and does
not protect against.

## Authorization: mailbox-owner scoping

`gmailConnections` gains an immutable `ownerUserId`, set once when the
connection is created and never changed. `convex/principal.ts` adds
`ownedConnection`, `ownedThread`, and `ownedConnections` helpers that check
`ownerUserId` against the calling user; callers keep their own null-vs-throw
behaviour.

Tenant membership is no longer sufficient to read mail. A user who is
`OWNER` or `ADMIN` of a tenant cannot read another member's connected
mailbox just by virtue of that role; every read and mutation that touches
`gmailConnections`, `emailThreads`, `emailMessages`, or anything scoped to a
thread must resolve through the owner-scoped helpers, not through
`requirePrincipal`'s tenant/role check alone. `requirePrincipal` still
establishes tenant membership and role for tenant-level operations (billing,
membership management); it is not sufficient on its own for mail access.

## Encryption scheme

Sensitive fields are encrypted with AES-256-GCM using Web Crypto in
`convex/crypto.ts` (Convex actions and mutations run in a V8 isolate, not
Node, so this is Web Crypto's `SubtleCrypto`, not `node:crypto`).

`src/lib/security/credentials.ts` is unchanged and still owns
`gmailConnections.encryptedCredentials` (OAuth refresh tokens) under its own
`CREDENTIAL_ENCRYPTION_KEY`. The two schemes are deliberately separate: that
one runs only in Node actions and API routes, this one has to run inside
Convex queries and mutations as well.

Ciphertext is stored as a single versioned string:

```
v1:<base64url iv>.<base64url ciphertext+tag>
```

The version prefix lets a future scheme change coexist with old rows during
migration.

### Master key

The master key lives only in the Convex environment variable
`MAIL_ENCRYPTION_KEY`: 32 raw bytes, base64-encoded, set with

```bash
npx convex env set MAIL_ENCRYPTION_KEY <base64>
```

It is never stored in Convex data, never logged, and never derived from a
user password or an OAuth token. Losing it is unrecoverable by design (see
Retention below).

### Per-mailbox and per-user key separation

Rather than using the master key directly on every field, each row derives a
scoped key:

- Mailbox-scoped rows (threads, messages, attachments, classifications,
  summaries, analyses, reply options, drafts):
  `mailboxKey = HMAC-SHA256(master, "kotori-mailbox-v1|" + connectionId)`
- User-scoped rows (notifications, follow-up reminders):
  `userKey = HMAC-SHA256(master, "kotori-user-v1|" + userId)`

This means compromising one mailbox's derived key does not expose another
mailbox's data, even though both trace back to the same master key.

### Associated data binding

Every encrypt/decrypt call passes AES-GCM associated data of the form:

```
<ownerUserId>|<scopeId>|<table>.<field>
```

where `scopeId` is the `connectionId` or `userId` used to derive the key.
GCM authenticates but does not encrypt this string, so a ciphertext copied
into a different row, a different field, or under a different owner fails
authentication and refuses to decrypt, even if the raw bytes are otherwise
valid AES-GCM output for the same key.

### Encrypted fields

| Table               | Fields                                                                        |
| ------------------- | ----------------------------------------------------------------------------- |
| `emailThreads`      | `subject`, `snippet`                                                          |
| `emailMessages`     | `fromAddress`, `toAddresses`, `ccAddresses`, `snippet`, `bodyText`, `headers` |
| `attachments`       | `filename`, `contentId`                                                       |
| `classifications`   | `rationale`                                                                   |
| `threadSummaries`   | `summary`, `requestedActions`                                                 |
| `threadAnalyses`    | `analysis`, `safetyFlags`                                                     |
| `replyOptions`      | `body`                                                                        |
| `gmailDrafts`       | `subject`, `body`, `toAddresses`, `ccAddresses`                               |
| `notifications`     | `title`, `body`                                                               |
| `followUpReminders` | `title`, `note`                                                               |

### What is deliberately left unencrypted, and why

Convex system fields (`_id`, `_creationTime`), document ids and foreign
keys, all timestamps, Gmail label ids, `isUnread`, sync counters
(`syncStates`), and `quotaUsage` rows are not encrypted. They carry no mail
content and are needed for indexed queries, sorting, and scheduling, which
require plaintext comparison.

`processingJobs.input`/`output` and `auditEvents.metadata` are also not
encrypted. Checked against `authorizeJobInput` in `convex/jobs.ts`, these
fields carry only ids (`connectionId`, `threadId`, `identityId`,
`draftId`), counts, and enum-like strings such as `intent`/`tone`/`length` —
never subject lines, addresses, or message bodies.

Two audit payloads did carry mail-derived values before this change and were
narrowed rather than encrypted, in `convex/domain.ts` `replyAction`: the
recipient list is now recorded as `recipientCount`, and a rejection reason as
`reasonLength`.

Two `emailMessages` columns were dropped rather than encrypted. `bodyHtml`
was never written or read. `internetMessageId` duplicated the RFC822
`Message-ID` that is already inside the encrypted `headers` blob, was never
read either, and in the clear it leaked the sending domain (e.g.
`<...@ltx1-app84070.prod.linkedin.com>`). `convex/access.test.ts` now asserts
that every string field on a stored message is either ciphertext or a Gmail
id, so a new plaintext column cannot be added without a failing test.

## Threat model

### What this protects against

- A leaked database export, Convex backup, or snapshot: mail content is
  ciphertext without `MAIL_ENCRYPTION_KEY`.
- One tenant member reading another member's mailbox through normal
  application queries: enforced independently by the owner-scoping in
  `convex/principal.ts`, and reinforced by the associated-data binding,
  which would make a cross-owner row unreadable even if the authorization
  check were bypassed.

### What this does not protect against — this is not end-to-end encryption

The Convex backend holds `MAIL_ENCRYPTION_KEY` and decrypts mail in-process
to render the inbox, run search, and build AI prompts. Anyone who obtains
both the database contents and the deployment environment (and therefore
the key) can read everything. A compromised or malicious server operator,
or an attacker with code execution inside the Convex deployment, can read
mail regardless of this scheme.

**Search.** `convex/domain.ts` `listInbox` decrypts candidate threads and
messages in memory and substring-matches against the search query. No
plaintext is written back to storage; plaintext exists only for the
duration of that query's execution. This is a deliberate deviation from a
design where the server never sees plaintext (e.g. client-side search index
or searchable encryption) — the server already needs plaintext to build AI
prompts for analysis and reply generation, so a plaintext-blind search path
would add complexity without closing an attack surface that other parts of
the system already require.

**External AI disclosure.** `src/lib/ai/prompts.ts` `threadData()` sends
the subject, from/to/cc addresses, attachment filenames, and up to 20,000
characters of message body for the last 30 messages to the DeepSeek API
(`src/lib/ai/deepseek.ts`) on every `analyze` and `reply-generate` call.
Encryption at rest does nothing to reduce this: it is a disclosure to a
third-party API that happens whenever those features run. `future-plan.md`
proposes replacing this with a self-hosted `llama.cpp` model to remove the
third-party disclosure; that is not implemented yet.

**Metadata that remains visible without the key.** The number of threads
and messages per mailbox, all timestamps, Gmail label ids, read/unread
state, attachment sizes and MIME types, and which user owns which mailbox
are all stored in plaintext and are visible to anyone with database access,
independent of the encryption key.

## Retention and crypto-shredding

`convex/jobs.ts` `retentionBatch` is unchanged by this work: it still
deletes `emailThreads` (and cascaded children) older than 90 days, and
`auditEvents` older than 365 days, on the existing daily schedule.

Deleting `MAIL_ENCRYPTION_KEY` makes all currently-stored mail permanently
unreadable — crypto-shredding — but does not delete any rows. Row deletion
still only happens through `retentionBatch` and explicit disconnect/delete
flows.

## Key rotation

Stored mail is a 90-day cache of Gmail, not the source of truth, so
rotation is re-sync rather than re-encryption:

1. Set the new key: `npx convex env set MAIL_ENCRYPTION_KEY <new base64>`.
2. Run the purge migration: `npx convex run migrations:purgeMailData`.
3. Let the existing Gmail poll cycle refill mail under the new key.

Automated in-place re-encryption (decrypt under the old key, re-encrypt
under the new one, without a purge) is deferred to a follow-up issue.
`gmailConnections` carries an optional `keyVersion` field to support that
tooling later; it is not read or enforced by anything yet.
