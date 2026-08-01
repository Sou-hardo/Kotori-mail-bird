import { describe, expect, it } from "vitest";
import { operationalDedupeId } from "@/lib/jobs/dedupe";

describe("job deduplication", () => {
  it("is stable for the same tenant/kind/key and isolated otherwise", () => {
    const first = operationalDedupeId(
      "tenant",
      "gmail.sync",
      "connection:bucket",
    );
    expect(
      operationalDedupeId("tenant", "gmail.sync", "connection:bucket"),
    ).toBe(first);
    expect(
      operationalDedupeId("other", "gmail.sync", "connection:bucket"),
    ).not.toBe(first);
  });
});
