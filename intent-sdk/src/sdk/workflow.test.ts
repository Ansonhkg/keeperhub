import { describe, expect, test } from "vitest";

import { capability } from "./builder.js";
import { createHook, done, harness, step } from "./harness.js";
import { domain, primitive } from "./intent.js";
import { createWorkflow, type WorkflowEvent } from "./workflow.js";

describe("workflow event streams", () => {
  test("can replay a previous in-memory run from an event index", async () => {
    const workflowDomain = domain({
      id: "workflow",
      intent: {
        resolve: () => ({
          kind: "intent_contract",
          requirements: [
            {
              id: "source",
              label: "Source",
              required: true,
              status: "satisfied",
              type: "string",
              value: "source-1",
            },
          ],
          steps: [
            {
              id: "step_read",
              label: "Read source",
              primitive: "read",
              requirementIds: ["source"],
            },
          ],
        }),
      },
      primitives: [primitive({ id: "read", description: "Reads data." })],
    });
    const workflow = createWorkflow({
      capabilities: [
        capability({
          id: "source.read",
          primitive: "read",
          title: "Read source",
        }),
      ],
      createArtifact: ({ plan }) => ({ plan }),
      domain: workflowDomain,
    });
    const result = await workflow.run({
      prompt: "Read source.",
      runId: "run_workflow_replay",
    });

    const stream = workflow.stream({
      fromIndex: 2,
      prompt: "ignored during replay",
      runId: result.runId,
    });
    const replayed: WorkflowEvent[] = [];
    for await (const event of stream.events) {
      replayed.push(event);
    }

    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed.every((event) => event.index >= 2)).toBe(true);
    expect(replayed.map((event) => event.index)).toEqual(
      result.events
        .filter((event) => event.index >= 2)
        .map((event) => event.index)
    );
    expect(
      replayed.every((event) => event.runId === "run_workflow_replay")
    ).toBe(true);
  });
});

describe("workflow hook streams", () => {
  test("stream exposes hook events and can resume by token", async () => {
    const approvalHook = createHook<{ prompt: string }, string>({
      id: "approval.required",
    });
    const app = harness({
      id: "hook.stream",
      steps: [
        step("approve", async (context) => {
          const value = await context.waitFor(approvalHook, {
            prompt: "Approve this action?",
          });
          return done({ value });
        }),
      ],
    });
    const queueEvents: unknown[] = [];
    const session = await app.start("input", {
      onEvent(event) {
        queueEvents.push(event);
      },
      runId: "run_hook_stream",
    });
    const token = session.pendingHooks[0]!.token;

    await session.resumeHook({ token, value: "approved" });

    expect(queueEvents).toEqual(session.events);
    expect(session.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "hook.created",
        "hook.waiting",
        "hook.resumed",
        "run.completed",
      ])
    );
    expect(session.state.value).toBe("approved");
  });
});
