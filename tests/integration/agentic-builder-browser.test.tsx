import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, it } from "vitest";
import { DecisionTray } from "@/components/agentic-builder/decision-tray";
import { projectBuilderToCanvas } from "@/lib/agentic-builder/canvas-projection";

const projection: BuilderProjection = {
  candidateBranches: [
    {
      baseCommitId: "commit-1",
      branchId: "branch-1",
      dashedEdges: [{ fromStepId: "step-2", toStepId: "future-1" }],
      greyNodes: [
        {
          dependsOn: ["step-1"],
          id: "future-1",
          kind: "notify",
          label: "Future notification",
          requiredEntityIds: [],
          status: "planned",
        },
      ],
      optionId: "option-1",
      status: "open",
    },
    {
      baseCommitId: "commit-1",
      branchId: "branch-2",
      dashedEdges: [{ fromStepId: "step-2", toStepId: "future-2" }],
      greyNodes: [
        {
          dependsOn: ["step-2"],
          id: "future-2",
          kind: "notify",
          label: "Future email notification",
          requiredEntityIds: [],
          status: "planned",
        },
      ],
      optionId: "option-2",
      status: "open",
    },
  ],
  committed: {
    edges: [],
    id: "session-1",
    nodes: [
      {
        dependsOn: [],
        id: "step-1",
        kind: "trigger",
        label: "Run every 15 minutes",
        requiredEntityIds: [],
        status: "ready",
      },
      {
        dependsOn: ["step-1"],
        id: "step-2",
        kind: "read",
        label: "Read ETH price",
        requiredEntityIds: [],
        status: "ready",
      },
    ],
  },
  headCommitId: "commit-1",
  options: [
    {
      candidateIds: ["native-price"],
      confidence: 0.9,
      id: "option-1",
      patch: {
        id: "patch-1",
        ops: [
          {
            changes: {
              label: "Use native price feed",
              status: "ready",
            },
            op: "update_step",
            stepId: "step-2",
          },
        ],
        summary: "Use native price",
      },
      rationale: "Most reliable route",
      requiredInputs: [],
      risk: "low",
      stepId: "step-2",
      strategy: "native_action",
      title: "Use native price feed",
    },
    {
      candidateIds: ["email-notify"],
      confidence: 0.6,
      id: "option-2",
      patch: {
        id: "patch-2",
        ops: [
          {
            changes: {
              label: "Use email notification",
              status: "ready",
            },
            op: "update_step",
            stepId: "step-2",
          },
        ],
        summary: "Use email notification",
      },
      rationale: "Fallback route",
      requiredInputs: [],
      risk: "low",
      stepId: "step-2",
      strategy: "native_action",
      title: "Use email notification",
    },
  ],
  questions: [],
  sessionId: "session-1",
  timeline: [],
  validation: { issues: [], valid: true },
};

describe("agentic builder browser behavior", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("shows canvas-native future branches and exposes tray controls in a real browser", async () => {
    const page = await browser.newPage();
    const canvasProjection = projectBuilderToCanvas(projection);
    const graph = `
        <section data-testid="mock-canvas">
          ${canvasProjection.nodes
            .map(
              (node) =>
                `<div data-highlighted="${node.data.config?.builderHighlighted === true}" data-lane="${node.data.config?.builderOptionLane === true}" data-option-id="${node.data.config?.builderPreviewOptionId ?? ""}" data-option-index="${node.data.config?.builderOptionIndex ?? ""}" data-preview="${node.data.config?.builderPreview === true}">${node.data.label}</div>`
            )
            .join("")}
          ${canvasProjection.edges
            .map(
              (edge) =>
                `<div data-edge-highlighted="${edge.data?.builderHighlighted === true}" data-edge-target="${edge.target}" data-edge-type="${edge.type}">${edge.source} to ${edge.target}</div>`
            )
            .join("")}
        </section>`;
    const tray = renderToStaticMarkup(
      <DecisionTray
        isPlanning={false}
        onAnswerQuestion={() => undefined}
        onPreviewFocus={() => undefined}
        onPreviewPin={() => undefined}
        onReject={() => undefined}
        onRequestNativeCapability={() => undefined}
        onSelect={() => undefined}
        projection={projection}
      />
    );
    await page.setContent(`<main>${graph}${tray}</main>`);

    await playwrightExpect(
      page.getByText("Run every 15 minutes")
    ).toBeVisible();
    await playwrightExpect(page.getByText("Future notification")).toBeVisible();
    await playwrightExpect(
      page.locator('[data-preview="true"]').first()
    ).toBeVisible();
    await playwrightExpect(
      page.locator('[data-lane="true"]').first()
    ).toBeVisible();
    await playwrightExpect(
      page.locator('[data-highlighted="true"][data-option-index="1"]')
    ).toBeVisible();
    await playwrightExpect(
      page.locator('[data-highlighted="true"][data-option-index="2"]')
    ).toHaveCount(0);
    await playwrightExpect(
      page.locator('[data-edge-type="temporary"]').first()
    ).toBeVisible();
    await playwrightExpect(
      page.getByTestId("builder-decision-tray")
    ).toBeVisible();
    await playwrightExpect(
      page.getByRole("button", { name: "Select" }).first()
    ).toBeVisible();
    await playwrightExpect(
      page.getByRole("button", { name: "Reject Use native price feed" })
    ).toBeVisible();
    await page.close();
  });
});
