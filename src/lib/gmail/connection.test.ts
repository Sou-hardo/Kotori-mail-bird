import { describe, expect, it } from "vitest";
import { mergeRefreshedCredentials } from "@/lib/gmail/tokens";

describe("token refresh persistence", () => {
  it("preserves the offline refresh token when Google only returns an access token", () => {
    expect(
      mergeRefreshedCredentials(
        { refresh_token: "refresh", access_token: "old" },
        { access_token: "new", expiry_date: 42 },
      ),
    ).toMatchObject({
      refresh_token: "refresh",
      access_token: "new",
      expiry_date: 42,
    });
  });
});
