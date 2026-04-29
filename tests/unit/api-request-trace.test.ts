import type {
  TraceContext,
  TraceRecordEvent,
} from "@keeperhub/trace-sdk/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const events: TraceRecordEvent[] = [];
let currentContext: TraceContext | null = null;

vi.mock("@/lib/trace/providers", () => ({
  getKeeperTraceProviders: () => ({
    contextProvider: {
      get: () => currentContext,
      run: <T>(context: TraceContext, callback: () => T) => {
        const previous = currentContext;
        currentContext = context;
        try {
          return callback();
        } finally {
          currentContext = previous;
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
  }),
}));

const { withApiRequestTrace, withTracedApiHandler } = await import(
  "@/lib/trace/api-request-trace"
);

describe("withApiRequestTrace", () => {
  beforeEach(() => {
    process.env.KEEPERHUB_FEATURE_TRACE = "true";
    process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_TRACE = "true";
    events.length = 0;
    currentContext = null;
  });

  it("bypasses tracing when the feature flag is disabled", async () => {
    process.env.KEEPERHUB_FEATURE_TRACE = "false";
    process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_TRACE = "false";

    const handler = vi.fn(async (_request: Request) =>
      Response.json({ ok: true })
    );
    const tracedHandler = withTracedApiHandler("GET /api/test", handler);
    const response = await tracedHandler(
      new Request("https://keeper.test/api/test")
    );

    expect(response.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });

  it("creates a root API trace when no incoming trace headers exist", async () => {
    const response = await withApiRequestTrace(
      new Request("https://keeper.test/api/cron/job"),
      "GET /api/cron/job",
      async (context) => {
        expect(context?.runId).toMatch(/^api_/);
        return Response.json({ ok: true });
      }
    );

    expect(response.ok).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      "run:start",
      "step:start",
      "run:success",
      "step:end",
    ]);
    expect(events[0]).toMatchObject({
      attributes: {
        capability: "api",
        origin: "api",
        route: "/api/cron/job",
        trigger: "http",
      },
      type: "run:start",
    });
  });

  it("continues an incoming browser trace without creating a new run", async () => {
    const request = new Request("https://keeper.test/api/workflows", {
      headers: {
        "x-keeperhub-trace-id": "trace-1",
        "x-keeperhub-trace-parent-span-id": "network-span",
        "x-keeperhub-trace-run-id": "run-1",
      },
    });

    const response = await withApiRequestTrace(
      request,
      "GET /api/workflows",
      async (context) => {
        expect(context).toMatchObject({
          parentSpanId: "network-span",
          runId: "run-1",
          traceId: "trace-1",
        });
        return Response.json({ ok: true });
      }
    );

    expect(response.ok).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      "step:start",
      "step:end",
    ]);
    expect(events[0]).toMatchObject({
      parentSpanId: "network-span",
      runId: "run-1",
      traceId: "trace-1",
      type: "step:start",
    });
  });

  it("records step and run errors for non-2xx root API responses", async () => {
    const response = await withApiRequestTrace(
      new Request("https://keeper.test/api/internal/reaper"),
      "GET /api/internal/reaper",
      async () => Response.json({ error: "blocked" }, { status: 503 })
    );

    expect(response.status).toBe(503);
    expect(events.map((event) => event.type)).toEqual([
      "run:start",
      "step:start",
      "run:error",
      "step:error",
    ]);
    expect(events[2]).toMatchObject({
      error: { message: "API request failed (503)", name: "ApiRequestError" },
      type: "run:error",
    });
    expect(events[3]).toMatchObject({
      error: { message: "API request failed (503)", name: "ApiRequestError" },
      type: "step:error",
    });
  });

  it("records step and run errors when root API handlers throw", async () => {
    await expect(
      withApiRequestTrace(
        new Request("https://keeper.test/api/internal/reaper"),
        "GET /api/internal/reaper",
        async () => {
          throw new Error("boom");
        }
      )
    ).rejects.toThrow("boom");

    expect(events.map((event) => event.type)).toEqual([
      "run:start",
      "step:start",
      "step:error",
      "run:error",
    ]);
    expect(events[2]).toMatchObject({
      error: { message: "boom", name: "Error" },
      type: "step:error",
    });
    expect(events[3]).toMatchObject({
      error: { message: "boom", name: "Error" },
      type: "run:error",
    });
  });
});
