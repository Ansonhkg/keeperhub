import type {
  DiagnosticError,
  DiagnosticEventRecord,
  DiagnosticRun,
  DiagnosticSpan,
  DiagnosticSpanKind,
  DiagnosticSpanLink,
  TraceJsonValue,
} from "../types";
import { sanitizeTraceObject, sanitizeTraceValue } from "./sanitize";

type RunStartEvent = {
  type: "run:start";
  runId: string;
  traceId: string;
  at: string;
  attributes?: unknown;
};

type RunCompletionEvent = {
  type: "run:success";
  at: string;
  payload?: unknown;
};

type RunErrorEvent = {
  type: "run:error";
  at: string;
  error: DiagnosticError;
};

type StepStartEvent = {
  type: "step:start";
  spanId: string;
  parentSpanId: string | null;
  label: string;
  step: string;
  kind: DiagnosticSpanKind | string;
  at: string;
  attributes?: unknown;
  input?: unknown;
};

type StepEndEvent = {
  type: "step:end";
  spanId: string;
  at: string;
  output?: unknown;
};

type StepErrorEvent = {
  type: "step:error";
  spanId: string;
  at: string;
  error: DiagnosticError;
  output?: unknown;
};

type SpanLinkEvent = {
  type: "span:link";
  spanId: string;
  linkedSpanId: string;
  linkType?: string;
  at: string;
  attributes?: unknown;
};

export type TraceLifecycleEvent =
  | RunStartEvent
  | RunCompletionEvent
  | RunErrorEvent
  | StepStartEvent
  | StepEndEvent
  | StepErrorEvent
  | SpanLinkEvent;

function durationBetween(startedAt: string, endedAt: string) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  return Math.max(0, end - start);
}

function readAttribute(
  attributes: Record<string, unknown> | null,
  key: string
) {
  const value = attributes?.[key];
  return typeof value === "string" ? value : "";
}

function eventPayload(event: TraceLifecycleEvent): TraceJsonValue | null {
  if ("payload" in event) {
    return sanitizeTraceValue(event.payload);
  }
  if ("input" in event) {
    return sanitizeTraceValue(event.input);
  }
  if ("output" in event) {
    return sanitizeTraceValue(event.output);
  }
  return null;
}

function appendEvent(
  run: DiagnosticRun,
  event: TraceLifecycleEvent
): DiagnosticEventRecord {
  return {
    at: event.at,
    attributes:
      "attributes" in event ? sanitizeTraceObject(event.attributes) : null,
    durationMs:
      "spanId" in event
        ? (run.spans.find((span) => span.id === event.spanId)?.durationMs ??
          null)
        : run.durationMs,
    error: "error" in event ? event.error : null,
    id: `${run.runId}:${run.events.length + 1}`,
    parentSpanId: "parentSpanId" in event ? event.parentSpanId : null,
    payload: eventPayload(event),
    runId: run.runId,
    spanId: "spanId" in event ? event.spanId : null,
    traceId: run.traceId,
    type: event.type,
  };
}

function appendLink(
  run: DiagnosticRun,
  event: SpanLinkEvent
): DiagnosticSpanLink {
  return {
    attributes: sanitizeTraceObject(event.attributes),
    id: `${run.runId}:${event.spanId}:${event.linkedSpanId}:${run.links.length + 1}`,
    linkedSpanId: event.linkedSpanId,
    runId: run.runId,
    spanId: event.spanId,
    traceId: run.traceId,
    type: event.linkType ?? "link",
  };
}

function withEvent(
  run: DiagnosticRun,
  event: TraceLifecycleEvent
): DiagnosticRun {
  const record = appendEvent(run, event);
  return {
    ...run,
    eventCount: run.events.length + 1,
    events: [...run.events, record],
    lastEventType: event.type,
    spanCount: run.spans.length,
    updatedAt: event.at,
  };
}

function requireRun(run: DiagnosticRun | null): DiagnosticRun {
  if (!run) {
    throw new Error(
      "run:start must be reduced before subsequent trace lifecycle events"
    );
  }
  return run;
}

function startRun(event: RunStartEvent): DiagnosticRun {
  const attributes = sanitizeTraceObject(event.attributes);
  const run: DiagnosticRun = {
    actor: readAttribute(attributes, "actor"),
    attributes,
    capability: readAttribute(attributes, "capability"),
    createdAt: event.at,
    durationMs: null,
    endedAt: null,
    error: null,
    eventCount: 0,
    events: [],
    lastEventType: "",
    links: [],
    mode: readAttribute(attributes, "mode"),
    origin: readAttribute(attributes, "origin"),
    platform: readAttribute(attributes, "platform"),
    provider: readAttribute(attributes, "provider"),
    runId: event.runId,
    spanCount: 0,
    spans: [],
    startedAt: event.at,
    status: "running",
    traceId: event.traceId,
    trigger: readAttribute(attributes, "trigger"),
    updatedAt: event.at,
  };

  return withEvent(run, event);
}

function completeRun(
  current: DiagnosticRun,
  event: RunCompletionEvent
): DiagnosticRun {
  const run: DiagnosticRun = {
    ...current,
    durationMs: durationBetween(current.startedAt, event.at),
    endedAt: event.at,
    error: null,
    status: "success",
  };
  return withEvent(run, event);
}

function failRun(current: DiagnosticRun, event: RunErrorEvent): DiagnosticRun {
  const run: DiagnosticRun = {
    ...current,
    durationMs: durationBetween(current.startedAt, event.at),
    endedAt: event.at,
    error: event.error,
    status: "error",
  };
  return withEvent(run, event);
}

function startStep(
  current: DiagnosticRun,
  event: StepStartEvent
): DiagnosticRun {
  const run: DiagnosticRun = {
    ...current,
    spans: [
      ...current.spans,
      {
        attributes: sanitizeTraceObject(event.attributes),
        durationMs: null,
        endedAt: null,
        error: null,
        id: event.spanId,
        input: sanitizeTraceValue(event.input),
        kind: event.kind,
        label: event.label,
        output: null,
        parentSpanId: event.parentSpanId,
        runId: current.runId,
        startedAt: event.at,
        status: "running",
        step: event.step,
        traceId: current.traceId,
      },
    ],
  };
  return withEvent(run, event);
}

function updateStep(
  current: DiagnosticRun,
  event: StepEndEvent | StepErrorEvent
): DiagnosticRun {
  const spans = current.spans.map((span): DiagnosticSpan => {
    if (span.id !== event.spanId) {
      return span;
    }

    return {
      ...span,
      durationMs: durationBetween(span.startedAt, event.at),
      endedAt: event.at,
      error: event.type === "step:error" ? event.error : null,
      output:
        "output" in event ? sanitizeTraceValue(event.output) : span.output,
      status: event.type === "step:end" ? "success" : "error",
    };
  });
  const run: DiagnosticRun = {
    ...current,
    spans,
  };
  return withEvent(run, event);
}

function linkSpan(current: DiagnosticRun, event: SpanLinkEvent): DiagnosticRun {
  const run: DiagnosticRun = {
    ...current,
    links: [...current.links, appendLink(current, event)],
  };
  return withEvent(run, event);
}

export function reduceTraceLifecycle(
  current: DiagnosticRun | null,
  event: TraceLifecycleEvent
): DiagnosticRun {
  switch (event.type) {
    case "run:start":
      return startRun(event);
    case "run:success":
      return completeRun(requireRun(current), event);
    case "run:error":
      return failRun(requireRun(current), event);
    case "step:start":
      return startStep(requireRun(current), event);
    case "step:end":
    case "step:error":
      return updateStep(requireRun(current), event);
    case "span:link":
      return linkSpan(requireRun(current), event);
    default:
      return event satisfies never;
  }
}
