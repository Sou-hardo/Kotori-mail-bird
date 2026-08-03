import { describe, expect, it } from "vitest";
import { resolveSyncJobOutcome } from "./mailbox-card";

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
