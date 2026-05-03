import type { CapabilityPlan } from "../../src/sdk/index.ts";

export type WorkflowNode = {
  data: {
    config: Record<string, unknown>;
    label: string;
    type: "trigger" | "action";
  };
  id: string;
  position: { x: number; y: number };
  type: "trigger" | "action";
};

export type WorkflowEdge = {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  type: "animated";
};

export type WorkflowGraph = {
  edges: WorkflowEdge[];
  nodes: WorkflowNode[];
};

// A workflow artifact is the runnable product-specific output. In a
// KeeperHub-like app, that means graph nodes and edges.
export function createWorkflowGraph({
  plan,
}: {
  plan: CapabilityPlan;
}): WorkflowGraph {
  return {
    edges: plan.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      sourceHandle: edge.branch,
      target: edge.to,
      type: "animated",
    })),
    nodes: plan.items.map((item, index) => {
      const type = item.kind;
      return {
        data: {
          config:
            type === "trigger"
              ? {
                  triggerType: "Schedule",
                  ...item.input,
                }
              : {
                  actionType: item.capabilityId,
                  ...item.input,
                },
          label: item.title,
          type,
        },
        id: item.id,
        position: { x: index * 320, y: 120 },
        type,
      };
    }),
  };
}

// The artifact check is the product's "can this run?" gate. This is where a UI
// would decide whether to enable a Run button.
export function checkWorkflowGraph({ artifact }: { artifact: WorkflowGraph }) {
  const invalid = artifact.nodes.find((node) => {
    if (node.type === "trigger") return !node.data.config.triggerType;
    if (node.type === "action") return !node.data.config.actionType;
    return true;
  });
  if (invalid) {
    return {
      ok: false,
      reason: `Node ${invalid.id} is missing runtime configuration.`,
    };
  }
  const read = artifact.nodes.find(
    (node) => node.data.config.actionType === "price.check"
  );
  if (!read?.data.config.asset) {
    return {
      ok: false,
      reason: "Price check node is missing an asset.",
    };
  }
  const loop = artifact.nodes.find(
    (node) => node.data.config.actionType === "loop.repeat"
  );
  if (loop && !Number.isFinite(Number(loop.data.config.count))) {
    return {
      ok: false,
      reason: "Loop node is missing a numeric repeat count.",
    };
  }
  const notify = artifact.nodes.find(
    (node) => node.data.config.actionType === "webhook.send"
  );
  if (!notify?.data.config.destination) {
    return {
      ok: false,
      reason: "Webhook notification node is missing a destination.",
    };
  }
  return { ok: true };
}
