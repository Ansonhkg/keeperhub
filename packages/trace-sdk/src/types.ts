export type TraceJsonPrimitive = string | number | boolean | null;

export type TraceJsonValue =
  | TraceJsonPrimitive
  | TraceJsonObject
  | TraceJsonValue[];

export type TraceJsonObject = {
  [key: string]: TraceJsonValue;
};

export type DiagnosticStatus = "pending" | "running" | "success" | "error";

export type DiagnosticSpanKind = "run" | "step" | "loop" | "http" | "internal";

export type DiagnosticError = {
  code?: string;
  message: string;
  name: string;
  stack?: string;
};

export type DiagnosticSpanLink = {
  id: string;
  runId: string;
  traceId: string;
  spanId: string;
  linkedSpanId: string;
  type: string;
  attributes: TraceJsonObject | null;
};

export type DiagnosticSpan = {
  id: string;
  runId: string;
  traceId: string;
  parentSpanId: string | null;
  label: string;
  kind: DiagnosticSpanKind | string;
  status: DiagnosticStatus;
  step: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  attributes?: TraceJsonObject | null;
  input?: TraceJsonValue | null;
  output?: TraceJsonValue | null;
  error?: DiagnosticError | null;
};

export type DiagnosticEventRecord = {
  id: string;
  type: string;
  runId: string;
  traceId: string;
  spanId: string | null;
  parentSpanId: string | null;
  at: string;
  durationMs: number | null;
  payload: TraceJsonValue | null;
  attributes: TraceJsonObject | null;
  error: DiagnosticError | null;
};

export type DiagnosticRunSummary = {
  runId: string;
  traceId: string;
  capability: string;
  origin: string;
  trigger: string;
  actor: string;
  platform: string;
  mode: string;
  provider: string;
  status: DiagnosticStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  attributes: TraceJsonObject | null;
  error: DiagnosticError | null;
  eventCount: number;
  spanCount: number;
  lastEventType: string;
};

export type DiagnosticRun = DiagnosticRunSummary & {
  spans: DiagnosticSpan[];
  events: DiagnosticEventRecord[];
  links: DiagnosticSpanLink[];
};
