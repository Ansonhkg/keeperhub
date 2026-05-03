import {
  type ArtifactRunner,
  type Capability,
  type CapabilityCatalog,
  type CapabilityPlan,
  capabilities as createCapabilities,
  type RunnerCheck,
} from "./builder";
import {
  ask,
  done,
  type EventPayload,
  type EventRecord,
  type EventSink,
  fail,
  type HarnessCheckpoint,
  type HarnessStatus,
  type HookRequest,
  harness,
  retry,
  step,
} from "./harness";
import type { Domain, IntentContract, Question } from "./intent";

export type WorkflowEvent = EventRecord;

export type WorkflowArtifactArgs = {
  emit: (event: EventPayload) => void;
  intent: IntentContract;
  plan: CapabilityPlan;
};

export type WorkflowRunArgs<TArtifact> = {
  artifact: TArtifact;
  emit: (event: EventPayload) => void;
  intent: IntentContract;
  plan: CapabilityPlan;
};

export type WorkflowCheckArgs<TArtifact> = {
  artifact: TArtifact;
  intent: IntentContract;
  plan: CapabilityPlan;
};

export type WorkflowRunResult = {
  runId?: string;
  status?: string;
  [key: string]: unknown;
};

export type WorkflowBuilderConfig<TArtifact> = {
  capabilities: Capability[] | CapabilityCatalog;
  checkArtifact?: (
    args: WorkflowCheckArgs<TArtifact>
  ) => Promise<RunnerCheck> | RunnerCheck;
  createArtifact: (
    args: WorkflowArtifactArgs
  ) => Promise<TArtifact> | TArtifact;
  domain: Domain;
  id?: string;
  runArtifact?: (
    args: WorkflowRunArgs<TArtifact>
  ) => Promise<WorkflowRunResult | undefined> | WorkflowRunResult | undefined;
};

export type WorkflowRunInput = {
  answers?: Record<string, unknown>;
  fromIndex?: number;
  onQuestion?: (question: Question) => Promise<unknown> | unknown;
  onEvent?: EventSink;
  prompt: string;
  runId?: string;
};

export type WorkflowRunOutput<TArtifact> = {
  artifact?: TArtifact;
  checkpoints: Array<HarnessCheckpoint<{ prompt: string }>>;
  events: WorkflowEvent[];
  pendingHooks: HookRequest[];
  intent?: IntentContract;
  pendingQuestions: Question[];
  plan?: CapabilityPlan;
  result?: WorkflowRunResult;
  runId: string;
  status: HarnessStatus;
};

type WorkflowUse<TArtifact> = {
  artifact: {
    create(args: WorkflowArtifactArgs): Promise<TArtifact> | TArtifact;
  };
  capabilities: CapabilityCatalog;
  checkArtifact?: WorkflowBuilderConfig<TArtifact>["checkArtifact"];
  runArtifact?: WorkflowBuilderConfig<TArtifact>["runArtifact"];
};

type WorkflowState<TArtifact> = {
  artifact?: TArtifact;
  intent?: IntentContract;
  plan?: CapabilityPlan;
  result?: WorkflowRunResult;
};

export function createWorkflow<TArtifact>(
  config: WorkflowBuilderConfig<TArtifact>
) {
  const workflowHarness = createWorkflowHarness(config);
  const sessions = new Map<
    string,
    Awaited<ReturnType<typeof workflowHarness.start>>
  >();
  return {
    async run(input: WorkflowRunInput): Promise<WorkflowRunOutput<TArtifact>> {
      const session = await workflowHarness.start(
        { prompt: input.prompt },
        {
          answers: input.answers,
          onEvent: input.onEvent,
          runId: input.runId,
        }
      );
      sessions.set(session.runId, session);
      while (session.status === "waiting") {
        let answered = false;
        for (const question of session.pendingQuestions) {
          if (input.answers && question.id in input.answers) {
            await session.answer({
              questionId: question.id,
              value: input.answers[question.id],
            });
            answered = true;
            continue;
          }
          if (input.onQuestion) {
            const value = await input.onQuestion(question);
            if (value !== undefined) {
              await session.answer({
                questionId: question.id,
                value,
              });
              answered = true;
            }
          }
        }
        if (!answered) {
          break;
        }
        await session.resume();
        sessions.set(session.runId, session);
      }
      return outputFromSession<TArtifact>(session);
    },

    stream(input: WorkflowRunInput) {
      const queue = new EventQueue(input.fromIndex);
      let sessionPromise:
        | Promise<Awaited<ReturnType<typeof workflowHarness.start>>>
        | undefined;
      const start = async () => {
        if (input.runId && sessions.has(input.runId)) {
          const session = sessions.get(input.runId)!;
          queue.pushMany(session.events);
          if (session.status !== "waiting") {
            queue.close();
          }
          sessionPromise = Promise.resolve(session);
          return;
        }
        sessionPromise = workflowHarness.start(
          { prompt: input.prompt },
          {
            answers: input.answers,
            onEvent(event) {
              queue.push(event);
              void input.onEvent?.(event);
            },
            runId: input.runId,
          }
        );
        const session = await sessionPromise;
        sessions.set(session.runId, session);
        if (session.status !== "waiting") {
          queue.close();
        }
      };
      void start().catch((error: unknown) => {
        queue.push({
          correlationId: `run:${input.runId ?? "unknown"}:workflow.failed`,
          index: 0,
          message: error instanceof Error ? error.message : String(error),
          runId: input.runId ?? "unknown",
          timestamp: new Date().toISOString(),
          type: "workflow.failed",
        });
        queue.close();
      });
      return {
        async answer(input: { questionId: string; value: unknown }) {
          const session = await sessionPromise;
          if (!session) throw new Error("Workflow session has not started.");
          const eventCount = session.events.length;
          await session.answer(input);
          queue.pushMany(session.events.slice(eventCount));
          sessions.set(session.runId, session);
        },
        events: queue,
        async resumeHook(input: { token: string; value: unknown }) {
          const session = await sessionPromise;
          if (!session) throw new Error("Workflow session has not started.");
          const eventCount = session.events.length;
          await session.resumeHook(input);
          queue.pushMany(session.events.slice(eventCount));
          sessions.set(session.runId, session);
          if (session.status !== "waiting") {
            queue.close();
          }
          return outputFromSession<TArtifact>(session);
        },
        async resume() {
          const session = await sessionPromise;
          if (!session) throw new Error("Workflow session has not started.");
          const eventCount = session.events.length;
          await session.resume();
          queue.pushMany(session.events.slice(eventCount));
          sessions.set(session.runId, session);
          if (session.status !== "waiting") {
            queue.close();
          }
          return outputFromSession<TArtifact>(session);
        },
        async toEventStreamResponse() {
          return eventStreamResponse(queue);
        },
      };
    },
  };
}

export async function buildWorkflow<TArtifact>(
  config: WorkflowBuilderConfig<TArtifact>,
  input: WorkflowRunInput
) {
  return createWorkflow(config).run(input);
}

export function streamWorkflow<TArtifact>(
  config: WorkflowBuilderConfig<TArtifact>,
  input: WorkflowRunInput
) {
  return createWorkflow(config).stream(input);
}

function createWorkflowHarness<TArtifact>(
  config: WorkflowBuilderConfig<TArtifact>
) {
  const catalog = Array.isArray(config.capabilities)
    ? createCapabilities({ items: config.capabilities })
    : config.capabilities;
  return harness<WorkflowUse<TArtifact>, { prompt: string }>({
    id: config.id ?? "workflow.builder",
    steps: [
      step.intent("understandRequest", {
        domain: config.domain,
      }),
      step("matchCapabilities", async ({ state, use }) => {
        const typedState = state as WorkflowState<TArtifact>;
        if (!typedState.intent) {
          return fail("Intent was not resolved.");
        }
        const match = await use.capabilities.match(typedState.intent);
        if (match.questions.length > 0) {
          return ask(match.questions);
        }
        if (match.missingCapabilities.length > 0) {
          return fail(
            `No capability is available for ${match.missingCapabilities
              .map((item) => `${item.primitive} (${item.label})`)
              .join(", ")}.`
          );
        }
        return done({ plan: match.plan });
      }),
      step("createArtifact", async ({ emit, state, use }) => {
        const typedState = state as WorkflowState<TArtifact>;
        if (!(typedState.intent && typedState.plan)) {
          return fail(
            "Cannot create an artifact before intent and plan are ready."
          );
        }
        const artifact = await use.artifact.create({
          emit,
          intent: typedState.intent,
          plan: typedState.plan,
        });
        emit({
          detail: { artifact },
          message: "Created runnable artifact.",
          type: "artifact.created",
        });
        return done({ artifact });
      }),
      step("checkArtifact", async ({ state, use }) => {
        const typedState = state as WorkflowState<TArtifact>;
        if (!(typedState.intent && typedState.plan && typedState.artifact)) {
          return fail("Cannot check an artifact before it is created.");
        }
        const readiness = use.checkArtifact
          ? await use.checkArtifact({
              artifact: typedState.artifact,
              intent: typedState.intent,
              plan: typedState.plan,
            })
          : { ok: true };
        if (!readiness.ok) {
          return retry(readiness.reason ?? "Artifact is not runnable.");
        }
        return done({ readiness });
      }),
      step("runArtifact", async ({ emit, state, use }) => {
        const typedState = state as WorkflowState<TArtifact>;
        if (!(typedState.intent && typedState.plan && typedState.artifact)) {
          return fail("Cannot run an artifact before it is created.");
        }
        const result = use.runArtifact
          ? await use.runArtifact({
              artifact: typedState.artifact,
              emit,
              intent: typedState.intent,
              plan: typedState.plan,
            })
          : undefined;
        const runResult = result ?? { status: "completed" };
        if (runResult.status === "failed") {
          const error =
            typeof runResult.error === "string"
              ? runResult.error
              : "Artifact runner failed.";
          return fail(error, { result: runResult });
        }
        return done({ result: runResult });
      }),
    ],
    use: {
      artifact: { create: config.createArtifact },
      capabilities: catalog,
      checkArtifact: config.checkArtifact,
      runArtifact: config.runArtifact,
    },
  });
}

function outputFromSession<TArtifact>(session: {
  checkpoints: Array<HarnessCheckpoint<{ prompt: string }>>;
  events: WorkflowEvent[];
  pendingHooks: HookRequest[];
  pendingQuestions: Question[];
  runId: string;
  state: Record<string, unknown>;
  status: HarnessStatus;
}): WorkflowRunOutput<TArtifact> {
  const state = session.state as WorkflowState<TArtifact>;
  return {
    artifact: state.artifact,
    checkpoints: session.checkpoints,
    events: session.events,
    intent: state.intent,
    pendingHooks: session.pendingHooks,
    pendingQuestions: session.pendingQuestions,
    plan: state.plan,
    result: state.result,
    runId: session.runId,
    status: session.status,
  };
}

class EventQueue implements AsyncIterable<WorkflowEvent> {
  private readonly pending: WorkflowEvent[] = [];
  private readonly readers: Array<
    (result: IteratorResult<WorkflowEvent>) => void
  > = [];
  private readonly seenIndexes = new Set<number>();
  private closed = false;

  constructor(private readonly fromIndex = 0) {}

  [Symbol.asyncIterator]() {
    return this;
  }

  next(): Promise<IteratorResult<WorkflowEvent>> {
    const value = this.pending.shift();
    if (value) {
      return Promise.resolve({ done: false, value });
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => {
      this.readers.push(resolve);
    });
  }

  push(event: WorkflowEvent) {
    if (event.index < this.fromIndex) {
      return;
    }
    if (this.seenIndexes.has(event.index)) {
      return;
    }
    this.seenIndexes.add(event.index);
    const reader = this.readers.shift();
    if (reader) {
      reader({ done: false, value: event });
      return;
    }
    this.pending.push(event);
  }

  pushMany(events: WorkflowEvent[]) {
    for (const event of events) {
      this.push(event);
    }
  }

  close() {
    this.closed = true;
    for (const reader of this.readers.splice(0)) {
      reader({ done: true, value: undefined });
    }
  }
}

function eventStreamResponse(events: AsyncIterable<WorkflowEvent>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const event of events) {
        controller.enqueue(
          encoder.encode(
            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
          )
        );
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    },
  });
}

export type WorkflowRunner<TArtifact> = ArtifactRunner<TArtifact>;
