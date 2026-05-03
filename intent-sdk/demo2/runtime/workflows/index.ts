import type {
  PrepareRequest,
  PrepareResponse,
  RunRequestDraft,
  RunResponse,
} from "../../core/schemas.js";
import type {
  RunLoopCheckpointState,
  RunLoopObserver,
} from "../../core/services/run-loop.js";
import { EVAL_EXEC_PREPARE_WORKFLOW_KEY } from "../../core/workflows/eval-exec.prepare/contract.js";
import { EVAL_EXEC_RUN_WORKFLOW_KEY } from "../../core/workflows/eval-exec.run/contract.js";
import {
  executeEvalExecWorkflowGraph,
  executeEvalExecWorkflowRerun,
  type WorkflowRuntimeManifest,
} from "../graphs/runner.js";
import type { EvalExecRuntime } from "../services.js";

export { EVAL_EXEC_PREPARE_WORKFLOW_KEY } from "../../core/workflows/eval-exec.prepare/contract.js";
export { EVAL_EXEC_RUN_WORKFLOW_KEY } from "../../core/workflows/eval-exec.run/contract.js";

const workflowRuntimeManifests: Record<string, WorkflowRuntimeManifest> = {
  [EVAL_EXEC_PREPARE_WORKFLOW_KEY]: {
    key: EVAL_EXEC_PREPARE_WORKFLOW_KEY,
    execution: { graphKey: "graph.eval-exec-v3.prepare" },
  },
  [EVAL_EXEC_RUN_WORKFLOW_KEY]: {
    key: EVAL_EXEC_RUN_WORKFLOW_KEY,
    execution: { graphKey: "graph.eval-exec-v3.run" },
  },
};

export async function executeWorkflowByKey(
  workflowKey: typeof EVAL_EXEC_PREPARE_WORKFLOW_KEY,
  input: PrepareRequest,
  runtime: EvalExecRuntime,
  options?: { onRunEvent?: RunLoopObserver }
): Promise<PrepareResponse>;
export async function executeWorkflowByKey(
  workflowKey: typeof EVAL_EXEC_RUN_WORKFLOW_KEY,
  input: RunRequestDraft,
  runtime: EvalExecRuntime,
  options?: { onRunEvent?: RunLoopObserver }
): Promise<RunResponse>;
export async function executeWorkflowByKey(
  workflowKey: string,
  input: unknown,
  runtime: EvalExecRuntime,
  options?: { onRunEvent?: RunLoopObserver }
): Promise<PrepareResponse | RunResponse>;
export async function executeWorkflowByKey(
  workflowKey: string,
  input: unknown,
  runtime: EvalExecRuntime,
  options: { onRunEvent?: RunLoopObserver } = {}
): Promise<PrepareResponse | RunResponse> {
  const workflow = workflowRuntimeManifests[workflowKey];
  if (!workflow) throw new Error(`Unknown workflow: ${workflowKey}`);
  return executeEvalExecWorkflowGraph(workflow, input, runtime, options);
}

export async function executeWorkflowRerunFromCheckpoint(
  checkpoint: RunLoopCheckpointState,
  promptOverride: string | undefined,
  runtime: EvalExecRuntime,
  options: { onRunEvent?: RunLoopObserver } = {}
) {
  return executeEvalExecWorkflowRerun(
    checkpoint,
    promptOverride,
    runtime,
    options
  );
}
