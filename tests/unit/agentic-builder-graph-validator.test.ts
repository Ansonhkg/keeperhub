import { describe, expect, it } from "vitest";

import { validateGraphShape } from "@/lib/agentic-builder/materialization/graph-validator";
import type { MaterializedWorkflowGraph } from "@/lib/agentic-builder/materialization/contracts";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow/store";

describe("agentic builder graph validator", () => {
  it("reports missing edge endpoints", () => {
    const result = validateGraphShape(
      graph([actionNode("action_1")], [edge("edge_1", "action_1", "missing")])
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      "missing_edge_target"
    );
  });

  it("reports invalid schedule trigger config", () => {
    const result = validateGraphShape(
      graph([
        {
          ...triggerNode("trigger_1"),
          data: {
            label: "Schedule",
            type: "trigger",
            config: { triggerType: "Schedule" },
          },
        },
      ])
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      "invalid_schedule_config"
    );
  });
});

function graph(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[] = []
): MaterializedWorkflowGraph {
  return {
    nodes,
    edges,
    materializedNodeIds: nodes.map((node) => node.id),
    materializedEdgeIds: edges.map((edgeItem) => edgeItem.id),
    requirementCoverage: { req_1: nodes.map((node) => node.id) },
    customProposalCoverage: {},
  };
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

function actionNode(id: string): WorkflowNode {
  return {
    id,
    type: "action",
    position: { x: 0, y: 0 },
    data: {
      label: "Action",
      type: "action",
      config: { actionType: "HTTP Request" },
    },
  };
}

function edge(id: string, source: string, target: string): WorkflowEdge {
  return { id, source, target };
}

