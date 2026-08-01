import { describe, expect, it } from "vitest";
import { createReplyMime } from "@/lib/gmail/mime";

describe("reply MIME", () => {
  it("creates a draft reply with original threading headers", () => {
    const raw = createReplyMime(
      {
        subject: "Hello",
        fromAddress: "sender@example.com",
        toAddresses: ["me@example.com"],
        internetMessageId: "<original@example.com>",
        headers: { references: "<older@example.com>" },
      },
      "Thanks!",
    );
    const decoded = Buffer.from(raw, "base64url").toString();
    expect(decoded).toContain("To: sender@example.com\r\nSubject: Re: Hello");
    expect(decoded).toContain("In-Reply-To: <original@example.com>");
    expect(decoded).toContain(
      "References: <older@example.com> <original@example.com>",
    );
    expect(decoded).toContain("\r\n\r\nThanks!");
  });
  it("refuses an unthreaded reply", () =>
    expect(() =>
      createReplyMime({ fromAddress: "a@b.com", toAddresses: [] }, "body"),
    ).toThrow("Message-ID"));
});
