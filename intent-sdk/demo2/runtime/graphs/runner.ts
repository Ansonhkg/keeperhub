import {
  PrepareRequestSchema,
  RunRequestDraftSchema,
} from "../../core/schemas.js";
import { prepareEvalExecRequest } from "../../core/services/prepare-request.js";
import {
  type RunLoopCheckpointState,
  type RunLoopObserver,
  runEvalExecFromCheckpoint,
  runEvalExecLoop,
} from "../../core/services/run-loop.js";
import { EVAL_EXEC_PREPARE_WORKFLOW_KEY } from "../../core/workflows/eval-exec.prepare/contract.js";
import { EVAL_EXEC_RUN_WORKFLOW_KEY } from "../../core/workflows/eval-exec.run/contract.js";
import type { EvalExecRuntime } from "../services.js";

export type WorkflowRuntimeManifest = {
  key: string;
  execution: { graphKey: string };
};

export async function executeEvalExecWorkflowGraph(
  workflow: WorkflowRuntimeManifest,
  input: unknown,
  runtime: EvalExecRuntime,
  options: { onRunEvent?: RunLoopObserver } = {}
) {
  if (workflow.key === EVAL_EXEC_PREPARE_WORKFLOW_KEY) {
    return prepareEvalExecRequest(
      PrepareRequestSchema.parse(input),
      runtime.worker,
      runtime.config
    );
  }

  if (workflow.key === EVAL_EXEC_RUN_WORKFLOW_KEY) {
    const draft =
      typeof input === "string"
        ? { task: input }
        : RunRequestDraftSchema.parse(input);
    return runEvalExecLoop(
      draft,
      runtime.worker,
      runtime.runStore,
      runtime.config,
      options.onRunEvent
    );
  }

  throw new Error(`Unknown workflow: ${workflow.key}`);
}

export async function executeEvalExecWorkflowRerun(
  checkpoint: RunLoopCheckpointState,
  promptOverride: string | undefined,
  runtime: EvalExecRuntime,
  options: { onRunEvent?: RunLoopObserver } = {}
) {
  return runEvalExecFromCheckpoint(
    checkpoint,
    promptOverride,
    runtime.worker,
    runtime.runStore,
    runtime.config,
    options.onRunEvent
  );
}
