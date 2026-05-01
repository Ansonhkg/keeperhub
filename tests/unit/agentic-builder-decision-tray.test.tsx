// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DecisionTray } from "@/components/agentic-builder/decision-tray";
import type { BuilderProjection } from "@/lib/agentic-builder/projection/contracts";

describe("agentic builder decision tray", () => {
  it("does not render when idle without projection", () => {
    const html = renderToStaticMarkup(<DecisionTray projection={null} />);

    expect(html).toBe("");
  });

  it("renders planning state without a projection", () => {
    const html = renderToStaticMarkup(
      <DecisionTray isPlanning projection={null} />
    );

    expect(html).toContain("Builder decisions");
    expect(html).toContain("Planning");
  });

  it("renders options, questions, custom proposals, and issues", () => {
    const html = renderToStaticMarkup(
      <DecisionTray
        onAnswerQuestion={vi.fn()}
        onRejectOption={vi.fn()}
        onSelectOption={vi.fn()}
        projection={projection()}
      />
    );

    expect(html).toContain("Use Slack");
    expect(html).toContain("Recommended");
    expect(html).toContain("low risk");
    expect(html).toContain("What movement should trigger this workflow?");
    expect(html).toContain("Custom Node");
    expect(html).toContain("Request native feature");
    expect(html).toContain("Missing threshold");
  });

  it("emits highlight callbacks from option hover and focus", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onHighlightBranch = vi.fn();
    const onClearHighlight = vi.fn();

    await act(async () => {
      root.render(
        <DecisionTray
          onClearHighlight={onClearHighlight}
          onHighlightBranch={onHighlightBranch}
          projection={projection()}
        />
      );
    });

    const option = container.querySelector('[data-testid="builder-option-option_1"]');
    expect(option).not.toBeNull();

    await act(async () => {
      option?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      option?.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      option?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });

    expect(onHighlightBranch).toHaveBeenCalledWith({
      branchId: "branch_1",
      optionId: "option_1",
    });
    expect(onClearHighlight).toHaveBeenCalled();

    root.unmount();
  });
});

function projection(): BuilderProjection {
  return {
    id: "projection_1",
    workflowId: "workflow_1",
    sourcePrompt: "Slack me when ETH moves",
    status: "needs_input",
    baseGraph: {
      nodeIds: ["trigger_1"],
      edgeIds: [],
      capturedAt: "2026-05-01T00:00:00.000Z",
    },
    intent: {
      schemaVersion: "agentic-builder.intent.v1",
      prompt: "Slack me when ETH moves",
      clauses: [],
      unresolved: [],
      assumptions: [],
    },
    evaluation: {
      requirements: [],
      unresolved: [],
      tasks: [],
      optionGroups: [],
      capabilityMatches: [],
      customNodeProposals: [
        {
          id: "custom_1",
          requirementId: "req_custom",
          kind: "custom_node",
          title: "Custom Node",
          summary: "Build unsupported capability",
          requestNativeFeatureAction: true,
          genericHttpRequiresExplicitSelection: true,
        },
      ],
    },
    branches: [
      {
        id: "branch_1",
        optionId: "option_1",
        title: "Use Slack",
        rationale: "Slack satisfies the requested notification channel.",
        risk: "low",
        requirementIds: ["req_slack"],
        previewNodes: [],
        previewEdges: [],
      },
    ],
    questions: [
      {
        id: "question_1",
        requirementId: "req_threshold",
        question: "What movement should trigger this workflow?",
        blocksMaterialization: true,
      },
    ],
    validationIssues: [
      {
        id: "issue_1",
        severity: "warning",
        message: "Missing threshold",
        requirementIds: ["req_threshold"],
      },
    ],
    rejectedOptionIds: [],
  };
}
