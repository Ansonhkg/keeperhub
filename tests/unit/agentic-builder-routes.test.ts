import { describe, expect, it, vi } from "vitest";

const { runtime } = vi.hoisted(() => ({
  runtime: {
    answerQuestion: vi.fn(),
    cancelSession: vi.fn(),
    getEvents: vi.fn(),
    getProjection: vi.fn(),
    materializeWorkflow: vi.fn(),
    regenerateFromNode: vi.fn(),
    rejectOption: vi.fn(),
    requestNativeCapability: vi.fn(),
    selectOption: vi.fn(),
    startSession: vi.fn(),
  },
}));

vi.mock("@/lib/agentic-builder/keeperhub-runtime", () => ({
  keeperHubBuilderRuntime: runtime,
}));

vi.mock("@/lib/agentic-builder/keeperhub-auth", () => ({
  resolveBuilderAuthContext: async () => ({
    actorType: "user",
    organizationId: "org-1",
    scopes: ["builder:write"],
    userId: "user-1",
  }),
}));

const projection = {
  candidateBranches: [],
  committed: { edges: [], id: "session-1", nodes: [] },
  headCommitId: "commit-1",
  options: [],
  questions: [],
  sessionId: "session-1",
  timeline: [],
  validation: { issues: [], valid: true },
};

describe("Next agentic builder routes", () => {
  it("routes POST /api/builder/sessions to the builder runtime", async () => {
    runtime.startSession.mockResolvedValueOnce(projection);
    const { POST } = await import("@/app/api/builder/sessions/route");

    const response = await POST(
      new Request("http://test/api/builder/sessions", {
        body: JSON.stringify({ prompt: "Track ETH" }),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(runtime.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" }),
      "Track ETH",
      undefined
    );
  });

  it("routes existing workflow context into the builder runtime", async () => {
    runtime.startSession.mockResolvedValueOnce(projection);
    const { POST } = await import("@/app/api/builder/sessions/route");

    const response = await POST(
      new Request("http://test/api/builder/sessions", {
        body: JSON.stringify({
          context: JSON.stringify({ nodes: [{ id: "step-1" }] }),
          prompt: "Add Slack notification",
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(runtime.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" }),
      "Add Slack notification",
      '{"nodes":[{"id":"step-1"}]}'
    );
  });

  it("routes option selection params and expected revisions", async () => {
    runtime.selectOption.mockResolvedValueOnce(projection);
    const { POST } = await import(
      "@/app/api/builder/sessions/[sessionId]/options/[optionId]/select/route"
    );

    const response = await POST(
      new Request(
        "http://test/api/builder/sessions/session-1/options/option-1/select",
        {
          body: JSON.stringify({ expectedRevision: 7 }),
          method: "POST",
        }
      ),
      {
        params: Promise.resolve({
          optionId: "option-1",
          sessionId: "session-1",
        }),
      }
    );

    expect(response.status).toBe(200);
    expect(runtime.selectOption).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "session-1",
      "option-1",
      7
    );
  });

  it("routes projection and event reads", async () => {
    runtime.getProjection.mockResolvedValue(projection);
    runtime.getEvents.mockResolvedValue([
      {
        actor: {
          actorType: "user",
          organizationId: "org-1",
          scopes: ["builder:write"],
          userId: "user-1",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "event-1",
        phaseStatus: "completed",
        sessionId: "session-1",
        stage: "session.start",
        templateName: "intent-decomposer",
        templateVersion: "1.0.0",
        type: "builder.lifecycle",
      },
    ]);
    const projectionRoute = await import(
      "@/app/api/builder/sessions/[sessionId]/projection/route"
    );
    const sessionRoute = await import(
      "@/app/api/builder/sessions/[sessionId]/route"
    );
    const eventsRoute = await import(
      "@/app/api/builder/sessions/[sessionId]/events/route"
    );

    const params = { params: Promise.resolve({ sessionId: "session-1" }) };
    const projectionResponse = await projectionRoute.GET(
      new Request("http://test/api/builder/sessions/session-1/projection"),
      params
    );
    const sessionResponse = await sessionRoute.GET(
      new Request("http://test/api/builder/sessions/session-1"),
      params
    );
    const eventsResponse = await eventsRoute.GET(
      new Request("http://test/api/builder/sessions/session-1/events"),
      params
    );

    expect(projectionResponse.status).toBe(200);
    expect(sessionResponse.status).toBe(200);
    expect(eventsResponse.headers.get("content-type")).toContain(
      "text/event-stream"
    );
    expect(runtime.getProjection).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" }),
      "session-1"
    );
    expect(runtime.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" }),
      "session-1"
    );
  });

  it("routes builder mutation endpoints with session params", async () => {
    runtime.rejectOption.mockResolvedValue(projection);
    runtime.answerQuestion.mockResolvedValue(projection);
    runtime.regenerateFromNode.mockResolvedValue(projection);
    runtime.requestNativeCapability.mockResolvedValue(projection);
    runtime.materializeWorkflow.mockResolvedValue(projection);
    runtime.cancelSession.mockResolvedValue(projection);
    const rejectRoute = await import(
      "@/app/api/builder/sessions/[sessionId]/options/[optionId]/reject/route"
    );
    const answerRoute = await import(
      "@/app/api/builder/sessions/[sessionId]/questions/[questionId]/answer/route"
    );
    const regenerateRoute = await import(
      "@/app/api/builder/sessions/[sessionId]/regenerate-from-node/route"
    );
    const featureRoute = await import(
      "@/app/api/builder/sessions/[sessionId]/feature-requests/route"
    );
    const materializeRoute = await import(
      "@/app/api/builder/sessions/[sessionId]/materialize/route"
    );
    const cancelRoute = await import(
      "@/app/api/builder/sessions/[sessionId]/cancel/route"
    );

    await rejectRoute.POST(
      new Request("http://test/reject", { body: "{}", method: "POST" }),
      {
        params: Promise.resolve({
          optionId: "option-1",
          sessionId: "session-1",
        }),
      }
    );
    await answerRoute.POST(
      new Request("http://test/answer", {
        body: JSON.stringify({ answer: "Slack" }),
        method: "POST",
      }),
      {
        params: Promise.resolve({
          questionId: "question-1",
          sessionId: "session-1",
        }),
      }
    );
    await regenerateRoute.POST(
      new Request("http://test/regenerate", {
        body: JSON.stringify({ kind: "after_node", nodeId: "step-1" }),
        method: "POST",
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    await featureRoute.POST(
      new Request("http://test/feature", {
        body: JSON.stringify({ id: "missing-1" }),
        method: "POST",
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    await materializeRoute.POST(
      new Request("http://test/materialize", {
        body: JSON.stringify({
          idempotencyKey: "idem-1",
          mode: "create",
          name: "ETH alert",
        }),
        method: "POST",
      }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );
    await cancelRoute.POST(
      new Request("http://test/cancel", { body: "{}", method: "POST" }),
      { params: Promise.resolve({ sessionId: "session-1" }) }
    );

    expect(runtime.rejectOption).toHaveBeenCalledWith(
      expect.any(Object),
      "session-1",
      "option-1"
    );
    expect(runtime.answerQuestion).toHaveBeenCalledWith(
      expect.any(Object),
      "session-1",
      { answer: "Slack", questionId: "question-1" }
    );
    expect(runtime.regenerateFromNode).toHaveBeenCalledWith(
      expect.any(Object),
      "session-1",
      { kind: "after_node", nodeId: "step-1" }
    );
    expect(runtime.requestNativeCapability).toHaveBeenCalledWith(
      expect.any(Object),
      "session-1",
      { id: "missing-1" }
    );
    expect(runtime.materializeWorkflow).toHaveBeenCalledWith(
      expect.any(Object),
      "session-1",
      { idempotencyKey: "idem-1", mode: "create", name: "ETH alert" }
    );
    expect(runtime.cancelSession).toHaveBeenCalledWith(
      expect.any(Object),
      "session-1"
    );
  });
});
