import { describe, expect, it } from "vitest";

import type { MaterializedWorkflowGraph } from "@/lib/agentic-builder/materialization/contracts";
import { validateGraphAgainstIntent } from "@/lib/agentic-builder/materialization/intent-validator";
import type {
  BuilderPreviewBranch,
  BuilderProjection,
} from "@/lib/agentic-builder/projection/contracts";

describe("agentic builder intent validator", () => {
  it("blocks custom fallback when a native capability match exists", () => {
    const selectedBranch = branch({
      customProposalIds: ["custom_1"],
      requirementIds: ["req_1"],
    });
    const result = validateGraphAgainstIntent({
      projection: projection({ branches: [selectedBranch] }),
      selectedBranch,
      graph: materializedGraph({
        requirementCoverage: { req_1: ["node_1"] },
        customProposalCoverage: { custom_1: ["node_1"] },
      }),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      "custom_selected_despite_native_match"
    );
  });

  it("requires all non-option-group tasks in an and-style branch", () => {
    const selectedBranch = branch({ requirementIds: ["req_slack"] });
    const result = validateGraphAgainstIntent({
      projection: projection({
        branches: [selectedBranch],
        taskRequirementIds: ["req_slack", "req_email"],
      }),
      selectedBranch,
      graph: materializedGraph({
        requirementCoverage: { req_slack: ["node_1"] },
      }),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      "required_task_missing_from_branch"
    );
  });
});

function materializedGraph(input: {
  requirementCoverage: Record<string, string[]>;
  customProposalCoverage?: Record<string, string[]>;
}): MaterializedWorkflowGraph {
  return {
    nodes: [],
    edges: [],
    materializedNodeIds: [],
    materializedEdgeIds: [],
    requirementCoverage: input.requirementCoverage,
    customProposalCoverage: input.customProposalCoverage ?? {},
  };
}

function branch(input: {
  customProposalIds?: string[];
  requirementIds: string[];
}): BuilderPreviewBranch {
  return {
    id: "branch_1",
    optionId: "option_1",
    title: "Custom branch",
    risk: "low",
    requirementIds: input.requirementIds,
    customProposalIds: input.customProposalIds,
    previewNodes: [],
    previewEdges: [],
  };
}

function projection(input: {
  branches: BuilderPreviewBranch[];
  taskRequirementIds?: string[];
}): BuilderProjection {
  const requirementIds = Array.from(
    new Set([
      ...input.branches.flatMap((item) => item.requirementIds),
      ...(input.taskRequirementIds ?? []),
    ])
  );

  return {
    id: "projection_1",
    sourcePrompt: "Notify me",
    status: "ready",
    baseGraph: { nodeIds: [], edgeIds: [], capturedAt: "2026-05-01T00:00:00.000Z" },
    intent: {
      schemaVersion: "agentic-builder.intent.v1",
      prompt: "Notify me",
      clauses: [],
      unresolved: [],
      assumptions: [],
    },
    evaluation: {
      requirements: requirementIds.map((requirementId) => ({
        id: requirementId,
        kind: "notification",
        status: "satisfied",
        summary: requirementId,
        blocksMaterialization: false,
        sourceClauseId: "clause_1",
      })),
      unresolved: [],
      tasks: (input.taskRequirementIds ?? []).map((requirementId) => ({
        id: `task_${requirementId}`,
        clauseId: "clause_1",
        requirementId,
        kind: "notification",
        summary: requirementId,
        preservesOrder: false,
        requiresAllTasks: true,
      })),
      optionGroups: [],
      capabilityMatches: [
        {
          requirementId: "req_1",
          capabilityId: "slack/send-message",
          label: "Send Slack Message",
          source: "native",
          score: 1,
        },
      ],
      customNodeProposals: [
        {
          id: "custom_1",
          requirementId: "req_1",
          kind: "custom_node",
          title: "Custom Node",
          summary: "Run custom code for this unsupported capability.",
          requestNativeFeatureAction: true,
          genericHttpRequiresExplicitSelection: true,
        },
      ],
    },
    branches: input.branches,
    questions: [],
    validationIssues: [],
    rejectedOptionIds: [],
  };
}

