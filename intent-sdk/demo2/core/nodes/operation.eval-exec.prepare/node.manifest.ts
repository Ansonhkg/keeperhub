import { EVAL_EXEC_V3_RUNTIME_BACKEND_KEY } from "../../app-types.ts";

export const prepareNodeManifest = {
  key: "node.eval-exec-v3.prepare",
  title: "Prepare request",
  runtimeBackendKey: EVAL_EXEC_V3_RUNTIME_BACKEND_KEY,
  semantics: {
    family: "capability",
    kind: "eval-exec.prepare",
  },
  effects: [],
  inputPorts: [
    {
      key: "request",
      schemaId: "schema.eval-exec-v3.prepare-request",
      required: true,
    },
  ],
  outputPorts: [
    {
      key: "prepared",
      schemaId: "schema.eval-exec-v3.prepare-response",
      required: true,
    },
  ],
};
