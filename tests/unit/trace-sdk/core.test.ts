import {
  buildTraceTree,
  buildTraceWaterfall,
  createSpanId,
  createTraceId,
  formatTraceDuration,
  formatTraceparent,
  parseTraceparent,
  reduceTraceLifecycle,
  sanitizeTraceValue,
} from "@keeperhub/trace-sdk/core";
import { describe, expect, it } from "vitest";

const traceId = "1234567890abcdef1234567890abcdef";
const rootSpanId = "1234567890abcdef";
const childSpanId = "abcdef1234567890";
const traceIdPattern = /^[0-9a-f]{32}$/;
const spanIdPattern = /^[0-9a-f]{16}$/;

describe("trace core IDs", () => {
  it("creates OTEL-sized non-zero trace and span IDs", () => {
    const generatedTraceId = createTraceId();
    const generatedSpanId = createSpanId();

    expect(generatedTraceId).toMatch(traceIdPattern);
    expect(generatedTraceId).not.toBe("00000000000000000000000000000000");
    expect(generatedSpanId).toMatch(spanIdPattern);
    expect(generatedSpanId).not.toBe("0000000000000000");
  });
});

describe("traceparent helpers", () => {
  it("formats and parses a valid W3C traceparent", () => {
    const header = formatTraceparent({ parentSpanId: rootSpanId, traceId });

    expect(header).toBe(`00-${traceId}-${rootSpanId}-01`);
    expect(parseTraceparent(header)).toEqual({
      parentSpanId: rootSpanId,
      traceFlags: "01",
      traceId,
      version: "00",
    });
  });

  it("rejects invalid traceparent values", () => {
    expect(parseTraceparent("")).toBeNull();
    expect(parseTraceparent(`00-${traceId}-0000000000000000-01`)).toBeNull();
    expect(
      parseTraceparent(
        "00-00000000000000000000000000000000-1234567890abcdef-01"
      )
    ).toBeNull();
    expect(parseTraceparent(`ff-${traceId}-${rootSpanId}-01`)).toBeNull();
    expect(parseTraceparent(`00-${traceId}-${rootSpanId}-zz`)).toBeNull();
  });
});

describe("trace payload sanitization", () => {
  it("redacts sensitive keys and summarizes large values safely", () => {
    const value = sanitizeTraceValue(
      {
        apiKey: "secret-api-key",
        items: [1, 2, 3, 4],
        longText: "abcdefghijklmnopqrstuvwxyz",
        nested: {
          token: "secret-token",
          child: {
            value: "too deep",
          },
        },
      },
      { maxArrayLength: 2, maxDepth: 2, maxStringLength: 8 }
    );

    expect(value).toEqual({
      apiKey: "[redacted]",
      items: [1, 2, "[2 more items]"],
      longText: "abcdefgh...",
      nested: {
        child: "[max depth reached]",
        token: "[redacted]",
      },
    });
  });
});

describe("trace lifecycle reducer", () => {
  it("handles run start, success, and error lifecycle events", () => {
    const started = reduceTraceLifecycle(null, {
      at: "2026-01-01T00:00:00.000Z",
      attributes: { workflowId: "workflow-1" },
      runId: "execution-1",
      traceId,
      type: "run:start",
    });

    expect(started).toMatchObject({
      attributes: { workflowId: "workflow-1" },
      runId: "execution-1",
      status: "running",
      traceId,
    });
    expect(started.events.map((event) => event.type)).toEqual(["run:start"]);

    const succeeded = reduceTraceLifecycle(started, {
      at: "2026-01-01T00:00:00.010Z",
      type: "run:success",
    });

    expect(succeeded.status).toBe("success");
    expect(succeeded.durationMs).toBe(10);
    expect(succeeded.events.map((event) => event.type)).toEqual([
      "run:start",
      "run:success",
    ]);

    const failed = reduceTraceLifecycle(started, {
      at: "2026-01-01T00:00:00.020Z",
      error: { code: "STEP_FAILED", message: "Step failed", name: "Error" },
      type: "run:error",
    });

    expect(failed.status).toBe("error");
    expect(failed.error).toEqual({
      code: "STEP_FAILED",
      message: "Step failed",
      name: "Error",
    });
    expect(failed.durationMs).toBe(20);
  });

  it("handles step start, end, and error lifecycle events", () => {
    const started = reduceTraceLifecycle(null, {
      at: "2026-01-01T00:00:00.000Z",
      runId: "execution-1",
      traceId,
      type: "run:start",
    });
    const withFirstStep = reduceTraceLifecycle(started, {
      at: "2026-01-01T00:00:00.005Z",
      attributes: { nodeId: "node-1" },
      input: { password: "secret", value: "visible" },
      kind: "step",
      label: "Send Slack",
      parentSpanId: null,
      spanId: rootSpanId,
      step: "slack.send",
      type: "step:start",
    });
    const withSuccessfulStep = reduceTraceLifecycle(withFirstStep, {
      at: "2026-01-01T00:00:00.015Z",
      output: { ok: true },
      spanId: rootSpanId,
      type: "step:end",
    });
    const withSecondStep = reduceTraceLifecycle(withSuccessfulStep, {
      at: "2026-01-01T00:00:00.020Z",
      kind: "step",
      label: "Create Record",
      parentSpanId: rootSpanId,
      spanId: childSpanId,
      step: "database.create",
      type: "step:start",
    });
    const withFailedStep = reduceTraceLifecycle(withSecondStep, {
      at: "2026-01-01T00:00:00.025Z",
      error: { message: "Database unavailable", name: "DatabaseError" },
      spanId: childSpanId,
      type: "step:error",
    });

    expect(withFailedStep.spans).toHaveLength(2);
    expect(withFailedStep.spans[0]).toMatchObject({
      attributes: { nodeId: "node-1" },
      durationMs: 10,
      id: rootSpanId,
      input: { password: "[redacted]", value: "visible" },
      output: { ok: true },
      status: "success",
    });
    expect(withFailedStep.spans[1]).toMatchObject({
      durationMs: 5,
      error: { message: "Database unavailable", name: "DatabaseError" },
      id: childSpanId,
      parentSpanId: rootSpanId,
      status: "error",
    });
  });
});

describe("trace tree and waterfall builders", () => {
  it("treats missing parents as roots while preserving known parent-child links", () => {
    const tree = buildTraceTree([
      {
        durationMs: 5,
        endedAt: "2026-01-01T00:00:00.015Z",
        id: childSpanId,
        kind: "step",
        label: "Child",
        parentSpanId: rootSpanId,
        runId: "execution-1",
        startedAt: "2026-01-01T00:00:00.010Z",
        status: "success",
        step: "child",
        traceId,
      },
      {
        durationMs: 20,
        endedAt: "2026-01-01T00:00:00.020Z",
        id: rootSpanId,
        kind: "step",
        label: "Root",
        parentSpanId: null,
        runId: "execution-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "success",
        step: "root",
        traceId,
      },
      {
        durationMs: 5,
        endedAt: "2026-01-01T00:00:00.025Z",
        id: "missing-parent-child",
        kind: "step",
        label: "Missing Parent Child",
        parentSpanId: "missing-parent",
        runId: "execution-1",
        startedAt: "2026-01-01T00:00:00.020Z",
        status: "success",
        step: "orphan",
        traceId,
      },
    ]);

    expect(tree.map((node) => node.id)).toEqual([
      rootSpanId,
      "missing-parent-child",
    ]);
    expect(tree[0]?.children.map((node) => node.id)).toEqual([childSpanId]);
    expect(tree[1]?.children).toEqual([]);
  });

  it("computes waterfall offsets, durations, parent labels, and empty state", () => {
    expect(buildTraceWaterfall([], "2026-01-01T00:00:00.000Z")).toEqual({
      rows: [],
      tickMs: 100,
      tickValues: [0, 100],
      totalDurationMs: 1,
    });

    const waterfall = buildTraceWaterfall(
      [
        {
          durationMs: null,
          endedAt: "2026-01-01T00:00:05.000Z",
          id: rootSpanId,
          kind: "step",
          label: "Root",
          parentSpanId: null,
          runId: "execution-1",
          startedAt: "2026-01-01T00:00:01.000Z",
          status: "success",
          step: "root",
          traceId,
        },
        {
          durationMs: 4000,
          endedAt: "2026-01-01T00:00:07.000Z",
          id: childSpanId,
          kind: "step",
          label: "Child",
          parentSpanId: rootSpanId,
          runId: "execution-1",
          startedAt: "2026-01-01T00:00:03.000Z",
          status: "success",
          step: "child",
          traceId,
        },
      ],
      "2026-01-01T00:00:00.000Z"
    );

    expect(waterfall.totalDurationMs).toBe(7000);
    expect(waterfall.rows).toHaveLength(2);
    expect(waterfall.rows[0]).toMatchObject({
      depth: 0,
      durationMs: 4000,
      id: rootSpanId,
      offsetMs: 1000,
      parentLabel: "",
    });
    expect(waterfall.rows[1]).toMatchObject({
      depth: 1,
      durationMs: 4000,
      id: childSpanId,
      offsetMs: 3000,
      parentLabel: "Root",
    });
  });
});

describe("trace formatting helpers", () => {
  it("formats durations with stable compact units", () => {
    expect(formatTraceDuration(null)).toBe("");
    expect(formatTraceDuration(12.4)).toBe("12 ms");
    expect(formatTraceDuration(1250)).toBe("1.3 s");
    expect(formatTraceDuration(65_000)).toBe("1m 5s");
  });
});
