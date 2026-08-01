export type ReplySource = {
  subject?: string | null;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses?: string[];
  internetMessageId?: string | null;
  headers?: unknown;
};

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}
function encodeBody(body: string) {
  return Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString(
    "base64url",
  );
}

export function createReplyMime(source: ReplySource, body: string) {
  if (!source.internetMessageId)
    throw new Error(
      "Original message has no Message-ID; cannot create a threaded reply draft",
    );
  const stored =
    typeof source.headers === "object" && source.headers
      ? (source.headers as Record<string, unknown>)
      : {};
  const references = [
    typeof stored.references === "string" ? stored.references : "",
    source.internetMessageId,
  ]
    .filter(Boolean)
    .join(" ");
  const subject = source.subject?.match(/^re:/i)
    ? source.subject
    : `Re: ${source.subject || ""}`;
  const headers = [
    `From: ${cleanHeader(source.fromAddress)}`,
    `To: ${source.toAddresses.map(cleanHeader).join(", ")}`,
    ...(source.ccAddresses?.length
      ? [`Cc: ${source.ccAddresses.map(cleanHeader).join(", ")}`]
      : []),
    `Subject: ${cleanHeader(subject)}`,
    `In-Reply-To: ${cleanHeader(source.internetMessageId)}`,
    `References: ${cleanHeader(references)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  return encodeBody(`${headers.join("\r\n")}\r\n\r\n${body}`);
}
