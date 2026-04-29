import {
  createAsyncLocalTraceContextProvider,
  createInMemoryTraceEventBus,
  createInMemoryTraceStore,
  createTraceRecorder,
  formatSseEvent,
  formatSseHeartbeat,
} from "@keeperhub/trace-sdk/server";
import { describe, expect, it } from "vitest";

const traceId = "1234567890abcdef1234567890abcdef";
const rootSpanId = "1234567890abcdef";

describe("in-memory trace store", () => {
  it("records lifecycle events into diagnostic runs without a database", async () => {
    const store = createInMemoryTraceStore();
    const recorder = createTraceRecorder({ store });

    await recorder.record({
      at: "2026-01-01T00:00:00.000Z",
      attributes: { capability: "workflow", workflowId: "workflow-1" },
      runId: "run-1",
      traceId,
      type: "run:start",
    });
    await recorder.record({
      at: "2026-01-01T00:00:00.010Z",
      kind: "step",
      label: "Send Slack",
      parentSpanId: null,
      runId: "run-1",
      spanId: rootSpanId,
      step: "slack.send",
      type: "step:start",
    });
    await recorder.record({
      at: "2026-01-01T00:00:00.015Z",
      output: { ok: true },
      runId: "run-1",
      spanId: rootSpanId,
      type: "step:end",
    });

    const run = await store.getRun("run-1");
    const summary = await store.getSummary();

    expect(run).toMatchObject({
      attributes: { capability: "workflow", workflowId: "workflow-1" },
      eventCount: 3,
      runId: "run-1",
      spanCount: 1,
      status: "running",
      traceId,
    });
    expect(run?.spans[0]).toMatchObject({
      durationMs: 5,
      id: rootSpanId,
      output: { ok: true },
      status: "success",
    });
    expect(summary).toMatchObject({ totalEvents: 3, totalRuns: 1 });
  });

  it("removes runs older than the requested retention window", async () => {
    const store = createInMemoryTraceStore();

    await store.recordEvent({
      at: "2026-01-01T00:00:00.000Z",
      runId: "old-run",
      traceId,
      type: "run:start",
    });
    await store.recordEvent({
      at: "2026-01-04T00:00:00.000Z",
      runId: "new-run",
      traceId,
      type: "run:start",
    });

    const result = await store.cleanupRuns({
      now: "2026-01-04T12:00:00.000Z",
      retentionDays: 1,
    });
    const list = await store.listRuns({ page: 0, pageSize: 10 });

    expect(result).toEqual({ kept: 1, removed: 1 });
    expect(list.runs.map((run) => run.runId)).toEqual(["new-run"]);
  });
});

describe("trace event bus", () => {
  it("delivers matching run events and stops after unsubscribe", () => {
    const bus = createInMemoryTraceEventBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe("run-1", (event) => {
      received.push(event.runId ?? "");
    });

    bus.publish({
      at: "2026-01-01T00:00:00.000Z",
      runId: "run-1",
      traceId,
      type: "run:start",
    });
    bus.publish({
      at: "2026-01-01T00:00:00.000Z",
      runId: "run-2",
      traceId,
      type: "run:start",
    });
    unsubscribe();
    bus.publish({
      at: "2026-01-01T00:00:01.000Z",
      runId: "run-1",
      traceId,
      type: "run:start",
    });

    expect(received).toEqual(["run-1"]);
  });
});

describe("trace recorder", () => {
  it("does not throw when the store fails", async () => {
    const failingStore = {
      ...createInMemoryTraceStore(),
      recordEvent() {
        return Promise.reject(new Error("store unavailable"));
      },
    };
    const recorder = createTraceRecorder({ store: failingStore });

    await expect(
      recorder.record({
        at: "2026-01-01T00:00:00.000Z",
        runId: "run-1",
        traceId,
        type: "run:start",
      })
    ).resolves.toBeNull();
  });
});

describe("trace context provider", () => {
  it("keeps trace context scoped to the async callback", async () => {
    const contextProvider = createAsyncLocalTraceContextProvider();

    expect(contextProvider.get()).toBeNull();

    await contextProvider.run(
      { runId: "run-1", spanId: rootSpanId, traceId },
      () => {
        expect(contextProvider.get()).toEqual({
          runId: "run-1",
          spanId: rootSpanId,
          traceId,
        });
      }
    );

    expect(contextProvider.get()).toBeNull();
  });
});

describe("SSE helpers", () => {
  it("formats event and heartbeat frames", () => {
    expect(
      formatSseEvent({ data: { ok: true }, event: "trace", id: "event-1" })
    ).toBe('id: event-1\nevent: trace\ndata: {"ok":true}\n\n');
    expect(formatSseHeartbeat()).toBe(": heartbeat\n\n");
  });
});
