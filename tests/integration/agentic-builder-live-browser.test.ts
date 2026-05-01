import { chromium, expect as playwrightExpect } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const baseUrl =
  process.env.KEEPERHUB_LIVE_BROWSER_URL ?? "http://localhost:3002";

async function isLiveAppAvailable(): Promise<boolean> {
  try {
    const response = await fetch(baseUrl);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

const liveAppAvailable = await isLiveAppAvailable();

describe.skipIf(!liveAppAvailable)("agentic builder live browser flow", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
  }, 30_000);

  it("plans from the real prompt, renders previews on the live canvas, and persists only committed nodes", async () => {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      const response = await fetch("/api/auth/sign-in/email", {
        body: JSON.stringify({
          email: "dev@keeperhub.local",
          password: "Test1234!",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }
    });

    const workflow = await page.evaluate(async () => {
      const response = await fetch("/api/workflows/create", {
        body: JSON.stringify({
          description: "",
          edges: [],
          name: `Agentic Builder Browser ${Date.now()}`,
          nodes: [],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`${response.status}: ${await response.text()}`);
      }
      return (await response.json()) as { id: string };
    });

    await page.goto(`${baseUrl}/workflows/${workflow.id}`, {
      waitUntil: "domcontentloaded",
    });
    await playwrightExpect(page.getByTestId("workflow-canvas")).toBeVisible();
    consoleErrors.length = 0;

    const promptInput = page.getByLabel("Describe your workflow");
    await playwrightExpect(promptInput).toBeVisible({ timeout: 15_000 });
    await promptInput.fill("Track ETH price every 15 minutes and notify me");
    const sessionResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/builder/sessions") &&
        response.request().method() === "POST",
      { timeout: 120_000 }
    );
    await page
      .locator('form[aria-label="KeeperHub workflow prompt"]')
      .evaluate((form) => {
        if (!(form instanceof HTMLFormElement)) {
          throw new Error("Prompt form not found");
        }
        form.requestSubmit();
      });
    const sessionProjectionResponse = await sessionResponse;
    expect(sessionProjectionResponse.status()).toBe(200);
    const sessionProjection = (await sessionProjectionResponse.json()) as {
      sessionId: string;
    };

    await playwrightExpect(
      page.getByTestId("builder-decision-tray")
    ).toBeVisible({ timeout: 15_000 });
    await playwrightExpect(page.getByText("Suggested next step")).toBeVisible();
    await playwrightExpect(
      page.locator(".builder-option-lane-node").first()
    ).toBeVisible();
    await playwrightExpect(
      page.getByRole("button", { name: /^Select$/ }).first()
    ).toBeVisible();
    expect(sessionProjection.sessionId).toBeTruthy();

    const optionRows = page.locator('[data-testid^="builder-option-"]');
    const optionRowCount = await optionRows.count();
    expect(optionRowCount).toBeGreaterThan(0);
    const optionIds = await optionRows.evaluateAll((rows) =>
      rows.flatMap((row) => {
        const testId = row.getAttribute("data-testid");
        return testId?.startsWith("builder-option-")
          ? [testId.replace("builder-option-", "")]
          : [];
      })
    );
    expect(optionIds.length).toBeGreaterThan(0);

    let previewOptionId = optionIds[0];
    for (const optionId of optionIds) {
      const isAlreadyHighlighted = await page
        .locator(
          `.builder-option-lane-node-highlighted:has([data-testid="action-node-builder-option-${optionId}"])`
        )
        .count();
      if (isAlreadyHighlighted === 0) {
        previewOptionId = optionId;
        break;
      }
    }

    const previewRow = page.getByTestId(`builder-option-${previewOptionId}`);
    const matchingLane = page.locator(
      `.builder-option-lane-node-highlighted:has([data-testid="action-node-builder-option-${previewOptionId}"])`
    );
    await previewRow.hover();
    await playwrightExpect(matchingLane).toBeVisible();
    await page.mouse.move(0, 0);
    await previewRow.focus();
    await playwrightExpect(previewRow).toBeFocused();
    await playwrightExpect(matchingLane).toBeVisible();

    const [answeredResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/questions/") &&
          response.url().includes("/answer") &&
          response.request().method() === "POST",
        { timeout: 120_000 }
      ),
      page.getByRole("button", { name: "Slack" }).first().click(),
    ]);
    const answeredResponseText = await answeredResponse.text();
    expect(answeredResponse.status(), answeredResponseText).toBe(200);

    const nonSlackOptionRow = page
      .locator('[data-testid^="builder-option-"]')
      .filter({ hasNotText: "Send Slack Message" })
      .first();
    if ((await nonSlackOptionRow.count()) > 0) {
      const rejectResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/reject") &&
          response.request().method() === "POST"
      );
      await nonSlackOptionRow.getByRole("button", { name: /^Reject / }).click();
      expect((await rejectResponse).status()).toBe(200);
      await page.waitForTimeout(500);
    }
    await playwrightExpect(
      page
        .locator('[data-testid^="builder-option-"]')
        .filter({ hasText: "Send Slack Message" })
        .first()
    ).toBeVisible();

    const selectedOptionRow = page
      .locator('[data-testid^="builder-option-"]')
      .filter({ hasText: "Send Slack Message" })
      .first();
    const selectedOptionTestId =
      await selectedOptionRow.getAttribute("data-testid");
    expect(selectedOptionTestId).toBeTruthy();
    const selectResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/select") &&
        response.request().method() === "POST"
    );
    await selectedOptionRow.getByRole("button", { name: /^Select$/ }).click();
    const selectedResponse = await selectResponse;
    const selectedResponseText = await selectedResponse.text();
    expect(selectedResponse.status(), selectedResponseText).toBe(200);
    await playwrightExpect(
      page.getByTestId(selectedOptionTestId ?? "")
    ).toHaveCount(0);

    await playwrightExpect(
      page.locator('[data-testid^="action-node-"]').first()
    ).toBeVisible({ timeout: 15_000 });
    const regenerateResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/regenerate-from-node") &&
        response.request().method() === "POST"
    );
    await page.locator('[data-testid^="action-node-"]').first().click({
      button: "right",
      force: true,
    });
    await page.getByRole("button", { name: "Regenerate downstream" }).click();
    expect((await regenerateResponse).status()).toBe(200);

    const persistedWorkflow = await page.evaluate(async (workflowId) => {
      const response = await fetch(`/api/workflows/${workflowId}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return (await response.json()) as {
        edges: Array<Record<string, unknown>>;
        nodes: Array<{ data?: { config?: Record<string, unknown> } }>;
      };
    }, workflow.id);

    const actionTypes = persistedWorkflow.nodes.map(
      (node) => node.data?.config?.actionType
    );
    expect(persistedWorkflow.nodes.length).toBeGreaterThan(1);
    expect(persistedWorkflow.edges.length).toBeGreaterThan(0);
    expect(actionTypes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^(Send Slack Message|slack\/send-message)$/),
      ])
    );
    expect(
      persistedWorkflow.nodes.some(
        (node) => node.data?.config?.builderPreview === true
      )
    ).toBe(false);
    expect(
      persistedWorkflow.edges.some(
        (edge) =>
          (edge.data as Record<string, unknown> | undefined)?.builderPreview ===
          true
      )
    ).toBe(false);
    expect(consoleErrors).toEqual([]);

    await page.close();
  }, 150_000);
});
