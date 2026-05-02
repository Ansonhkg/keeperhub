import { createSpanId, createTraceId } from "@keeperhub/trace-sdk/core";
import type {
  TraceContext,
  TraceRecordEvent,
} from "@keeperhub/trace-sdk/server";
import { isTraceEnabled } from "./feature-flag";
import {
  getKeeperTraceProviders,
  type KeeperTraceProviders,
} from "./providers";

export type WorkflowTraceRunInput = {
  executionId: string;
  workflowId: string;
  userId: string;
  organizationId?: string | null;
  trigger?: string;
  traceId?: string;
  parentSpanId?: string | null;
  at?: Date | string;
  builderTrace?: Record<string, unknown>;
};

export type WorkflowTraceStepStartInput = {
  spanId?: string;
  parentSpanId?: string | null;
  traceContext?: TraceContext;
  nodeId: string;
  label: string;
  actionType: string;
  iterationIndex?: number;
  forEachNodeId?: string;
  input?: unknown;
  at?: Date | string;
};

export type WorkflowTraceStepEndInput = {
  spanId: string;
  traceContext?: TraceContext;
  output?: unknown;
  at?: Date | string;
};

export type WorkflowTraceStepErrorInput = {
  spanId: string;
  traceContext?: TraceContext;
  error: Error | { message: string; name?: string };
  at?: Date | string;
};

export type WorkflowTraceSpanLinkInput = {
  spanId: string;
  linkedSpanId: string;
  traceContext?: TraceContext;
  type?: string;
  attributes?: Record<string, unknown>;
  at?: Date | string;
};

function atIso(value: Date | string | undefined) {
  if (!value) {
    return new Date().toISOString();
  }
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeError(error: Error | { message: string; name?: string }) {
  return {
    message: error.message,
    name: error.name ?? "Error",
  };
}

async function recordFailSoft(
  event: TraceRecordEvent,
  providers: KeeperTraceProviders
) {
  try {
    return await providers.recorder.record(event);
  } catch {
    return null;
  }
}

function getTraceContext(
  providers: KeeperTraceProviders,
  explicitContext?: TraceContext
) {
  return explicitContext ?? providers.contextProvider.get();
}

export async function startWorkflowTraceRun(
  input: WorkflowTraceRunInput,
  providers?: KeeperTraceProviders
): Promise<TraceContext | null> {
  if (!isTraceEnabled()) {
    return null;
  }

  const activeProviders = providers ?? getKeeperTraceProviders();
  const traceId = input.traceId ?? createTraceId();
  const context: TraceContext = {
    parentSpanId: input.parentSpanId ?? null,
    runId: input.executionId,
    traceId,
  };

  await recordFailSoft(
    {
      at: atIso(input.at),
      attributes: {
        capability: "workflow",
        executionId: input.executionId,
        organizationId: input.organizationId ?? "",
        trigger: input.trigger ?? "manual",
        userId: input.userId,
        workflowId: input.workflowId,
        ...(input.builderTrace
          ? {
              builderSessionId:
                typeof input.builderTrace.builderSessionId === "string"
                  ? input.builderTrace.builderSessionId
                  : "",
              builderMaterializer:
                typeof input.builderTrace.materializer === "string"
                  ? input.builderTrace.materializer
                  : "",
              builderSelectedOptionIds: Array.isArray(
                input.builderTrace.selectedOptionIds
              )
                ? input.builderTrace.selectedOptionIds.join(",")
                : "",
            }
          : {}),
      },
      runId: input.executionId,
      traceId,
      type: "run:start",
    },
    activeProviders
  );

  return context;
}

export function withWorkflowTraceContext<T>(
  context: TraceContext,
  callback: () => T,
  providers?: KeeperTraceProviders
) {
  if (!isTraceEnabled()) {
    return callback();
  }

  return (providers ?? getKeeperTraceProviders()).contextProvider.run(
    context,
    callback
  );
}

export async function recordWorkflowStepStart(
  input: WorkflowTraceStepStartInput,
  providers?: KeeperTraceProviders
) {
  if (!isTraceEnabled()) {
    return null;
  }

  const activeProviders = providers ?? getKeeperTraceProviders();
  const context = getTraceContext(activeProviders, input.traceContext);
  if (!context) {
    return null;
  }

  const spanId = input.spanId ?? createSpanId();
  await recordFailSoft(
    {
      at: atIso(input.at),
      attributes: {
        actionType: input.actionType,
        forEachNodeId: input.forEachNodeId ?? "",
        iterationIndex: input.iterationIndex ?? null,
        nodeId: input.nodeId,
      },
      input: input.input,
      kind: "step",
      label: input.label,
      parentSpanId:
        input.parentSpanId ?? context.spanId ?? context.parentSpanId ?? null,
      runId: context.runId,
      spanId,
      step: input.actionType,
      traceId: context.traceId,
      type: "step:start",
    },
    activeProviders
  );

  return spanId;
}

export async function recordWorkflowStepEnd(
  input: WorkflowTraceStepEndInput,
  providers?: KeeperTraceProviders
) {
  if (!isTraceEnabled()) {
    return null;
  }

  const activeProviders = providers ?? getKeeperTraceProviders();
  const context = getTraceContext(activeProviders, input.traceContext);
  if (!context) {
    return null;
  }

  return await recordFailSoft(
    {
      at: atIso(input.at),
      output: input.output,
      runId: context.runId,
      spanId: input.spanId,
      traceId: context.traceId,
      type: "step:end",
    },
    activeProviders
  );
}

export async function recordWorkflowStepError(
  input: WorkflowTraceStepErrorInput,
  providers?: KeeperTraceProviders
) {
  if (!isTraceEnabled()) {
    return null;
  }

  const activeProviders = providers ?? getKeeperTraceProviders();
  const context = getTraceContext(activeProviders, input.traceContext);
  if (!context) {
    return null;
  }

  return await recordFailSoft(
    {
      at: atIso(input.at),
      error: normalizeError(input.error),
      runId: context.runId,
      spanId: input.spanId,
      traceId: context.traceId,
      type: "step:error",
    },
    activeProviders
  );
}

export async function recordWorkflowSpanLink(
  input: WorkflowTraceSpanLinkInput,
  providers?: KeeperTraceProviders
) {
  if (!isTraceEnabled()) {
    return null;
  }

  const activeProviders = providers ?? getKeeperTraceProviders();
  const context = getTraceContext(activeProviders, input.traceContext);
  if (!context) {
    return null;
  }

  return await recordFailSoft(
    {
      at: atIso(input.at),
      attributes: input.attributes,
      linkedSpanId: input.linkedSpanId,
      runId: context.runId,
      spanId: input.spanId,
      traceId: context.traceId,
      type: "span:link",
      linkType: input.type ?? "link",
    },
    activeProviders
  );
}

export async function recordWorkflowRunSuccess(
  traceContext?: TraceContext,
  providers?: KeeperTraceProviders
) {
  if (!isTraceEnabled()) {
    return null;
  }

  const activeProviders = providers ?? getKeeperTraceProviders();
  const context = getTraceContext(activeProviders, traceContext);
  if (!context) {
    return null;
  }

  return await recordFailSoft(
    {
      at: new Date().toISOString(),
      runId: context.runId,
      traceId: context.traceId,
      type: "run:success",
    },
    activeProviders
  );
}

export async function recordWorkflowRunError(
  error: Error | { message: string; name?: string },
  traceContext?: TraceContext,
  providers?: KeeperTraceProviders
) {
  if (!isTraceEnabled()) {
    return null;
  }

  const activeProviders = providers ?? getKeeperTraceProviders();
  const context = getTraceContext(activeProviders, traceContext);
  if (!context) {
    return null;
  }

  return await recordFailSoft(
    {
      at: new Date().toISOString(),
      error: normalizeError(error),
      runId: context.runId,
      traceId: context.traceId,
      type: "run:error",
    },
    activeProviders
  );
}
