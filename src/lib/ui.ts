export const urgencyLabel = (category: string) =>
  category === "ACTION_REQUIRED"
    ? "Needs reply"
    : category === "WAITING"
      ? "Waiting"
      : "For your info";
export const confidenceLabel = (confidence: number) =>
  confidence >= 0.9
    ? "High confidence"
    : confidence >= 0.7
      ? "Likely"
      : "Review suggested";
export const initials = (address: string) =>
  (address.split("@")[0] ?? address)
    .split(/[._ -]/)
    .slice(0, 2)
    .map((v) => v[0]?.toUpperCase())
    .join("");
export const relativeTime = (date: Date) =>
  new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.round((date.getTime() - Date.now()) / 86400000),
    "day",
  );
