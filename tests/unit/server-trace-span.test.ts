import type {
  TraceContext,
  TraceRecordEvent,
} from "@keeperhub/trace-sdk/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { withServerTraceSpan } = await import("@/lib/trace/server-span");

function createProviders(context: TraceContext | null) {
  const events: TraceRecordEvent[] = [];
  let current = context;

  return {
    events,
    providers: {
      contextProvider: {
        get: () => current,
        run: <T>(nextContext: TraceContext, callback: () => T) => {
          const previous = current;
          current = nextContext;
          try {
            return callback();
          } finally {
            current = previous;
          }
        },
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
    },
  };
}

describe("withServerTraceSpan", () => {
  beforeEach(() => {
    process.env.KEEPERHUB_FEATURE_TRACE = "true";
    process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_TRACE = "true";
    vi.clearAllMocks();
  });

  it("bypasses recording when the feature flag is disabled", async () => {
    process.env.KEEPERHUB_FEATURE_TRACE = "false";
    process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_TRACE = "false";
    const { events, providers } = createProviders({
      runId: "run-1",
      spanId: "parent-span",
      traceId: "trace-1",
    });

    const result = await withServerTraceSpan(
      { kind: "auth", label: "Auth", step: "auth.resolve" },
      async () => "ok",
      providers
    );

    expect(result).toBe("ok");
    expect(events).toEqual([]);
  });

  it("runs without recording when there is no active trace context", async () => {
    const { events, providers } = createProviders(null);

    const result = await withServerTraceSpan(
      { kind: "auth", label: "Auth", step: "auth.resolve" },
      async () => "ok",
      providers
    );

    expect(result).toBe("ok");
    expect(events).toEqual([]);
  });

  it("records child span start and end events under the active context", async () => {
    const { events, providers } = createProviders({
      runId: "run-1",
      spanId: "parent-span",
      traceId: "trace-1",
    });

    const result = await withServerTraceSpan(
      {
        attributes: { required: true },
        kind: "auth",
        label: "Resolve auth context",
        step: "auth.resolve",
      },
      async () => "ok",
      providers
    );

    expect(result).toBe("ok");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      attributes: { required: true },
      kind: "auth",
      label: "Resolve auth context",
      parentSpanId: "parent-span",
      runId: "run-1",
      step: "auth.resolve",
      traceId: "trace-1",
      type: "step:start",
    });
    expect("spanId" in events[0]).toBe(true);
    expect(events[1]).toMatchObject({
      runId: "run-1",
      spanId: "spanId" in events[0] ? events[0].spanId : "",
      traceId: "trace-1",
      type: "step:end",
    });
  });

  it("records an error span and rethrows handler failures", async () => {
    const { events, providers } = createProviders({
      runId: "run-1",
      spanId: "parent-span",
      traceId: "trace-1",
    });

    await expect(
      withServerTraceSpan(
        { kind: "db", label: "Query integrations", step: "db.select" },
        async () => {
          throw new Error("database unavailable");
        },
        providers
      )
    ).rejects.toThrow("database unavailable");

    expect(events).toHaveLength(2);
    expect("spanId" in events[0]).toBe(true);
    expect(events[1]).toMatchObject({
      error: { message: "database unavailable", name: "Error" },
      spanId: "spanId" in events[0] ? events[0].spanId : "",
      type: "step:error",
    });
  });
});
