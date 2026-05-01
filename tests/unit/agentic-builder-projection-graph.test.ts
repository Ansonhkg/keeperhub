import { describe, expect, it } from "vitest";

import type {
  BuilderPreviewBranch,
  BuilderPreviewEdge,
  BuilderPreviewNode,
  BuilderProjection,
  WorkflowGraph,
} from "@/lib/agentic-builder/projection/contracts";
import {
  isBuilderPreviewEdge,
  isBuilderPreviewNode,
  projectWorkflowGraph,
  stripBuilderPreviewGraph,
} from "@/lib/agentic-builder/projection/graph";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow/store";

describe("agentic builder projection graph", () => {
  it("projects real graph plus preview branches for rendering", () => {
    const realGraph = graph([node("trigger_1", "trigger")], []);
    const projection = projectionWithBranch(
      branch({
        previewNodes: [previewNode("preview_action_1")],
        previewEdges: [previewEdge("preview_edge_1", "trigger_1", "preview_action_1")],
      })
    );

    const rendered = projectWorkflowGraph(realGraph, projection);

    expect(rendered.nodes.map((item) => item.id)).toEqual([
      "trigger_1",
      "preview_action_1",
    ]);
    expect(rendered.edges.map((item) => item.id)).toEqual(["preview_edge_1"]);
    expect(isBuilderPreviewNode(rendered.nodes[1])).toBe(true);
    expect(isBuilderPreviewEdge(rendered.edges[0])).toBe(true);
  });

  it("returns the same graph when no projection is active", () => {
    const realGraph = graph([node("trigger_1", "trigger")], []);

    expect(projectWorkflowGraph(realGraph, null)).toBe(realGraph);
  });

  it("strips preview nodes, preview edges, and leaked edges to preview nodes", () => {
    const rendered = graph(
      [node("trigger_1", "trigger"), previewNode("preview_action_1")],
      [
        edge("real_edge_1", "trigger_1", "action_1"),
        previewEdge("preview_edge_1", "trigger_1", "preview_action_1"),
        edge("leaked_edge_1", "trigger_1", "preview_action_1"),
      ]
    );

    const stripped = stripBuilderPreviewGraph(rendered);

    expect(stripped.nodes.map((item) => item.id)).toEqual(["trigger_1"]);
    expect(stripped.edges.map((item) => item.id)).toEqual(["real_edge_1"]);
  });
});

function graph(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowGraph {
  return { nodes, edges };
}

function node(id: string, type: "trigger" | "action"): WorkflowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      label: id,
      type,
    },
  };
}

function edge(id: string, source: string, target: string): WorkflowEdge {
  return {
    id,
    source,
    target,
  };
}

function previewNode(id: string): BuilderPreviewNode {
  return {
    ...node(id, "action"),
    data: {
      label: id,
      type: "action",
      builderPreview: true,
      builderProjectionId: "projection_1",
      builderBranchId: "branch_1",
      builderOptionId: "option_1",
      builderRequirementIds: ["req_1"],
    },
  };
}

function previewEdge(
  id: string,
  source: string,
  target: string
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
      builderRequirementIds: ["req_1"],
    },
  };
}

function branch(input: {
  previewNodes: BuilderPreviewNode[];
  previewEdges: BuilderPreviewEdge[];
}): BuilderPreviewBranch {
  return {
    id: "branch_1",
    optionId: "option_1",
    title: "Suggested branch",
    risk: "low",
    requirementIds: ["req_1"],
    previewNodes: input.previewNodes,
    previewEdges: input.previewEdges,
  };
}

function projectionWithBranch(branch: BuilderPreviewBranch): BuilderProjection {
  return {
    id: "projection_1",
    workflowId: "workflow_1",
    sourcePrompt: "Track ETH",
    status: "ready",
    baseGraph: {
      nodeIds: ["trigger_1"],
      edgeIds: [],
      capturedAt: "2026-05-01T00:00:00.000Z",
    },
    intent: {
      schemaVersion: "agentic-builder.intent.v1",
      prompt: "Track ETH",
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
      customNodeProposals: [],
    },
    branches: [branch],
    questions: [],
    validationIssues: [],
    rejectedOptionIds: [],
  };
}
