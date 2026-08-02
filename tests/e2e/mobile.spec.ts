import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

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
  await expect(
    page.getByRole("switch", { name: "Generate three suggestions" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Regenerate suggestion" }),
  ).toBeVisible();
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

test("saved preference and completed reply jobs update automatically on mobile", async ({
  page,
}) => {
  let polls = 0;
  await page.route("**/api/preferences/replies", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().postDataJSON()).toEqual({
      generateThreeSuggestions: false,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ generateThreeSuggestions: false }),
    });
  });
  await page.route("**/api/ai/replies*", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).not.toHaveProperty("count");
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ jobId: "job-1", status: "PENDING" }),
      });
    }
    const pollUrl = new URL(route.request().url());
    expect(pollUrl.searchParams.get("jobId")).toBe("job-1");
    expect(pollUrl.searchParams.get("threadId")).toBe(
      "cm0000000000000000000001",
    );
    polls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        polls === 1
          ? { status: "RUNNING" }
          : {
              status: "SUCCEEDED",
              requiredReviewFlags: [],
              options: [
                { id: "option-1", rank: 0, tone: "Balanced", body: "First" },
                { id: "option-2", rank: 1, tone: "Direct", body: "Second" },
                { id: "option-3", rank: 2, tone: "Warm", body: "Third" },
              ],
            },
      ),
    });
  });

  await page.goto("/test/mobile-smoke?three=1");
  await expect(
    page.getByRole("button", { name: "Regenerate three reply options" }),
  ).toBeVisible();
  await page
    .getByLabel("What do you want to communicate?")
    .fill("Confirm receipt");
  await page
    .getByRole("button", { name: "Regenerate three reply options" })
    .click();
  await expect(page.getByLabel("Reply option 3")).toHaveValue("Third", {
    timeout: 5_000,
  });
  await expect(page.getByRole("status")).toContainText(
    "3 editable options are ready",
  );

  const preference = page.getByRole("switch", {
    name: "Generate three suggestions",
  });
  await preference.uncheck();
  await expect(
    page.getByText("Reply suggestion preference saved."),
  ).toBeVisible();
});

test("default mode replaces the existing option with one completed suggestion", async ({
  page,
}) => {
  await page.route("**/api/ai/replies*", (route) =>
    route.fulfill(
      route.request().method() === "POST"
        ? {
            status: 202,
            contentType: "application/json",
            body: JSON.stringify({ jobId: "job-2", status: "PENDING" }),
          }
        : {
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              status: "SUCCEEDED",
              requiredReviewFlags: [],
              options: [
                {
                  id: "single-option",
                  rank: 0,
                  tone: "Professional",
                  body: "The focused suggestion",
                },
              ],
            }),
          },
    ),
  );

  await page.goto("/test/mobile-smoke");
  await page
    .getByLabel("What do you want to communicate?")
    .fill("Confirm receipt");
  await page.getByRole("button", { name: "Regenerate suggestion" }).click();
  await expect(page.getByLabel("Reply option 1")).toHaveValue(
    "The focused suggestion",
    { timeout: 4_000 },
  );
  await expect(page.getByLabel("Reply option 2")).toHaveCount(0);
});

test("terminal failed jobs stop polling and surface their error", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/ai/replies*", (route) => {
    requests += 1;
    return route.fulfill(
      route.request().method() === "POST"
        ? {
            status: 202,
            contentType: "application/json",
            body: JSON.stringify({ jobId: "job-failed", status: "PENDING" }),
          }
        : {
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              status: "FAILED",
              error: "model_unavailable",
            }),
          },
    );
  });

  await page.goto("/test/mobile-smoke");
  await page
    .getByLabel("What do you want to communicate?")
    .fill("Confirm receipt");
  await page.getByRole("button", { name: "Regenerate suggestion" }).click();
  await expect(page.getByRole("status")).toContainText("model_unavailable", {
    timeout: 3_000,
  });
  expect(requests).toBe(2);
});
