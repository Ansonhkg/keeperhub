export const evalExecRunWorkflowManifest = {
  key: "eval-exec.run",
  title: "Run eval-exec loop",
  version: "0.1.0",
  inputSchemaId: "schema.eval-exec-v3.run-request",
  outputSchemaId: "schema.eval-exec-v3.run-response",
  authRequired: true,
  supports: ["http", "cli"],
  execution: {
    kind: "graph",
    graphKey: "graph.eval-exec-v3.run",
    resultNodeId: "result",
    resultPortKey: "result",
  },
};
