import sanitizeHtml from "sanitize-html";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function sanitizeAiText(value: unknown, max = 20_000) {
  return sanitizeHtml(String(value ?? ""), {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\r\n?/g, "\n")
    .slice(0, max)
    .trim();
}

export function sanitizeJsonStrings<T>(value: T): T {
  if (typeof value === "string") return sanitizeAiText(value) as T;
  if (Array.isArray(value)) return value.map(sanitizeJsonStrings) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeJsonStrings(item),
      ]),
    ) as T;
  }
  return value;
}
