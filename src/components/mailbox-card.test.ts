import { describe, expect, it } from "vitest";
import { resolveSyncJobOutcome, shouldKeepPolling } from "./mailbox-card";

describe("resolveSyncJobOutcome", () => {
  it("stays pending when the target job is not yet in the list", () => {
    expect(resolveSyncJobOutcome([], "job-2")).toEqual({ kind: "pending" });
  });

  it("ignores an older job even when it sorts ahead of the target job", () => {
    const jobs = [
      { id: "job-initial", status: "SUCCEEDED" },
      { id: "job-2", status: "RUNNING" },
    ];
    expect(resolveSyncJobOutcome(jobs, "job-2")).toEqual({ kind: "pending" });
  });

  it("reports success only once the target job id has succeeded", () => {
    const jobs = [
      { id: "job-initial", status: "SUCCEEDED" },
      { id: "job-2", status: "SUCCEEDED" },
    ];
    expect(resolveSyncJobOutcome(jobs, "job-2")).toEqual({
      kind: "succeeded",
    });
  });

  it("reports failure for the target job's terminal failure status", () => {
    const jobs = [{ id: "job-2", status: "FAILED" }];
    expect(resolveSyncJobOutcome(jobs, "job-2")).toEqual({
      kind: "failed",
      status: "FAILED",
    });
  });

  it("treats DEAD_LETTER and CANCELLED as failures", () => {
    expect(
      resolveSyncJobOutcome([{ id: "job-2", status: "DEAD_LETTER" }], "job-2"),
    ).toEqual({ kind: "failed", status: "DEAD_LETTER" });
    expect(
      resolveSyncJobOutcome([{ id: "job-2", status: "CANCELLED" }], "job-2"),
    ).toEqual({ kind: "failed", status: "CANCELLED" });
  });
});

describe("shouldKeepPolling", () => {
  it("stops when there is no sync state", () => {
    expect(shouldKeepPolling(null)).toBe(false);
  });

  it("keeps polling for active phases", () => {
    for (const phase of ["COUNTING", "BACKFILL", "INCREMENTAL"] as const) {
      expect(shouldKeepPolling({ status: "RUNNING", phase })).toBe(true);
    }
  });

  it("keeps polling when status is RUNNING even without a phase", () => {
    expect(shouldKeepPolling({ status: "RUNNING" })).toBe(true);
  });

  it("stops when QUOTA_PAUSED, whether reported via phase or status", () => {
    expect(
      shouldKeepPolling({ status: "QUOTA_PAUSED", phase: "QUOTA_PAUSED" }),
    ).toBe(false);
    expect(shouldKeepPolling({ status: "QUOTA_PAUSED" })).toBe(false);
  });

  it("stops on IDLE and FAILED", () => {
    expect(shouldKeepPolling({ status: "IDLE", phase: "IDLE" })).toBe(false);
    expect(shouldKeepPolling({ status: "FAILED" })).toBe(false);
  });
});
