import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("mobile composer exposes exact enums and has no serious accessibility violations", async ({
  page,
}) => {
  await page.goto("/test/mobile-smoke");
  await expect(
    page.getByRole("heading", { name: "Review the launch checklist" }),
  ).toBeVisible();
  await expect(
    page.locator('select[name="tone"] option').allTextContents(),
  ).resolves.toEqual([
    "Professional",
    "Warm professional",
    "Friendly",
    "Direct",
    "Diplomatic",
    "Academic",
  ]);
  await expect(
    page.locator('select[name="length"] option').allTextContents(),
  ).resolves.toEqual(["Short", "Standard", "Detailed"]);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact ?? ""),
    ),
  ).toEqual([]);
});

test("generation errors and current-edit approval acknowledgements are handled", async ({
  page,
}) => {
  await page.route("**/api/ai/replies", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "model_unavailable" }),
    }),
  );
  await page.route("**/api/ai/replies/*", async (route) => {
    const body = route.request().postDataJSON() as { action: string };
    if (body.action === "edit")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          requiredReviewFlags: ["FINANCIAL_COMMITMENT"],
          version: 2,
        }),
      });
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "review_acknowledgement_required",
        flags: ["FINANCIAL_COMMITMENT"],
      }),
    });
  });
  await page.goto("/test/mobile-smoke");
  await page.getByLabel("Reply option 1").fill("I promise to pay $500.");
  await page.getByRole("button", { name: "Save edits" }).click();
  await expect(
    page.getByText(/I reviewed: financial commitment/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve draft" }).click();
  await expect(page.getByRole("status")).toContainText(
    "review_acknowledgement_required",
  );
  await page.getByLabel("I reviewed: financial commitment").check();
  await page
    .getByLabel("What do you want to communicate?")
    .fill("Confirm receipt");
  await page.getByRole("button", { name: /Regenerate/ }).click();
  await expect(page.getByRole("status")).toContainText("model_unavailable");
});
