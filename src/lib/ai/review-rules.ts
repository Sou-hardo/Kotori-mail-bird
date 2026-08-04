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

export const rules: Array<[ReviewFlag, RegExp]> = [
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
