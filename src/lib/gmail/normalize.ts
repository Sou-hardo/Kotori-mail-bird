import sanitizeHtml from "sanitize-html";
import type { gmail_v1 } from "googleapis";

const SAFE_HTML = {
  allowedTags: [
    "p",
    "br",
    "b",
    "strong",
    "i",
    "em",
    "ul",
    "ol",
    "li",
    "blockquote",
    "a",
  ],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["http", "https", "mailto"],
};

function decode(data?: string | null) {
  return data ? Buffer.from(data, "base64url").toString("utf8") : undefined;
}

function parts(payload?: gmail_v1.Schema$MessagePart): {
  text?: string;
  html?: string;
  attachments: Array<{
    id: string;
    filename?: string;
    mimeType: string;
    size: number;
    contentId?: string;
  }>;
} {
  const result: ReturnType<typeof parts> = { attachments: [] };
  const walk = (part?: gmail_v1.Schema$MessagePart) => {
    if (!part) return;
    const attachmentId = part.body?.attachmentId;
    if (attachmentId)
      result.attachments.push({
        id: attachmentId,
        filename: part.filename || undefined,
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body?.size ?? 0,
        contentId: header(part.headers, "content-id"),
      });
    else if (part.mimeType === "text/plain")
      result.text ??= decode(part.body?.data);
    else if (part.mimeType === "text/html")
      result.html ??= sanitizeHtml(decode(part.body?.data) ?? "", SAFE_HTML);
    part.parts?.forEach(walk);
  };
  walk(payload);
  return result;
}

export function header(
  headers: gmail_v1.Schema$MessagePartHeader[] | null | undefined,
  name: string,
) {
  return (
    headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? undefined
  );
}

function addresses(value?: string) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.match(/<([^>]+)>/)?.[1] ?? entry)
    .map((entry) => entry.toLowerCase());
}

export function normalizeMessage(message: gmail_v1.Schema$Message) {
  if (!message.id) throw new Error("Gmail message missing id");
  const content = parts(message.payload ?? undefined);
  const safeHeaders = Object.fromEntries(
    [
      "Message-ID",
      "References",
      "In-Reply-To",
      "Subject",
      "From",
      "To",
      "Cc",
      "Date",
    ].flatMap((name) => {
      const value = header(message.payload?.headers, name);
      return value ? [[name.toLowerCase(), value]] : [];
    }),
  );
  const sentAt = new Date(Number(message.internalDate ?? Date.now()));
  return {
    id: message.id,
    internetMessageId: header(message.payload?.headers, "Message-ID"),
    fromAddress:
      addresses(header(message.payload?.headers, "From"))[0] ?? "unknown",
    toAddresses: addresses(header(message.payload?.headers, "To")),
    ccAddresses: addresses(header(message.payload?.headers, "Cc")),
    sentAt,
    snippet: sanitizeHtml(message.snippet ?? "", {
      allowedTags: [],
      allowedAttributes: {},
    }),
    bodyText: content.text?.slice(0, 200_000),
    bodyHtml: content.html?.slice(0, 200_000),
    headers: safeHeaders,
    attachments: content.attachments,
  };
}

export function normalizeThread(thread: gmail_v1.Schema$Thread) {
  if (!thread.id) throw new Error("Gmail thread missing id");
  const messages = (thread.messages ?? []).map(normalizeMessage);
  const latest = messages.reduce((a, b) => (a.sentAt > b.sentAt ? a : b));
  const headers = thread.messages?.at(-1)?.payload?.headers;
  const labels = [
    ...new Set(
      (thread.messages ?? []).flatMap((message) => message.labelIds ?? []),
    ),
  ];
  return {
    id: thread.id,
    subject: sanitizeHtml(header(headers, "Subject") ?? "", {
      allowedTags: [],
      allowedAttributes: {},
    }).slice(0, 998),
    snippet: sanitizeHtml(thread.snippet ?? "", {
      allowedTags: [],
      allowedAttributes: {},
    }),
    latestMessageAt: latest.sentAt,
    isUnread: labels.includes("UNREAD"),
    labelIds: labels,
    messages,
  };
}
