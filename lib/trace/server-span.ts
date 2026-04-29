import { createSpanId } from "@keeperhub/trace-sdk/core";
import type {
  TraceContext,
  TraceRecordEvent,
  TraceRecorder,
} from "@keeperhub/trace-sdk/server";
import { isTraceEnabled } from "./feature-flag";
import { getKeeperTraceProviders } from "./providers";

type ServerSpanProviders = {
  contextProvider: {
    get(): TraceContext | null;
    run<T>(context: TraceContext, callback: () => T): T;
  };
  recorder: TraceRecorder;
};

type ServerTraceSpanInput = {
  label: string;
  step: string;
  kind: string;
  attributes?: Record<string, unknown>;
  input?: unknown;
};

function normalizeError(error: unknown) {
  return {
    message: error instanceof Error ? error.message : "Server span failed",
    name: error instanceof Error ? error.name : "ServerSpanError",
  };
}

async function recordFailSoft(
  recorder: TraceRecorder,
  event: TraceRecordEvent
) {
  try {
    return await recorder.record(event);
  } catch {
    return null;
  }
}

export async function withServerTraceSpan<T>(
  input: ServerTraceSpanInput,
  handler: () => T | Promise<T>,
  providers?: ServerSpanProviders
): Promise<T> {
  if (!isTraceEnabled()) {
    return await handler();
  }

  const activeProviders = providers ?? getKeeperTraceProviders();
  const context = activeProviders.contextProvider.get();
  if (!context) {
    return await handler();
  }

  const spanId = createSpanId();
  const parentSpanId = context.spanId ?? context.parentSpanId ?? null;

  await recordFailSoft(activeProviders.recorder, {
    at: new Date().toISOString(),
    attributes: input.attributes,
    input: input.input,
    kind: input.kind,
    label: input.label,
    parentSpanId,
    runId: context.runId,
    spanId,
    step: input.step,
    traceId: context.traceId,
    type: "step:start",
  });

  try {
    const result = await activeProviders.contextProvider.run(
      { ...context, parentSpanId, spanId },
      handler
    );
    await recordFailSoft(activeProviders.recorder, {
      at: new Date().toISOString(),
      runId: context.runId,
      spanId,
      traceId: context.traceId,
      type: "step:end",
    });
    return result;
  } catch (error) {
    await recordFailSoft(activeProviders.recorder, {
      at: new Date().toISOString(),
      error: normalizeError(error),
      runId: context.runId,
      spanId,
      traceId: context.traceId,
      type: "step:error",
    });
    throw error;
  }
}
