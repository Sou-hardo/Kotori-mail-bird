import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";

// One-shot cutover to encrypted mail storage (GitHub issue #61).
//
// Stored mail is a 90-day cache of Gmail, so the migration path is to delete
// every plaintext row and let the normal sync refill it as ciphertext. That
// removes the plaintext outright instead of leaving a re-encrypted copy
// alongside whatever the old rows left in exports and backups.
//
// Idempotent and resumable: it deletes a bounded batch per transaction and
// reschedules itself until every listed table is empty.

const BATCH = 200;

// Deleted in child-before-parent order so an interrupted run never strands a
// row whose parent is already gone.
const PURGE_TABLES = [
  "attachments",
  "emailMessages",
  "replyOptions",
  "replyGenerations",
  "threadAnalyses",
  "threadSummaries",
  "classifications",
  "gmailDrafts",
  "notifications",
  "emailThreads",
] as const satisfies readonly TableNames[];

export const purgeMailData = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx) => {
    // Backfill first: a connection without an owner cannot be encrypted to
    // anyone, so the sync would fail on the very first message.
    let ownersBackfilled = 0;
    for (const connection of await ctx.db.query("gmailConnections").collect()) {
      if (connection.ownerUserId) continue;
      const tenant = await ctx.db.get(connection.tenantId);
      const authUserId = tenant?.ownerAuthUserId;
      const owner = authUserId
        ? await ctx.db
            .query("users")
            .withIndex("by_auth_user", (q) => q.eq("authUserId", authUserId))
            .unique()
        : null;
      if (!owner) continue;
      await ctx.db.patch(connection._id, { ownerUserId: owner._id });
      ownersBackfilled++;
    }

    for (const table of PURGE_TABLES) {
      const rows = await ctx.db.query(table).take(BATCH);
      if (!rows.length) continue;
      for (const row of rows) await ctx.db.delete(row._id as Id<TableNames>);
      await ctx.scheduler.runAfter(0, internal.migrations.purgeMailData, {});
      return { done: false, table, deleted: rows.length, ownersBackfilled };
    }

    // Everything is gone; rewind the sync checkpoints so the next cron poll
    // does a full backfill rather than asking Gmail for history since an id
    // whose messages no longer exist locally.
    for (const state of await ctx.db.query("syncStates").collect())
      await ctx.db.patch(state._id, {
        historyId: undefined,
        pageToken: undefined,
        backfillPageToken: undefined,
        backfillDone: undefined,
        phase: undefined,
        importedThreads: 0,
        importedMessages: 0,
        status: "IDLE",
        updatedAt: Date.now(),
      });
    return { done: true, ownersBackfilled };
  },
});
