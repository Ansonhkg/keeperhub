import "server-only";

import type { TraceContext } from "@keeperhub/trace-sdk/server";
import {
  recordWorkflowSpanLink,
  startWorkflowTraceRun,
  type WorkflowTraceRunInput,
  type WorkflowTraceSpanLinkInput,
} from "@/lib/trace/workflow-trace";

export async function startWorkflowTraceRunStep(
  input: WorkflowTraceRunInput
): Promise<TraceContext | null> {
  "use step";
  return await startWorkflowTraceRun(input);
}

export async function recordWorkflowSpanLinkStep(
  input: WorkflowTraceSpanLinkInput
): Promise<void> {
  "use step";
  await recordWorkflowSpanLink(input);
}

startWorkflowTraceRunStep.maxRetries = 0;
recordWorkflowSpanLinkStep.maxRetries = 0;
