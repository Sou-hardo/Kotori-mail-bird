import { describe, expect, it } from "vitest";
import { base64UrlToUtf8, bodyText } from "./gmailData";

const encode = (text: string) =>
  Buffer.from(text, "utf8").toString("base64url");

describe("base64UrlToUtf8", () => {
  it("decodes a plain-text body", () => {
    expect(base64UrlToUtf8(encode("hello world"))).toBe("hello world");
  });
  it("decodes URL-safe characters (- and _) not present in standard base64", () => {
    // Bytes chosen so the standard base64 alphabet would emit '+' and '/'.
    const bytes = Uint8Array.from([0xfb, 0xff, 0xbf]);
    const std = Buffer.from(bytes).toString("base64"); // "+/+/" style
    const urlSafe = std.replace(/\+/g, "-").replace(/\//g, "_");
    expect(urlSafe).not.toBe(std);
    expect(base64UrlToUtf8(urlSafe)).toBe(
      new TextDecoder("utf-8").decode(bytes),
    );
  });
  it("decodes input with missing padding", () => {
    const raw = encode("pad?"); // Gmail sends unpadded base64url
    expect(raw.includes("=")).toBe(false);
    expect(base64UrlToUtf8(raw)).toBe("pad?");
  });
  it("decodes Unicode text", () => {
    const text = "héllo 🌍 世界";
    expect(base64UrlToUtf8(encode(text))).toBe(text);
  });
  it("returns undefined for malformed input instead of throwing", () => {
    expect(base64UrlToUtf8("not-valid-base64!!!")).toBeUndefined();
  });
});

describe("bodyText", () => {
  it("reads the body of a flat text/plain payload", () => {
    const payload = {
      mimeType: "text/plain",
      body: { data: encode("flat body") },
    };
    expect(bodyText(payload)).toBe("flat body");
  });
  it("recurses into nested MIME parts to find text/plain", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/html", body: { data: encode("<p>html</p>") } },
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: encode("nested plain") } },
          ],
        },
      ],
    };
    expect(bodyText(payload)).toBe("nested plain");
  });
  it("returns undefined when no text/plain part exists", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [{ mimeType: "text/html", body: { data: encode("<p>x</p>") } }],
    };
    expect(bodyText(payload)).toBeUndefined();
  });
  it("returns undefined for malformed body data instead of throwing", () => {
    const payload = {
      mimeType: "text/plain",
      body: { data: "!!!not base64!!!" },
    };
    expect(bodyText(payload)).toBeUndefined();
  });
});
