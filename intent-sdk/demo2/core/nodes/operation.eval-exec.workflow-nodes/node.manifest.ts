import { EVAL_EXEC_V3_RUNTIME_BACKEND_KEY } from "../../app-types.ts";

function workflowNode(
  key: string,
  title: string,
  kind: string,
  effects: string[] = []
) {
  return {
    key: `node.eval-exec-v3.${key}`,
    title,
    runtimeBackendKey: EVAL_EXEC_V3_RUNTIME_BACKEND_KEY,
    semantics: { family: "capability", kind },
    effects,
    inputPorts: [
      {
        key: "input",
        schemaId: "schema.eval-exec-v3.operation-step",
        required: true,
      },
    ],
    outputPorts: [
      {
        key: "result",
        schemaId: "schema.eval-exec-v3.operation-step",
        required: true,
      },
    ],
  };
}

export const prepareRequestNodeManifest = workflowNode(
  "prepare-request",
  "Prepare request",
  "eval-exec.prepare-request"
);
export const executorNodeManifest = workflowNode(
  "executor",
  "Executor",
  "eval-exec.executor",
  ["worker.execute", "state.write"]
);
export const evaluatorNodeManifest = workflowNode(
  "evaluator",
  "Evaluator",
  "eval-exec.evaluator",
  ["worker.evaluate", "state.write"]
);
export const decisionNodeManifest = workflowNode(
  "decision",
  "Decision",
  "eval-exec.decision",
  ["state.write"]
);
export const fixerNodeManifest = workflowNode(
  "fixer",
  "Fixer",
  "eval-exec.fixer",
  ["worker.fix", "state.write"]
);
export const resultNodeManifest = workflowNode(
  "result",
  "Result",
  "eval-exec.result",
  ["state.write"]
);

export const runOperationNodeManifests = [
  prepareRequestNodeManifest,
  executorNodeManifest,
  evaluatorNodeManifest,
  decisionNodeManifest,
  fixerNodeManifest,
  resultNodeManifest,
];
