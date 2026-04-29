import {
  createSpanId,
  createTraceId,
  formatTraceparent,
  parseTraceparent,
} from "../core";
import type {
  TraceClock,
  TraceContextProvider,
  TraceEventBus,
  TraceIdGenerator,
  TracePropagationProvider,
  TraceRecordEvent,
  TraceStore,
} from "./contracts";

type TraceRecordResult = Awaited<ReturnType<TraceStore["recordEvent"]>>;

export type TraceRecorder = {
  record(event: TraceRecordEvent): Promise<TraceRecordResult>;
  recordMany(events: readonly TraceRecordEvent[]): Promise<TraceRecordResult[]>;
};

export type TraceRecorderDeps = {
  clock?: TraceClock;
  contextProvider?: TraceContextProvider;
  eventBus?: TraceEventBus;
  store: Pick<TraceStore, "recordEvent">;
};

export function createSystemTraceClock(): TraceClock {
  return {
    now() {
      return new Date();
    },
  };
}

export function createDefaultTraceIdGenerator(): TraceIdGenerator {
  return {
    createSpanId,
    createTraceId,
  };
}

export function createTracePropagationProvider(): TracePropagationProvider {
  return {
    format: formatTraceparent,
    parse: parseTraceparent,
  };
}

function withContext(
  event: TraceRecordEvent,
  contextProvider?: TraceContextProvider
): TraceRecordEvent {
  const context = contextProvider?.get();
  if (!context) {
    return event;
  }

  return {
    ...event,
    runId: event.runId ?? context.runId,
    traceId: event.traceId ?? context.traceId,
  };
}

export function createTraceRecorder(deps: TraceRecorderDeps): TraceRecorder {
  return {
    async record(event: TraceRecordEvent) {
      const enriched = withContext(event, deps.contextProvider);
      try {
        const run = await deps.store.recordEvent(enriched);
        try {
          deps.eventBus?.publish(enriched);
        } catch {
          return run;
        }
        return run;
      } catch {
        return null;
      }
    },

    async recordMany(events: readonly TraceRecordEvent[]) {
      const results: TraceRecordResult[] = [];
      for (const event of events) {
        results.push(await this.record(event));
      }
      return results;
    },
  };
}
