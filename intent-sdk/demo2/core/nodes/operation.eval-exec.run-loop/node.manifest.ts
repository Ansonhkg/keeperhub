import { EVAL_EXEC_V3_RUNTIME_BACKEND_KEY } from "../../app-types.ts";

export const runLoopNodeManifest = {
  key: "node.eval-exec-v3.run-loop",
  title: "Run loop",
  runtimeBackendKey: EVAL_EXEC_V3_RUNTIME_BACKEND_KEY,
  semantics: {
    family: "capability",
    kind: "eval-exec.run-loop.transitional",
  },
  effects: ["worker.execute", "worker.evaluate", "worker.fix", "state.write"],
  inputPorts: [
    {
      key: "request",
      schemaId: "schema.eval-exec-v3.run-request",
      required: true,
    },
  ],
  outputPorts: [
    {
      key: "result",
      schemaId: "schema.eval-exec-v3.run-response",
      required: true,
    },
  ],
};
