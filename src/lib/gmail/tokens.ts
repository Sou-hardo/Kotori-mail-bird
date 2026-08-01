import type { Credentials } from "google-auth-library";

export function mergeRefreshedCredentials(
  current: Credentials,
  refreshed: Credentials,
): Credentials {
  return {
    ...current,
    ...refreshed,
    refresh_token: refreshed.refresh_token ?? current.refresh_token,
  };
}
