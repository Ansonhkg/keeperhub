import { describe, expect, it } from "vitest";

import { repairMaterializedGraph } from "@/lib/agentic-builder/materialization/repair";
import type { WorkflowNode } from "@/lib/workflow/store";

describe("agentic builder repair", () => {
  it("repairs duplicate materialized IDs without inventing config", () => {
    const result = repairMaterializedGraph({
      nodes: [node("action_1"), node("action_1")],
      edges: [],
      materializedNodeIds: ["action_1", "action_1"],
      materializedEdgeIds: [],
      requirementCoverage: { req_1: ["action_1"] },
      customProposalCoverage: {},
    });

    expect(result.repaired).toBe(true);
    expect(result.graph.nodes.map((item) => item.id)).toEqual([
      "action_1",
      "action_1_1",
    ]);
    expect(result.issues.map((issue) => issue.code)).toContain(
      "repaired_duplicate_node_id"
    );
    expect(result.graph.nodes[1]?.data.config).toEqual({
      actionType: "HTTP Request",
    });
  });
});

function node(id: string): WorkflowNode {
  return {
    id,
    type: "action",
    position: { x: 0, y: 0 },
    data: {
      label: id,
      type: "action",
      config: { actionType: "HTTP Request" },
    },
  };
}
