// Row-level encrypt/decrypt for the mail tables. One place per table so the
// field list and the associated-data labels can't drift between the sync
// path, the AI path and the read path.
import type { Doc } from "./_generated/dataModel";
import {
  aad,
  decJson,
  decMaybe,
  encJson,
  encMaybe,
  mailboxScope,
  userScope,
} from "./crypto";

// Row shapes after decryption: the fields stored as one JSON ciphertext come
// back as the arrays/objects the rest of the app expects.
export type DecryptedMessage = Omit<
  Doc<"emailMessages">,
  "toAddresses" | "ccAddresses" | "headers"
> & {
  toAddresses: string[];
  ccAddresses: string[];
  headers?: unknown;
};

export type DecryptedDraft = Omit<
  Doc<"gmailDrafts">,
  "toAddresses" | "ccAddresses"
> & { toAddresses: string[]; ccAddresses: string[] };

export type Box = {
  enc(field: string, value: string | undefined): Promise<string | undefined>;
  dec(field: string, value: string | undefined): Promise<string | undefined>;
  encJson(field: string, value: unknown): Promise<string | undefined>;
  decJson<T>(field: string, value: string | undefined): Promise<T | undefined>;
};

const box = (ownerUserId: string, scopeId: string, scope: string): Box => ({
  enc: (field, value) =>
    encMaybe(value, scope, aad(ownerUserId, scopeId, field)),
  dec: (field, value) =>
    decMaybe(value, scope, aad(ownerUserId, scopeId, field)),
  encJson: (field, value) =>
    encJson(value, scope, aad(ownerUserId, scopeId, field)),
  decJson: <T>(field: string, value: string | undefined) =>
    decJson<T>(value, scope, aad(ownerUserId, scopeId, field)),
});

// Mail content is keyed per mailbox, so a leaked mailbox key exposes exactly
// one inbox.
export const mailboxBox = (connection: Doc<"gmailConnections">): Box => {
  const id = String(connection._id);
  if (!connection.ownerUserId)
    throw new Error("connection_missing_owner: run migrations:purgeMailData");
  return box(String(connection.ownerUserId), id, mailboxScope(id));
};

// Rows that belong to a person rather than a mailbox (reminders they wrote,
// notifications they received).
export const userBox = (userId: string): Box =>
  box(userId, userId, userScope(userId));

export const encryptThread = async (
  b: Box,
  row: { subject?: string; snippet?: string },
) => ({
  subject: await b.enc("emailThreads.subject", row.subject),
  snippet: await b.enc("emailThreads.snippet", row.snippet),
});

export const decryptThread = async <T extends Doc<"emailThreads">>(
  b: Box,
  row: T,
) => ({
  ...row,
  subject: await b.dec("emailThreads.subject", row.subject),
  snippet: await b.dec("emailThreads.snippet", row.snippet),
});

export const encryptMessage = async (
  b: Box,
  row: {
    fromAddress: string;
    toAddresses: string[];
    ccAddresses: string[];
    snippet?: string;
    bodyText?: string;
    headers?: unknown;
  },
) => ({
  fromAddress: (await b.enc("emailMessages.fromAddress", row.fromAddress))!,
  toAddresses: await b.encJson("emailMessages.toAddresses", row.toAddresses),
  ccAddresses: await b.encJson("emailMessages.ccAddresses", row.ccAddresses),
  snippet: await b.enc("emailMessages.snippet", row.snippet),
  bodyText: await b.enc("emailMessages.bodyText", row.bodyText),
  headers: await b.encJson("emailMessages.headers", row.headers),
});

export const decryptMessage = async (
  b: Box,
  row: Doc<"emailMessages">,
): Promise<DecryptedMessage> => ({
  ...row,
  fromAddress:
    (await b.dec("emailMessages.fromAddress", row.fromAddress)) ?? "",
  toAddresses:
    (await b.decJson<string[]>("emailMessages.toAddresses", row.toAddresses)) ??
    [],
  ccAddresses:
    (await b.decJson<string[]>("emailMessages.ccAddresses", row.ccAddresses)) ??
    [],
  snippet: await b.dec("emailMessages.snippet", row.snippet),
  bodyText: await b.dec("emailMessages.bodyText", row.bodyText),
  headers: await b.decJson<unknown>("emailMessages.headers", row.headers),
});

export const decryptAttachment = async (b: Box, row: Doc<"attachments">) => ({
  ...row,
  filename: await b.dec("attachments.filename", row.filename),
  contentId: await b.dec("attachments.contentId", row.contentId),
});

export const decryptSummary = async (b: Box, row: Doc<"threadSummaries">) => ({
  ...row,
  summary: (await b.dec("threadSummaries.summary", row.summary)) ?? "",
  requestedActions:
    (await b.decJson<string[]>(
      "threadSummaries.requestedActions",
      row.requestedActions,
    )) ?? [],
});

export const decryptClassification = async (
  b: Box,
  row: Doc<"classifications">,
) => ({
  ...row,
  rationale: await b.dec("classifications.rationale", row.rationale),
});

export const decryptAnalysis = async (b: Box, row: Doc<"threadAnalyses">) => ({
  ...row,
  analysis: await b.decJson<unknown>("threadAnalyses.analysis", row.analysis),
  safetyFlags: await b.decJson<unknown>(
    "threadAnalyses.safetyFlags",
    row.safetyFlags,
  ),
});

export const decryptReplyOption = async (b: Box, row: Doc<"replyOptions">) => ({
  ...row,
  body: (await b.dec("replyOptions.body", row.body)) ?? "",
});

export const decryptDraft = async (
  b: Box,
  row: Doc<"gmailDrafts">,
): Promise<DecryptedDraft> => ({
  ...row,
  subject: await b.dec("gmailDrafts.subject", row.subject),
  body: (await b.dec("gmailDrafts.body", row.body)) ?? "",
  toAddresses:
    (await b.decJson<string[]>("gmailDrafts.toAddresses", row.toAddresses)) ??
    [],
  ccAddresses:
    (await b.decJson<string[]>("gmailDrafts.ccAddresses", row.ccAddresses)) ??
    [],
});
