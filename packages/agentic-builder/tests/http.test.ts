import { describe, expect, it, vi } from "vitest";
import { createHttpHandlers } from "../src/adapters/http/handlers";
import type { BuilderRuntime } from "../src/core/services/runtime";

const auth = {
  actorType: "user" as const,
  organizationId: "org-1",
  scopes: ["builder:write"],
  userId: "user-1",
};

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

describe("agentic builder HTTP handlers", () => {
  it("starts sessions, selects options with revision, and streams events", async () => {
    const runtime = {
      startSession: vi.fn(async () => projection),
      selectOption: vi.fn(async () => projection),
      getEvents: vi.fn(async () => [
        {
          actor: auth,
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "event-1",
          phaseStatus: "completed",
          sessionId: "session-1",
          stage: "intent_planner",
          templateName: "intent-decomposer",
          templateVersion: "1.0.0",
          type: "builder.lifecycle",
        },
      ]),
    } as unknown as BuilderRuntime;
    const handlers = createHttpHandlers(runtime, async () => auth);

    const started = await handlers.startSession(
      new Request("http://test/builder/sessions", {
        body: JSON.stringify({
          context: '{"nodes":[{"id":"step-1"}]}',
          prompt: "Track ETH",
        }),
        method: "POST",
      })
    );
    const selected = await handlers.selectOption(
      new Request("http://test/builder/sessions/session-1/options/option-1", {
        body: JSON.stringify({ expectedRevision: 3 }),
        method: "POST",
      }),
      "session-1",
      "option-1"
    );
    const events = await handlers.getEvents(
      new Request("http://test/builder/sessions/session-1/events"),
      "session-1"
    );

    expect(started.status).toBe(200);
    expect(selected.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    expect(runtime.startSession).toHaveBeenCalledWith(
      auth,
      "Track ETH",
      '{"nodes":[{"id":"step-1"}]}'
    );
    expect(runtime.selectOption).toHaveBeenCalledWith(
      auth,
      "session-1",
      "option-1",
      3
    );
  });

  it("rejects missing prompts before runtime mutation", async () => {
    const runtime = { startSession: vi.fn() } as unknown as BuilderRuntime;
    const handlers = createHttpHandlers(runtime, async () => auth);

    const response = await handlers.startSession(
      new Request("http://test/builder/sessions", {
        body: JSON.stringify({ prompt: "" }),
        method: "POST",
      })
    );

    expect(response.status).toBe(400);
    expect(runtime.startSession).not.toHaveBeenCalled();
  });
});
