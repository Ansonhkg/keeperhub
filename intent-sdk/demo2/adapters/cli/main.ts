import { applyOperationAction } from "../../core/services/operations.js";
import { EVAL_EXEC_PREPARE_WORKFLOW_KEY } from "../../core/workflows/eval-exec.prepare/contract.js";
import { EVAL_EXEC_RUN_WORKFLOW_KEY } from "../../core/workflows/eval-exec.run/contract.js";
import {
  getSharedEvalExecRuntime,
  invokeWorkflow,
  invokeWorkflowRerunFromCheckpoint,
  invokeWorkflowWithOperation,
} from "../../runtime/workflows/invoker.js";

export async function runCli(argv = process.argv.slice(2)): Promise<unknown> {
  const [command = "run", ...rest] = argv;
  const input = rest.join(" ").trim() || "make this good";

  if (command === "operation") {
    return runOperationCommand(rest);
  }

  if (command === "prepare") {
    return invokeWorkflow(EVAL_EXEC_PREPARE_WORKFLOW_KEY, { intent: input });
  }

  if (command === "run") {
    return invokeWorkflowWithOperation(
      EVAL_EXEC_RUN_WORKFLOW_KEY,
      { task: input },
      "cli"
    );
  }

  throw new Error(`Unknown command: ${command}`);
}

async function runOperationCommand(argv: string[]): Promise<unknown> {
  const [command = "", sessionId = "", ...rest] = argv;
  if (!sessionId) throw new Error("Missing operation session id.");
  const flags = parseFlags(rest);
  const expectedRevision = flags["expected-revision"]
    ? Number(flags["expected-revision"])
    : undefined;
  const leaseId = flags["lease-id"];
  const actionInput: Record<string, unknown> = {};
  let actionKey = command;
  if (command === "rerun") {
    actionKey = "retry-from-checkpoint";
    if (flags.node) actionInput.nodeId = flags.node;
    if (flags.checkpoint) actionInput.checkpointId = flags.checkpoint;
    if (flags.prompt) actionInput.promptOverride = flags.prompt;
  }
  if (command === "claim") {
    actionKey = "claim-control";
  } else if (command === "continue") {
    actionKey = "continue-step";
  }
  if (
    ![
      "claim-control",
      "continue-step",
      "pause",
      "resume",
      "cancel",
      "retry-from-checkpoint",
    ].includes(actionKey)
  ) {
    throw new Error(`Unknown operation command: ${command}`);
  }
  return applyOperationAction(
    getSharedEvalExecRuntime().operationStore,
    sessionId,
    actionKey,
    {
      ...(leaseId ? { leaseId } : {}),
      ...(Number.isInteger(expectedRevision) ? { expectedRevision } : {}),
      input: actionInput,
    },
    undefined,
    {
      origin: "cli",
      executeRerun: (checkpoint, promptOverride, onRunEvent) =>
        invokeWorkflowRerunFromCheckpoint(
          checkpoint,
          promptOverride,
          onRunEvent
        ),
    }
  );
}

function parseFlags(values: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = "true";
    }
  }
  return flags;
}

if (import.meta.main) {
  console.log(JSON.stringify(await runCli(), null, 2));
}
