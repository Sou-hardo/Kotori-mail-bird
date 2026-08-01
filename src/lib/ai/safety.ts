import { sanitizeAiText } from "@/lib/ai/sanitize";

export const REVIEW_FLAGS = [
  "FINANCIAL_COMMITMENT",
  "LEGAL_OR_CONTRACT",
  "RECRUITMENT",
  "COMPLAINT",
  "SENSITIVE_INFORMATION",
  "DEADLINE_OR_PROMISE",
  "MISSING_ATTACHMENT",
  "MULTIPLE_RECIPIENTS",
] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

const rules: Array<[ReviewFlag, RegExp]> = [
  [
    "FINANCIAL_COMMITMENT",
    /\b(?:pay|payment|invoice|refund|budget|price|cost|usd|eur|£|\$\d)\b/i,
  ],
  [
    "LEGAL_OR_CONTRACT",
    /\b(?:contract|agreement|terms|legal|liability|nda|indemnif|signature)\b/i,
  ],
  [
    "RECRUITMENT",
    /\b(?:candidate|interview|hire|hiring|offer|salary|recruit)\b/i,
  ],
  [
    "COMPLAINT",
    /\b(?:complaint|unacceptable|disappointed|escalat|dissatisfied|poor service)\b/i,
  ],
  [
    "SENSITIVE_INFORMATION",
    /\b(?:password|secret|ssn|social security|passport|medical|bank account|credit card|confidential)\b/i,
  ],
  [
    "DEADLINE_OR_PROMISE",
    /\b(?:deadline|due (?:by|on)|promise|guarantee|commit(?:ted)?|will (?:deliver|finish|send)|by (?:monday|tuesday|wednesday|thursday|friday|tomorrow|eod))\b/i,
  ],
];

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
