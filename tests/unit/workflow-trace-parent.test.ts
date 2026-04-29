import type {
  TraceContext,
  TraceRecordEvent,
} from "@keeperhub/trace-sdk/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  recordWorkflowStepStart,
  startWorkflowTraceRun,
} from "@/lib/trace/workflow-trace";

function createProviders() {
  const events: TraceRecordEvent[] = [];
  let current: TraceContext | null = null;

  return {
    events,
    providers: {
      contextProvider: {
        get: () => current,
        run: <T>(context: TraceContext, callback: () => T) => {
          current = context;
          return callback();
        },
      },
      eventBus: { publish: () => undefined, subscribe: () => () => undefined },
      propagationProvider: {
        format: () => "",
        parse: () => null,
      },
      recorder: {
        record: async (event: TraceRecordEvent) => {
          events.push(event);
          return null;
        },
        recordMany: async (recordedEvents: readonly TraceRecordEvent[]) => {
          events.push(...recordedEvents);
          return recordedEvents.map(() => null);
        },
      },
      store: {
        cleanupRuns: async () => ({ kept: 0, removed: 0 }),
        getRun: async () => null,
        getSummary: async () => ({
          approximateFootprintBytes: 0,
          capabilities: [],
          statuses: {},
          totalEvents: 0,
          totalRuns: 0,
          totalSpans: 0,
        }),
        listRuns: async () => ({
          capabilities: [],
          page: 1,
          pageSize: 10,
          runs: [],
          total: 0,
        }),
        recordEvent: async () => null,
        recordEvents: async () => [],
      },
    },
  };
}

describe("workflow trace parent context", () => {
  beforeEach(() => {
    process.env.KEEPERHUB_FEATURE_TRACE = "true";
    process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_TRACE = "true";
  });

  it("keeps workflow runs on the initiating trace and parents first steps to the API span", async () => {
    const { events, providers } = createProviders();
    const context = await startWorkflowTraceRun(
      {
        executionId: "execution-1",
        parentSpanId: "api-span-1",
        traceId: "trace-from-api",
        userId: "user-1",
        workflowId: "workflow-1",
      },
      providers
    );

    const spanId = await recordWorkflowStepStart(
      {
        actionType: "webhook.send",
        label: "Send webhook",
        nodeId: "node-1",
        traceContext: context ?? undefined,
      },
      providers
    );

    expect(spanId).toBeTruthy();
    expect(events[0]).toMatchObject({
      runId: "execution-1",
      traceId: "trace-from-api",
      type: "run:start",
    });
    expect(events[1]).toMatchObject({
      parentSpanId: "api-span-1",
      runId: "execution-1",
      traceId: "trace-from-api",
      type: "step:start",
    });
  });
});
