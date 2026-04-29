import {
  createAsyncLocalTraceContextProvider,
  createInMemoryTraceEventBus,
  createInMemoryTraceStore,
  createTracePropagationProvider,
  createTraceRecorder,
} from "@keeperhub/trace-sdk/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const providersMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/middleware/auth-helpers", () => ({
  getDualAuthContext: authMock,
}));

vi.mock("@/lib/trace/providers", () => ({
  getKeeperTraceProviders: providersMock,
}));

function createTestProviders() {
  const store = createInMemoryTraceStore();
  const eventBus = createInMemoryTraceEventBus();
  const contextProvider = createAsyncLocalTraceContextProvider();
  return {
    contextProvider,
    eventBus,
    propagationProvider: createTracePropagationProvider(),
    recorder: createTraceRecorder({ contextProvider, eventBus, store }),
    store,
  };
}

describe("diagnostics API routes", () => {
  beforeEach(() => {
    process.env.KEEPERHUB_FEATURE_TRACE = "true";
    process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_TRACE = "true";
    vi.resetModules();
    vi.clearAllMocks();
    authMock.mockResolvedValue({ organizationId: "org-1", userId: "user-1" });
    providersMock.mockReturnValue(createTestProviders());
  });

  it("returns 404 when Trace is disabled", async () => {
    process.env.KEEPERHUB_FEATURE_TRACE = "false";
    process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_TRACE = "false";
    const summaryRoute = await import(
      "../../../app/api/diagnostics/summary/route"
    );

    const response = await summaryRoute.GET(
      new Request("http://keeper.test/api/diagnostics/summary")
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Trace is disabled",
      ok: false,
    });
    expect(authMock).not.toHaveBeenCalled();
    expect(providersMock).not.toHaveBeenCalled();
  });

  it("returns summary and run list envelopes", async () => {
    const providers = createTestProviders();
    providersMock.mockReturnValue(providers);
    await providers.store.recordEvent({
      at: "2026-01-01T00:00:00.000Z",
      attributes: {
        capability: "workflow",
        organizationId: "org-1",
        userId: "user-1",
      },
      runId: "run-list-1",
      traceId: "1234567890abcdef1234567890abcdef",
      type: "run:start",
    });

    const summaryRoute = await import(
      "../../../app/api/diagnostics/summary/route"
    );
    const runsRoute = await import("../../../app/api/diagnostics/runs/route");
    const summary = await summaryRoute.GET(
      new Request("http://keeper.test/api/diagnostics/summary")
    );
    const runs = await runsRoute.GET(
      new Request("http://keeper.test/api/diagnostics/runs?page=0&pageSize=10")
    );

    await expect(summary.json()).resolves.toMatchObject({
      ok: true,
      summary: { totalRuns: 1 },
    });
    await expect(runs.json()).resolves.toMatchObject({
      capabilities: ["workflow"],
      ok: true,
      page: 0,
      pageSize: 10,
      runs: [{ runId: "run-list-1" }],
      total: 1,
    });
  });

  it("returns run detail or 404", async () => {
    const providers = createTestProviders();
    providersMock.mockReturnValue(providers);
    await providers.store.recordEvent({
      at: "2026-01-01T00:00:00.000Z",
      attributes: { organizationId: "org-1", userId: "user-1" },
      runId: "run-detail-1",
      traceId: "1234567890abcdef1234567890abcdef",
      type: "run:start",
    });

    const detailRoute = await import(
      "../../../app/api/diagnostics/runs/[runId]/route"
    );
    const found = await detailRoute.GET(
      new Request("http://keeper.test/api/diagnostics/runs/run-detail-1"),
      {
        params: Promise.resolve({ runId: "run-detail-1" }),
      }
    );
    const missing = await detailRoute.GET(
      new Request("http://keeper.test/api/diagnostics/runs/missing"),
      {
        params: Promise.resolve({ runId: "missing" }),
      }
    );

    await expect(found.json()).resolves.toMatchObject({
      ok: true,
      run: { runId: "run-detail-1" },
    });
    expect(missing.status).toBe(404);
  });

  it("cleans up runs and accepts event ingestion fail-soft", async () => {
    const providers = createTestProviders();
    providersMock.mockReturnValue(providers);

    const runsRoute = await import("../../../app/api/diagnostics/runs/route");
    const eventsRoute = await import(
      "../../../app/api/diagnostics/events/route"
    );
    const ingest = await eventsRoute.POST(
      new Request("http://keeper.test/api/diagnostics/events", {
        body: JSON.stringify({
          at: "2026-01-01T00:00:00.000Z",
          runId: "run-event-1",
          traceId: "1234567890abcdef1234567890abcdef",
          type: "run:start",
        }),
        method: "POST",
      })
    );
    const cleanup = await runsRoute.DELETE(
      new Request("http://keeper.test/api/diagnostics/runs?retentionDays=30", {
        method: "DELETE",
      })
    );

    await expect(ingest.json()).resolves.toMatchObject({
      async: true,
      ok: true,
      recorded: 1,
    });
    await expect(cleanup.json()).resolves.toMatchObject({
      kept: expect.any(Number),
      ok: true,
      removed: expect.any(Number),
    });
  });

  it("opens a run stream with an initial snapshot", async () => {
    const providers = createTestProviders();
    providersMock.mockReturnValue(providers);
    await providers.store.recordEvent({
      at: "2026-01-01T00:00:00.000Z",
      attributes: { organizationId: "org-1", userId: "user-1" },
      runId: "run-stream-1",
      traceId: "1234567890abcdef1234567890abcdef",
      type: "run:start",
    });

    const streamRoute = await import(
      "../../../app/api/diagnostics/runs/[runId]/stream/route"
    );
    const response = await streamRoute.GET(
      new Request(
        "http://keeper.test/api/diagnostics/runs/run-stream-1/stream"
      ),
      {
        params: Promise.resolve({ runId: "run-stream-1" }),
      }
    );
    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    await reader?.cancel();

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(new TextDecoder().decode(chunk?.value)).toContain("event: snapshot");
  });
});
