import { describe, expect, it } from "vitest";

import type {
  BuilderPreviewBranch,
  BuilderPreviewEdge,
  BuilderPreviewNode,
  BuilderProjection,
  WorkflowGraph,
} from "@/lib/agentic-builder/projection/contracts";
import { materializeBuilderProjection } from "@/lib/agentic-builder/materialization/materializer";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow/store";

describe("agentic builder materializer", () => {
  it("strips preview metadata and appends real nodes and edges", () => {
    const result = materializeBuilderProjection({
      projection: projection({
        branches: [
          branch({
            requirementIds: ["req_slack"],
            previewNodes: [previewNode("preview_slack", ["req_slack"])],
            previewEdges: [previewEdge("preview_edge", "trigger_1", "preview_slack", ["req_slack"])],
          }),
        ],
      }),
      realGraph: graph([triggerNode("trigger_1")], []),
      optionId: "option_1",
    });

    expect(result.validation.valid).toBe(true);
    expect(result.graph.nodes.map((node) => node.id)).toEqual([
      "trigger_1",
      "preview_slack",
    ]);
    expect(result.graph.edges.map((edge) => edge.id)).toEqual(["preview_edge"]);
    expect(result.graph.edges[0]).toMatchObject({
      source: "trigger_1",
      target: "preview_slack",
    });
    expect(result.graph.nodes[1]?.data).not.toHaveProperty("builderPreview");
    expect(result.graph.edges[0]?.data).toBeUndefined();
  });

  it("generates collision-safe IDs for materialized graph items", () => {
    const result = materializeBuilderProjection({
      projection: projection({
        branches: [
          branch({
            requirementIds: ["req_slack"],
            previewNodes: [previewNode("action_1", ["req_slack"])],
            previewEdges: [previewEdge("edge_1", "trigger_1", "action_1", ["req_slack"])],
          }),
        ],
      }),
      realGraph: graph(
        [triggerNode("trigger_1"), actionNode("action_1", "Existing")],
        [edge("edge_1", "trigger_1", "action_1")]
      ),
      optionId: "option_1",
    });

    expect(result.validation.valid).toBe(true);
    expect(result.graph.materializedNodeIds).toEqual(["action_1_1"]);
    expect(result.graph.materializedEdgeIds).toEqual(["edge_1_1"]);
    expect(result.graph.edges.at(-1)).toMatchObject({
      id: "edge_1_1",
      source: "trigger_1",
      target: "action_1_1",
    });
  });

  it("blocks commit when a required question is unanswered", () => {
    const result = materializeBuilderProjection({
      projection: projection({
        questions: [
          {
            id: "question_1",
            requirementId: "req_condition",
            question: "What movement threshold should trigger this?",
            blocksMaterialization: true,
          },
        ],
        branches: [
          branch({
            requirementIds: ["req_condition"],
            previewNodes: [previewNode("condition_1", ["req_condition"])],
            previewEdges: [],
          }),
        ],
      }),
      realGraph: graph([], []),
      optionId: "option_1",
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.issues.map((issue) => issue.code)).toContain(
      "blocking_question_unanswered"
    );
  });

  it("fails if an or branch materializes an unselected requirement", () => {
    const result = materializeBuilderProjection({
      projection: projection({
        branches: [
          branch({
            requirementIds: ["req_slack"],
            previewNodes: [
              previewNode("slack_1", ["req_slack"]),
              previewNode("email_1", ["req_email"]),
            ],
            previewEdges: [],
          }),
          branch({
            id: "branch_2",
            optionId: "option_2",
            requirementIds: ["req_email"],
            previewNodes: [previewNode("email_1", ["req_email"], "branch_2", "option_2")],
            previewEdges: [],
          }),
        ],
      }),
      realGraph: graph([], []),
      optionId: "option_1",
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.issues.map((issue) => issue.code)).toContain(
      "unselected_requirement_materialized"
    );
  });

  it("materializes only the selected branch for Slack or Email", () => {
    const result = materializeBuilderProjection({
      projection: projection({
        branches: [
          branch({
            requirementIds: ["req_slack"],
            previewNodes: [previewNode("slack_1", ["req_slack"])],
            previewEdges: [],
          }),
          branch({
            id: "branch_2",
            optionId: "option_2",
            requirementIds: ["req_email"],
            previewNodes: [previewNode("email_1", ["req_email"], "branch_2", "option_2")],
            previewEdges: [],
          }),
        ],
      }),
      realGraph: graph([], []),
      optionId: "option_1",
    });

    expect(result.validation.valid).toBe(true);
    expect(result.graph.materializedNodeIds).toEqual(["slack_1"]);
    expect(result.graph.requirementCoverage).toEqual({ req_slack: ["slack_1"] });
  });

  it("materializes both notification requirements for Slack and Email", () => {
    const result = materializeBuilderProjection({
      projection: projection({
        branches: [
          branch({
            optionGroupId: undefined,
            requirementIds: ["req_slack", "req_email"],
            previewNodes: [
              previewNode("slack_1", ["req_slack"]),
              previewNode("email_1", ["req_email"]),
            ],
            previewEdges: [previewEdge("edge_1", "slack_1", "email_1", ["req_email"])],
          }),
        ],
        requiresAllTasks: true,
      }),
      realGraph: graph([], []),
      optionId: "option_1",
    });

    expect(result.validation.valid).toBe(true);
    expect(result.graph.materializedNodeIds).toEqual(["slack_1", "email_1"]);
    expect(Object.keys(result.graph.requirementCoverage).sort()).toEqual([
      "req_email",
      "req_slack",
    ]);
  });
});

function graph(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowGraph {
  return { nodes, edges };
}

function triggerNode(id: string): WorkflowNode {
  return {
    id,
    type: "trigger",
    position: { x: 0, y: 0 },
    data: {
      label: "Manual trigger",
      type: "trigger",
      config: { triggerType: "Manual" },
    },
  };
}

function actionNode(id: string, label = "Send Slack Message"): WorkflowNode {
  return {
    id,
    type: "action",
    position: { x: 300, y: 0 },
    data: {
      label,
      type: "action",
      config: { actionType: "HTTP Request" },
    },
  };
}

function previewNode(
  id: string,
  requirementIds: string[],
  branchId = "branch_1",
  optionId = "option_1"
): BuilderPreviewNode {
  return {
    ...actionNode(id),
    data: {
      label: id,
      type: "action",
      config: { actionType: "HTTP Request" },
      builderPreview: true,
      builderProjectionId: "projection_1",
      builderBranchId: branchId,
      builderOptionId: optionId,
      builderRequirementIds: requirementIds,
    },
  };
}

function edge(id: string, source: string, target: string): WorkflowEdge {
  return { id, source, target };
}

function previewEdge(
  id: string,
  source: string,
  target: string,
  requirementIds: string[]
): BuilderPreviewEdge {
  return {
    id,
    source,
    target,
    data: {
      builderPreview: true,
      builderProjectionId: "projection_1",
      builderBranchId: "branch_1",
      builderOptionId: "option_1",
      builderRequirementIds: requirementIds,
    },
  };
}

function branch(input: {
  id?: string;
  optionGroupId?: string;
  optionId?: string;
  requirementIds: string[];
  previewNodes: BuilderPreviewNode[];
  previewEdges: BuilderPreviewEdge[];
}): BuilderPreviewBranch {
  return {
    id: input.id ?? "branch_1",
    optionId: input.optionId ?? "option_1",
    optionGroupId: "optionGroupId" in input ? input.optionGroupId : "option_group_1",
    title: "Suggested branch",
    risk: "low",
    requirementIds: input.requirementIds,
    previewNodes: input.previewNodes,
    previewEdges: input.previewEdges,
  };
}

function projection(input: {
  branches: BuilderPreviewBranch[];
  questions?: BuilderProjection["questions"];
  requiresAllTasks?: boolean;
}): BuilderProjection {
  const requirementIds = Array.from(
    new Set(input.branches.flatMap((item) => item.requirementIds))
  );

  return {
    id: "projection_1",
    workflowId: "workflow_1",
    sourcePrompt: "Notify me",
    status: "ready",
    baseGraph: {
      nodeIds: [],
      edgeIds: [],
      capturedAt: "2026-05-01T00:00:00.000Z",
    },
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
      tasks: requirementIds.map((requirementId) => ({
        id: `task_${requirementId}`,
        clauseId: "clause_1",
        requirementId,
        kind: "notification",
        summary: requirementId,
        optionGroupId: input.requiresAllTasks ? undefined : "option_group_1",
        preservesOrder: false,
        requiresAllTasks: input.requiresAllTasks ?? false,
      })),
      optionGroups: input.requiresAllTasks
        ? []
        : [
            {
              id: "option_group_1",
              clauseId: "clause_1",
              taskIds: requirementIds.map((requirementId) => `task_${requirementId}`),
            },
          ],
      capabilityMatches: [],
      customNodeProposals: [],
    },
    branches: input.branches,
    questions: input.questions ?? [],
    validationIssues: [],
    rejectedOptionIds: [],
  };
}
