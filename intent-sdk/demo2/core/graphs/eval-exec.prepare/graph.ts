export const evalExecPrepareGraphManifest = {
  key: "graph.eval-exec-v3.prepare",
  title: "Prepare eval-exec request",
  entryNodeId: "prepare",
  nodes: [{ nodeId: "prepare", definitionKey: "node.eval-exec-v3.prepare" }],
  edges: [],
  operation: {
    emitsInternalEvents: true,
    splitPlan:
      "Single pure preparation node emits adapter/session operation events; no long-running hidden loop exists.",
  },
};
