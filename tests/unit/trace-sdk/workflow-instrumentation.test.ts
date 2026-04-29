import {
  createAsyncLocalTraceContextProvider,
  createInMemoryTraceEventBus,
  createInMemoryTraceStore,
  createTracePropagationProvider,
  createTraceRecorder,
} from "@keeperhub/trace-sdk/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const providersMock = vi.hoisted(() => vi.fn());
const safeFetchMock = vi.hoisted(() => vi.fn());
const logStepStartDbMock = vi.hoisted(() => vi.fn());
const logStepCompleteDbMock = vi.hoisted(() => vi.fn());
const logWorkflowCompleteDbMock = vi.hoisted(() => vi.fn());
const TRACEPARENT_PATTERN =
  /^00-1234567890abcdef1234567890abcdef-[a-f0-9]{16}-01$/;

vi.mock("@/lib/trace/providers", () => ({
  getKeeperTraceProviders: providersMock,
}));

vi.mock("@/lib/workflow-logging", () => ({
  incrementCompletedSteps: vi.fn().mockResolvedValue(undefined),
  logStepCompleteDb: logStepCompleteDbMock,
  logStepStartDb: logStepStartDbMock,
  logWorkflowCompleteDb: logWorkflowCompleteDbMock,
  updateCurrentStep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logging", () => ({
  ErrorCategory: { WORKFLOW_ENGINE: "workflow_engine" },
  logSystemError: vi.fn(),
}));

vi.mock("@/lib/metrics/instrumentation/workflow", () => ({
  recordStepMetrics: vi.fn(),
}));

vi.mock("@/lib/step-success-tracker", () => ({
  recordStepSuccess: vi.fn(),
}));

vi.mock("@/lib/safe-fetch", () => ({
  safeFetch: safeFetchMock,
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

async function seedRun(
  store: ReturnType<typeof createInMemoryTraceStore>,
  runId = "exec-trace-1"
) {
  await store.recordEvent({
    at: "2026-01-01T00:00:00.000Z",
    attributes: {
      capability: "workflow",
      executionId: runId,
      organizationId: "org-1",
      userId: "user-1",
      workflowId: "workflow-1",
    },
    runId,
    traceId: "1234567890abcdef1234567890abcdef",
    type: "run:start",
  });
}

describe("workflow trace instrumentation", () => {
  beforeEach(() => {
    process.env.KEEPERHUB_FEATURE_TRACE = "true";
    process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_TRACE = "true";
    vi.resetModules();
    vi.clearAllMocks();
    logStepStartDbMock.mockResolvedValue({
      logId: "log-1",
      startTime: Date.now() - 10,
    });
    logStepCompleteDbMock.mockResolvedValue(undefined);
    logWorkflowCompleteDbMock.mockResolvedValue({ status: "success" });
    safeFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );
    providersMock.mockReturnValue(createTestProviders());
  });

  it("no-ops workflow trace recording when the feature flag is disabled", async () => {
    process.env.KEEPERHUB_FEATURE_TRACE = "false";
    process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_TRACE = "false";
    providersMock.mockClear();
    const { recordWorkflowStepStart, startWorkflowTraceRun } = await import(
      "../../../lib/trace/workflow-trace"
    );

    const context = await startWorkflowTraceRun({
      executionId: "exec-disabled",
      userId: "user-1",
      workflowId: "workflow-1",
    });
    const spanId = await recordWorkflowStepStart({
      actionType: "HTTP Request",
      label: "HTTP Request",
      nodeId: "node-1",
      traceContext: {
        runId: "exec-disabled",
        traceId: "1234567890abcdef1234567890abcdef",
      },
    });

    expect(context).toBeNull();
    expect(spanId).toBeNull();
    expect(providersMock).not.toHaveBeenCalled();
  });

  it("emits step start and end traces from withStepLogging without replacing execution logs", async () => {
    const providers = createTestProviders();
    providersMock.mockReturnValue(providers);
    await seedRun(providers.store);
    const { withStepLogging } = await import("../../../lib/steps/step-handler");

    const result = await withStepLogging(
      {
        _context: {
          executionId: "exec-trace-1",
          nodeId: "node-1",
          nodeName: "HTTP Request",
          nodeType: "http.request",
          organizationId: "org-1",
          traceContext: {
            runId: "exec-trace-1",
            traceId: "1234567890abcdef1234567890abcdef",
          },
          workflowId: "workflow-1",
        },
        url: "https://example.com",
      },
      async () => ({ ok: true })
    );

    const run = await providers.store.getRun("exec-trace-1");
    expect(result).toEqual({ ok: true });
    expect(logStepStartDbMock).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: "exec-trace-1" })
    );
    expect(logStepCompleteDbMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" })
    );
    expect(run?.events.map((event) => event.type)).toContain("step:start");
    expect(run?.events.map((event) => event.type)).toContain("step:end");
    expect(run?.spans[0]).toMatchObject({
      label: "HTTP Request",
      status: "success",
      step: "http.request",
    });
  });

  it("emits step:error for returned error results and thrown errors", async () => {
    const providers = createTestProviders();
    providersMock.mockReturnValue(providers);
    await seedRun(providers.store);
    const { withStepLogging } = await import("../../../lib/steps/step-handler");
    const context = {
      executionId: "exec-trace-1",
      nodeId: "node-error",
      nodeName: "Failing Step",
      nodeType: "plugin/fail",
      traceContext: {
        runId: "exec-trace-1",
        traceId: "1234567890abcdef1234567890abcdef",
      },
      workflowId: "workflow-1",
    };

    await withStepLogging({ _context: context }, async () => ({
      success: false,
      error: "bad response",
    }));
    await expect(
      withStepLogging({ _context: context }, () =>
        Promise.reject(new Error("boom"))
      )
    ).rejects.toThrow("boom");

    const run = await providers.store.getRun("exec-trace-1");
    expect(
      run?.events.filter((event) => event.type === "step:error")
    ).toHaveLength(2);
  });

  it("emits workflow completion traces from logWorkflowComplete", async () => {
    const providers = createTestProviders();
    providersMock.mockReturnValue(providers);
    await seedRun(providers.store);
    const { logWorkflowComplete } = await import(
      "../../../lib/steps/step-handler"
    );

    await logWorkflowComplete({
      executionId: "exec-trace-1",
      output: { ok: true },
      startTime: Date.now() - 50,
      status: "success",
      traceContext: {
        runId: "exec-trace-1",
        traceId: "1234567890abcdef1234567890abcdef",
      },
    });

    const run = await providers.store.getRun("exec-trace-1");
    expect(logWorkflowCompleteDbMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" })
    );
    expect(run).toMatchObject({ status: "success" });
    expect(run?.events.map((event) => event.type)).toContain("run:success");
  });

  it("adds traceparent to HTTP Request outbound fetch when trace context exists", async () => {
    const providers = createTestProviders();
    providersMock.mockReturnValue(providers);
    await seedRun(providers.store);
    const { httpRequestStep } = await import("../../../lib/steps/http-request");

    await httpRequestStep({
      _context: {
        executionId: "exec-trace-1",
        nodeId: "node-http",
        nodeName: "HTTP Request",
        nodeType: "HTTP Request",
        traceContext: {
          runId: "exec-trace-1",
          traceId: "1234567890abcdef1234567890abcdef",
        },
        workflowId: "workflow-1",
      },
      endpoint: "https://example.com/api",
      httpMethod: "GET",
    });

    expect(safeFetchMock).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({
        headers: expect.objectContaining({
          traceparent: expect.stringMatching(TRACEPARENT_PATTERN),
        }),
      })
    );
  });
});
