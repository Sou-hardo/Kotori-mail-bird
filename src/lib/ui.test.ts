import { describe, expect, it } from "vitest";
import { confidenceLabel, initials, urgencyLabel } from "./ui";
describe("UI helpers", () => {
  it("formats triage metadata", () => {
    expect(urgencyLabel("ACTION_REQUIRED")).toBe("Needs reply");
    expect(confidenceLabel(0.96)).toBe("High confidence");
    expect(initials("alex.chen@example.com")).toBe("AC");
  });
});
