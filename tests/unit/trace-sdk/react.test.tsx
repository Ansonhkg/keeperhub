import type { DiagnosticRun } from "@keeperhub/trace-sdk/core";
import {
  DiagnosticsRunInspector,
  initialDiagnosticRunStreamState,
  LiveTraceInspector,
  reduceDiagnosticRunStreamState,
  TraceReactAdapterProvider,
} from "@keeperhub/trace-sdk/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const sampleRun: DiagnosticRun = {
  actor: "user-1",
  attributes: { capability: "workflow" },
  capability: "workflow",
  createdAt: "2026-01-01T00:00:00.000Z",
  durationMs: 40,
  endedAt: "2026-01-01T00:00:00.040Z",
  error: null,
  eventCount: 3,
  events: [
    {
      at: "2026-01-01T00:00:00.000Z",
      attributes: null,
      durationMs: null,
      error: null,
      id: "event-1",
      parentSpanId: null,
      payload: null,
      runId: "run-1",
      spanId: null,
      traceId: "1234567890abcdef1234567890abcdef",
      type: "run:start",
    },
  ],
  lastEventType: "run:success",
  links: [
    {
      attributes: { fromNodeId: "trigger", toNodeId: "action" },
      id: "link-1",
      linkedSpanId: "aaaaaaaaaaaaaaaa",
      runId: "run-1",
      spanId: "bbbbbbbbbbbbbbbb",
      traceId: "1234567890abcdef1234567890abcdef",
      type: "edge",
    },
  ],
  mode: "",
  origin: "",
  platform: "",
  provider: "",
  runId: "run-1",
  spanCount: 2,
  spans: [
    {
      attributes: { nodeId: "trigger" },
      durationMs: 10,
      endedAt: "2026-01-01T00:00:00.010Z",
      error: null,
      id: "aaaaaaaaaaaaaaaa",
      input: { hello: "world" },
      kind: "step",
      label: "Trigger",
      output: { ok: true },
      parentSpanId: null,
      runId: "run-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "success",
      step: "trigger",
      traceId: "1234567890abcdef1234567890abcdef",
    },
    {
      attributes: { nodeId: "action" },
      durationMs: 20,
      endedAt: "2026-01-01T00:00:00.035Z",
      error: null,
      id: "bbbbbbbbbbbbbbbb",
      input: null,
      kind: "step",
      label: "HTTP Request",
      output: { ok: true },
      parentSpanId: "aaaaaaaaaaaaaaaa",
      runId: "run-1",
      startedAt: "2026-01-01T00:00:00.015Z",
      status: "success",
      step: "http.request",
      traceId: "1234567890abcdef1234567890abcdef",
    },
  ],
  startedAt: "2026-01-01T00:00:00.000Z",
  status: "success",
  traceId: "1234567890abcdef1234567890abcdef",
  trigger: "manual",
  updatedAt: "2026-01-01T00:00:00.040Z",
};

describe("trace SDK React package", () => {
  it("renders a reusable run inspector with copy actions and span links", () => {
    const html = renderToStaticMarkup(
      <TraceReactAdapterProvider>
        <DiagnosticsRunInspector
          run={sampleRun}
          selectedSpanId="bbbbbbbbbbbbbbbb"
        />
      </TraceReactAdapterProvider>
    );

    expect(html).toContain("run-1");
    expect(html).toContain("Copy run ID");
    expect(html).toContain("HTTP Request");
    expect(html).toContain("Span links");
  });

  it("renders stream states in the live inspector", () => {
    const html = renderToStaticMarkup(
      <LiveTraceInspector run={sampleRun} streamUrl={null} />
    );
    expect(html).toContain("Live trace");
    expect(html).toContain("Closed");
  });

  it("reduces diagnostic stream state transitions", () => {
    const live = reduceDiagnosticRunStreamState(
      initialDiagnosticRunStreamState,
      { type: "connect" }
    );
    const snapshot = reduceDiagnosticRunStreamState(live, {
      run: sampleRun,
      type: "snapshot",
    });
    const stale = reduceDiagnosticRunStreamState(snapshot, { type: "stale" });
    const closed = reduceDiagnosticRunStreamState(stale, { type: "close" });

    expect(live.status).toBe("live");
    expect(snapshot.run?.runId).toBe("run-1");
    expect(stale.status).toBe("stale");
    expect(closed.status).toBe("closed");
  });
});
