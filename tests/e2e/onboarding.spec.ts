import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test.describe("connect page", () => {
  test("explains the requested scopes and links to the OAuth start route", async ({
    page,
  }) => {
    await page.goto("/test/connect-smoke");
    await expect(
      page.getByRole("heading", { name: "Connect Gmail" }),
    ).toBeVisible();
    await expect(page.getByText("gmail.readonly")).toBeVisible();
    await expect(page.getByText("gmail.compose")).toBeVisible();
    const link = page.getByRole("link", { name: "Connect Gmail" });
    await expect(link).toHaveAttribute("href", "/api/gmail/connect");
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
  });

  for (const [code, expected] of [
    [
      "state",
      "Your connection request expired or could not be verified. Please try again.",
    ],
    [
      "consent",
      "Google consent did not include both Gmail permissions and offline access. Please try again and approve all requested permissions.",
    ],
    [
      "identity",
      "Google did not return a verifiable account identity. Please try again.",
    ],
    [
      "unknown",
      "Something went wrong connecting your mailbox. Please try again.",
    ],
    [
      "bogus-code",
      "Something went wrong connecting your mailbox. Please try again.",
    ],
  ] as const) {
    test(`renders the ${code} callback error as an alert`, async ({ page }) => {
      await page.goto(`/test/connect-smoke?error=${code}`);
      await expect(page.locator("main").getByRole("alert")).toHaveText(
        expected,
      );
    });
  }
});

test.describe("mailbox card", () => {
  test("prompts to connect when no mailbox exists", async ({ page }) => {
    await page.goto("/test/mailbox-card?variant=none");
    await expect(
      page.getByText("No Gmail mailbox is connected yet."),
    ).toBeVisible();
    const link = page.getByRole("link", { name: "Connect Gmail" });
    await expect(link).toHaveAttribute("href", "/api/gmail/connect");
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? ""),
      ),
    ).toEqual([]);
  });

  test("syncing to completion disables the button while in flight and reports success", async ({
    page,
  }) => {
    let statusCalls = 0;
    await page.route("**/api/gmail/sync*", async (route) => {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toEqual({
          connectionId: "cm0000000000000000000010",
          full: false,
        });
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ jobId: "job-ok", status: "PENDING" }),
        });
      }
      statusCalls += 1;
      const url = new URL(route.request().url());
      expect(url.searchParams.get("connectionId")).toBe(
        "cm0000000000000000000010",
      );
      if (statusCalls === 1) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            sync: { status: "RUNNING", updatedAt: "2026-07-02T00:00:00.000Z" },
            jobs: [{ id: "job-ok", status: "RUNNING" }],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sync: {
            status: "SUCCEEDED",
            lastCompletedAt: "2026-07-02T00:01:00.000Z",
            updatedAt: "2026-07-02T00:01:00.000Z",
          },
          jobs: [{ id: "job-ok", status: "SUCCEEDED" }],
        }),
      });
    });

    await page.goto("/test/mailbox-card?variant=connected");
    const syncButton = page.getByRole("button", { name: "Sync mailbox now" });
    await syncButton.click();
    await expect(syncButton).toBeDisabled();
    await expect(page.getByText("Mailbox refresh finished.")).toBeVisible({
      timeout: 5_000,
    });
    await expect(syncButton).toBeEnabled();
    await expect(page.getByText(/Last refresh: succeeded/)).toBeVisible();
  });

  test("a terminal failure surfaces an alert and re-enables the button", async ({
    page,
  }) => {
    await page.route("**/api/gmail/sync*", async (route) => {
      if (route.request().method() === "POST")
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ jobId: "job-bad", status: "PENDING" }),
        });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sync: null,
          jobs: [{ id: "job-bad", status: "FAILED" }],
        }),
      });
    });

    await page.goto("/test/mailbox-card?variant=connected");
    const syncButton = page.getByRole("button", { name: "Sync mailbox now" });
    await syncButton.click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Mailbox refresh failed.",
      { timeout: 5_000 },
    );
    await expect(syncButton).toBeEnabled();
  });

  test("disconnect posts the connection id to the disconnect endpoint", async ({
    page,
  }) => {
    let disconnectBody: unknown;
    await page.route("**/api/gmail/disconnect", async (route) => {
      disconnectBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "REVOKED" }),
      });
    });

    await page.goto("/test/mailbox-card?variant=connected");
    await page.getByRole("button", { name: "Disconnect mailbox" }).click();
    await expect
      .poll(() => disconnectBody)
      .toEqual({ connectionId: "cm0000000000000000000010" });
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  });
});
