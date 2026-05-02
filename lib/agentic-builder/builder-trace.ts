import type { BuilderEvent } from "@keeperhub/agentic-builder/schemas";
import { createSpanId } from "@keeperhub/trace-sdk/core";
import { isTraceEnabled } from "@/lib/trace/feature-flag";
import {
  getKeeperTraceProviders,
  type KeeperTraceProviders,
} from "@/lib/trace/providers";

type BuilderTraceMetadata = {
  builderSessionId: string;
  builderStage: string;
  builderEventKind: BuilderEvent["eventKind"];
  builderEventId: string;
};

function compactPayload(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === undefined) {
        return false;
      }
      if (typeof value === "string") {
        return value.length <= 500;
      }
      return true;
    })
  );
}

function traceLabelForBuilderEvent(event: BuilderEvent): string {
  if (event.eventKind === "audit") {
    return `Builder ${event.stage}: ${event.outcome}`;
  }
  return `Builder ${event.stage}`;
}

function traceStepForBuilderEvent(event: BuilderEvent): string {
  return `builder.${event.stage}`;
}

export async function recordBuilderEventTrace(
  event: BuilderEvent,
  providers?: KeeperTraceProviders
) {
  if (!isTraceEnabled()) {
    return;
  }

  const activeProviders = providers ?? getKeeperTraceProviders();
  const context = activeProviders.contextProvider.get();
  if (!context) {
    return;
  }

  const spanId = createSpanId();
  const at = event.createdAt || new Date().toISOString();
  const metadata: BuilderTraceMetadata = {
    builderEventId: event.id,
    builderEventKind: event.eventKind,
    builderSessionId: event.sessionId,
    builderStage: event.stage,
  };

  await activeProviders.recorder.record({
    at,
    attributes: {
      ...metadata,
      capability: "builder",
      trace: { sourcePath: "agentic-builder", surface: "server" },
    },
    input: compactPayload(event.payload),
    kind: "builder",
    label: traceLabelForBuilderEvent(event),
    parentSpanId: context.spanId ?? context.parentSpanId ?? null,
    runId: context.runId,
    spanId,
    step: traceStepForBuilderEvent(event),
    traceId: context.traceId,
    type: "step:start",
  });

  await activeProviders.recorder.record({
    at: new Date().toISOString(),
    output: {
      ...metadata,
      durationMs: event.eventKind === "lifecycle" ? event.durationMs : null,
      model: event.eventKind === "lifecycle" ? event.model : undefined,
      phaseStatus:
        event.eventKind === "lifecycle" ? event.phaseStatus : undefined,
      targetId: event.eventKind === "audit" ? event.targetId : undefined,
    },
    runId: context.runId,
    spanId,
    traceId: context.traceId,
    type: "step:end",
  });
}
