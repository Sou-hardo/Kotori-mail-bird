import { describe, expect, it } from "vitest";
import {
  phaseLabel,
  progressPercent,
  remaining,
} from "@/lib/sync-progress";

describe("progressPercent", () => {
  it("computes a normal percentage", () => {
    expect(progressPercent(25, 100)).toBe(25);
  });

  it("returns null when total is undefined", () => {
    expect(progressPercent(25, undefined)).toBeNull();
  });

  it("returns null when total is zero", () => {
    expect(progressPercent(0, 0)).toBeNull();
  });

  it("clamps to 100 when imported exceeds total", () => {
    expect(progressPercent(150, 100)).toBe(100);
  });

  it("returns null when imported is undefined", () => {
    expect(progressPercent(undefined, 100)).toBeNull();
  });
});

describe("remaining", () => {
  it("computes remaining count", () => {
    expect(remaining(25, 100)).toBe(75);
  });

  it("returns null when total is undefined", () => {
    expect(remaining(25, undefined)).toBeNull();
  });

  it("never goes negative when imported exceeds total", () => {
    expect(remaining(150, 100)).toBe(0);
  });

  it("returns null when imported is undefined", () => {
    expect(remaining(undefined, 100)).toBeNull();
  });
});

describe("phaseLabel", () => {
  it("labels known phases", () => {
    expect(phaseLabel("BACKFILL", "RUNNING")).toBe("Importing mail history…");
    expect(phaseLabel("COUNTING", "RUNNING")).toBe("Counting mailbox size…");
    expect(phaseLabel("INCREMENTAL", "RUNNING")).toBe(
      "Checking for new mail…",
    );
  });

  it("falls back to status when phase is missing", () => {
    expect(phaseLabel(undefined, "RUNNING")).toBe("Syncing…");
    expect(phaseLabel(undefined, "FAILED")).toBe("Sync failed");
    expect(phaseLabel(undefined, "QUOTA_PAUSED")).toBe(
      "Paused (Gmail quota)",
    );
  });

  it("defaults to Idle when nothing is known", () => {
    expect(phaseLabel(undefined, undefined)).toBe("Idle");
  });
});
