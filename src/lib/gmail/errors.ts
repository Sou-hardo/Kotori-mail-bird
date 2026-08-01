export function isGmailHistoryExpired(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Number((error as { code: unknown }).code) === 404
  );
}

export function isRetryableGmailError(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  const code = Number((error as { code: unknown }).code);
  return code === 429 || code >= 500;
}
