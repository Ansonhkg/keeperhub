import { createInMemoryTraceStore } from "@keeperhub/trace-sdk/server";
import { beforeEach, describe, expect, it } from "vitest";
import { recordBuilderEventTrace } from "../../../lib/agentic-builder/builder-trace";
import { createKeeperTraceProviders } from "../../../lib/trace/providers";
import {
  recordWorkflowStepEnd,
  recordWorkflowStepStart,
  startWorkflowTraceRun,
  withWorkflowTraceContext,
} from "../../../lib/trace/workflow-trace";

describe("KeeperHub trace providers", () => {
  beforeEach(() => {
    process.env.KEEPERHUB_FEATURE_TRACE = "true";
    process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_TRACE = "true";
  });

  it("wires store, context, event bus, propagation, and recorder", async () => {
    const store = createInMemoryTraceStore();
    const providers = createKeeperTraceProviders({ store });
    const received: string[] = [];
    providers.eventBus.subscribe("execution-1", (event) => {
      received.push(event.type);
    });

    await providers.recorder.record({
      at: "2026-01-01T00:00:00.000Z",
      runId: "execution-1",
      traceId: "1234567890abcdef1234567890abcdef",
      type: "run:start",
    });

    await providers.contextProvider.run(
      { runId: "execution-1", traceId: "1234567890abcdef1234567890abcdef" },
      () => {
        expect(providers.contextProvider.get()?.runId).toBe("execution-1");
      }
    );

    expect(received).toEqual(["run:start"]);
    expect(
      providers.propagationProvider.parse(
        providers.propagationProvider.format({
          parentSpanId: "1234567890abcdef",
          traceId: "1234567890abcdef1234567890abcdef",
        })
      )
    ).toMatchObject({ traceId: "1234567890abcdef1234567890abcdef" });
  });

  it("records workflow trace helpers through the provider seam", async () => {
    const store = createInMemoryTraceStore();
    const providers = createKeeperTraceProviders({ store });
    const context = await startWorkflowTraceRun(
      {
        executionId: "execution-helpers",
        organizationId: "org-1",
        trigger: "manual",
        userId: "user-1",
        workflowId: "workflow-1",
      },
      providers
    );

    await withWorkflowTraceContext(
      context!,
      async () => {
        await recordWorkflowStepStart(
          {
            actionType: "http.request",
            label: "HTTP Request",
            nodeId: "node-1",
            parentSpanId: null,
            spanId: "1234567890abcdef",
          },
          providers
        );
        await recordWorkflowStepEnd(
          { output: { ok: true }, spanId: "1234567890abcdef" },
          providers
        );
      },
      providers
    );

    const run = await store.getRun("execution-helpers");
    expect(run).toMatchObject({
      capability: "workflow",
      runId: "execution-helpers",
      status: "running",
    });
    expect(run?.spans[0]).toMatchObject({
      label: "HTTP Request",
      output: { ok: true },
      status: "success",
    });
  });

  it("records builder lifecycle events as diagnostic spans in the active trace", async () => {
    const store = createInMemoryTraceStore();
    const providers = createKeeperTraceProviders({ store });

    await providers.recorder.record({
      at: "2026-01-01T00:00:00.000Z",
      attributes: { capability: "builder", origin: "test" },
      runId: "builder-run-1",
      traceId: "1234567890abcdef1234567890abcdef",
      type: "run:start",
    });

    await providers.contextProvider.run(
      {
        runId: "builder-run-1",
        traceId: "1234567890abcdef1234567890abcdef",
      },
      async () => {
        await recordBuilderEventTrace(
          {
            actor: {
              actorType: "user",
              organizationId: "org-1",
              scopes: ["builder:write"],
              userId: "user-1",
            },
            createdAt: "2026-01-01T00:00:01.000Z",
            eventKind: "lifecycle",
            id: "builder-event-1",
            payload: {
              acceptedCount: 2,
              rejectedCount: 1,
            },
            phaseStatus: "completed",
            sessionId: "builder-session-1",
            stage: "candidate_evaluation",
          },
          providers
        );
      }
    );

    const run = await store.getRun("builder-run-1");
    expect(run?.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "builder",
          label: "Builder candidate_evaluation",
          status: "success",
          step: "builder.candidate_evaluation",
        }),
      ])
    );
    expect(run?.spans[0]?.attributes).toMatchObject({
      builderSessionId: "builder-session-1",
      builderStage: "candidate_evaluation",
    });
  });

  it("keeps workflow trace helpers fail-soft", async () => {
    const failingProviders = createKeeperTraceProviders({
      store: {
        ...createInMemoryTraceStore(),
        recordEvent() {
          return Promise.reject(new Error("db unavailable"));
        },
      },
    });

    await expect(
      startWorkflowTraceRun(
        {
          executionId: "execution-fail-soft",
          userId: "user-1",
          workflowId: "workflow-1",
        },
        failingProviders
      )
    ).resolves.toMatchObject({ runId: "execution-fail-soft" });
  });
});
