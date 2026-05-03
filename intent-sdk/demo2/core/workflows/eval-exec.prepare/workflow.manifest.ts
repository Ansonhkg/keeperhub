export const evalExecPrepareWorkflowManifest = {
  key: "eval-exec.prepare",
  title: "Prepare eval-exec request",
  version: "0.1.0",
  inputSchemaId: "schema.eval-exec-v3.prepare-request",
  outputSchemaId: "schema.eval-exec-v3.prepare-response",
  authRequired: true,
  supports: ["http", "cli"],
  execution: {
    kind: "graph",
    graphKey: "graph.eval-exec-v3.prepare",
    resultNodeId: "prepare",
    resultPortKey: "prepared",
  },
};
