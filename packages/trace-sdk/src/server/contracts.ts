import type { TraceLifecycleEvent } from "../core/lifecycle";
import type {
  DiagnosticRun,
  DiagnosticRunSummary,
  TraceJsonObject,
} from "../types";

export type TraceRecordEvent = TraceLifecycleEvent & {
  runId?: string;
  traceId?: string;
};

export type TraceContext = {
  runId: string;
  traceId: string;
  spanId?: string;
  parentSpanId?: string | null;
  attributes?: TraceJsonObject | null;
};

export type TraceRunListOptions = {
  page?: number;
  pageSize?: number;
  status?: string;
  capability?: string;
  search?: string;
};

export type TraceRunListResult = {
  runs: DiagnosticRunSummary[];
  total: number;
  page: number;
  pageSize: number;
  capabilities: string[];
};

export type TraceDiagnosticsSummary = {
  totalRuns: number;
  totalEvents: number;
  totalSpans: number;
  approximateFootprintBytes: number;
  capabilities: string[];
  statuses: Record<string, number>;
};

export type TraceCleanupOptions = {
  retentionDays: number;
  now?: Date | string | number;
};

export type TraceCleanupResult = {
  removed: number;
  kept: number;
};

export type TraceStore = {
  recordEvent(event: TraceRecordEvent): Promise<DiagnosticRun | null>;
  recordEvents(
    events: readonly TraceRecordEvent[]
  ): Promise<Array<DiagnosticRun | null>>;
  listRuns(options?: TraceRunListOptions): Promise<TraceRunListResult>;
  getRun(runId: string): Promise<DiagnosticRun | null>;
  getSummary(): Promise<TraceDiagnosticsSummary>;
  cleanupRuns(options: TraceCleanupOptions): Promise<TraceCleanupResult>;
};

export type TraceEventListener = (event: TraceRecordEvent) => void;

export type TraceEventBus = {
  publish(event: TraceRecordEvent): void;
  subscribe(runId: string, listener: TraceEventListener): () => void;
};

export type TraceStreamProvider = TraceEventBus;

export type TraceContextProvider = {
  get(): TraceContext | null;
  run<T>(context: TraceContext, callback: () => T): T;
};

export type TraceClock = {
  now(): Date;
};

export type TraceIdGenerator = {
  createTraceId(): string;
  createSpanId(): string;
};

export type TracePropagationProvider = {
  parse(
    value: string
  ): { traceId: string; parentSpanId: string; traceFlags: string } | null;
  format(input: {
    traceId: string;
    parentSpanId: string;
    traceFlags?: string;
  }): string;
};
