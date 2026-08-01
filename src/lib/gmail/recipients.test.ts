import { describe, expect, it } from "vitest";
import { latestInbound, replyAllRecipients } from "./recipients";

describe("reply-all recipients", () => {
  it("uses the latest inbound message and excludes the mailbox owner", () => {
    const messages = [
      {
        fromAddress: "a@example.com",
        toAddresses: ["me@example.com"],
        ccAddresses: [],
      },
      {
        fromAddress: "me@example.com",
        toAddresses: ["a@example.com"],
        ccAddresses: ["b@example.com"],
      },
    ];
    const inbound = latestInbound(messages, "Me <me@example.com>");
    expect(inbound).toBe(messages[0]);
    expect(replyAllRecipients(inbound!, "me@example.com")).toEqual({
      to: ["a@example.com"],
      cc: [],
    });
  });

  it("preserves other To/Cc participants without duplicates", () => {
    expect(
      replyAllRecipients(
        {
          fromAddress: "Sender <sender@example.com>",
          toAddresses: ["me@example.com", "other@example.com"],
          ccAddresses: ["other@example.com", "cc@example.com"],
        },
        "me@example.com",
      ),
    ).toEqual({
      to: ["Sender <sender@example.com>", "other@example.com"],
      cc: ["cc@example.com"],
    });
  });
});
