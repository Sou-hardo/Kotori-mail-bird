import { sanitizeAiText } from "@/lib/ai/sanitize";
import { REVIEW_FLAGS, rules, type ReviewFlag } from "@/lib/ai/review-rules";

export { REVIEW_FLAGS, type ReviewFlag };

export interface SafetyInput {
  subject?: string | null;
  messages: Array<{
    bodyText?: string | null;
    snippet?: string | null;
    toAddresses: string[];
    ccAddresses: string[];
    attachments: unknown[];
  }>;
}

export interface OutgoingSafetyInput {
  body?: string | null;
  intent?: string | null;
  identity?: string | null;
  closing?: string | null;
  recipients?: string[];
  attachmentCount?: number;
}

export function detectReviewFlags(
  input: SafetyInput,
  outgoing: OutgoingSafetyInput = {},
): ReviewFlag[] {
  const text = sanitizeAiText(
    [
      input.subject,
      ...input.messages.flatMap((m) => [m.bodyText, m.snippet]),
      outgoing.intent,
      outgoing.identity,
      outgoing.closing,
      outgoing.body,
    ].join("\n"),
    200_000,
  );
  const flags = rules
    .filter(([, expression]) => expression.test(text))
    .map(([flag]) => flag);
  if (
    /\b(?:attach(?:ed|ment)?|enclos(?:ed|ure))\b/i.test(
      [outgoing.intent, outgoing.body].filter(Boolean).join("\n"),
    ) &&
    (outgoing.attachmentCount ?? 0) === 0
  )
    flags.push("MISSING_ATTACHMENT");
  const recipients = new Set(
    (outgoing.recipients ?? []).map((v) => v.toLowerCase()),
  );
  if (recipients.size > 1) flags.push("MULTIPLE_RECIPIENTS");
  return [...new Set(flags)];
}

export function assertReviewAcknowledged(
  required: ReviewFlag[],
  provided: string[],
) {
  const accepted = new Set(provided);
  const missing = required.filter((flag) => !accepted.has(flag));
  if (missing.length) throw new ReviewRequiredError(missing);
}

export class ReviewRequiredError extends Error {
  constructor(readonly flags: ReviewFlag[]) {
    super(`Explicit review acknowledgement required: ${flags.join(", ")}`);
    this.name = "ReviewRequiredError";
  }
}
