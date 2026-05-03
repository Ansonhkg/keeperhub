import type {
  PrepareRequest,
  PrepareResponse,
  RunRequestDraft,
  RunResponse,
} from "../../core/schemas.js";
import {
  recordWorkflowOperation,
  startWorkflowOperation,
} from "../../core/services/operations.js";
import type {
  RunLoopCheckpointState,
  RunLoopObserver,
} from "../../core/services/run-loop.js";
import { createEvalExecRuntime } from "../services.js";
import {
  type EVAL_EXEC_PREPARE_WORKFLOW_KEY,
  type EVAL_EXEC_RUN_WORKFLOW_KEY,
  executeWorkflowByKey,
  executeWorkflowRerunFromCheckpoint,
} from "./index.js";

const sharedRuntime = createEvalExecRuntime();

export async function invokeWorkflow(
  workflowKey: typeof EVAL_EXEC_PREPARE_WORKFLOW_KEY,
  input: PrepareRequest
): Promise<PrepareResponse>;
export async function invokeWorkflow(
  workflowKey: typeof EVAL_EXEC_RUN_WORKFLOW_KEY,
  input: RunRequestDraft
): Promise<RunResponse>;
export async function invokeWorkflow(
  workflowKey: string,
  input: unknown
): Promise<PrepareResponse | RunResponse>;
export async function invokeWorkflow(workflowKey: string, input: unknown) {
  return executeWorkflowByKey(workflowKey, input, sharedRuntime);
}

export async function invokeWorkflowWithOperation(
  workflowKey: string,
  input: unknown,
  origin: "mcp" | "http" | "cli" | "sdk"
) {
  return recordWorkflowOperation(
    sharedRuntime.operationStore,
    workflowKey,
    input,
    () => executeWorkflowByKey(workflowKey, input, sharedRuntime),
    origin
  );
}

export async function startWorkflowWithOperation(
  workflowKey: string,
  input: unknown,
  origin: "mcp" | "http" | "cli" | "sdk"
) {
  return startWorkflowOperation(
    sharedRuntime.operationStore,
    workflowKey,
    input,
    (onRunEvent) =>
      executeWorkflowByKey(workflowKey, input, sharedRuntime, { onRunEvent }),
    origin
  );
}

export function getSharedEvalExecRuntime() {
  return sharedRuntime;
}

export function invokeWorkflowRerunFromCheckpoint(
  checkpoint: RunLoopCheckpointState,
  promptOverride: string | undefined,
  onRunEvent?: RunLoopObserver
) {
  return executeWorkflowRerunFromCheckpoint(
    checkpoint,
    promptOverride,
    sharedRuntime,
    { onRunEvent }
  );
}
