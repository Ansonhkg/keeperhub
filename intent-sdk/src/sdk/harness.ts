import { type Domain, type Question, resolveIntent } from "./intent";

export type EventPayload = {
  attempt?: number;
  correlationId?: string;
  detail?: unknown;
  index?: number;
  message: string;
  runId?: string;
  stepId?: string;
  type: string;
  [key: string]: unknown;
};

export type EventRecord = EventPayload & {
  correlationId: string;
  index: number;
  runId: string;
  timestamp: string;
};

export type EventSink = (event: EventRecord) => void | Promise<void>;

export type StepState = Record<string, unknown>;

export type WorkerItemEventType =
  | "worker.item.started"
  | "worker.item.delta"
  | "worker.item.completed"
  | "worker.item.failed";

export type WorkerItemEvent = EventPayload & {
  error?: string;
  input?: unknown;
  itemId: string;
  itemKind: string;
  output?: unknown;
  parentItemId?: string;
  preview: string;
  provider: string;
  providerRefs?: Record<string, string | undefined>;
  raw?: unknown;
  rawType?: string;
  text?: string;
  title: string;
  type: WorkerItemEventType;
};

export type WorkerItemEventInput = Omit<WorkerItemEvent, "message"> & {
  message?: string;
};

export type HarnessStatus =
  | "idle"
  | "running"
  | "waiting"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type StepResult =
  | { output?: unknown; state?: StepState; type: "done" }
  | { questions: Question[]; state?: StepState; type: "ask" }
  | { reason: string; state?: StepState; type: "retry" }
  | { reason?: string; state?: StepState; stepId: string; type: "goto" }
  | { error: string; state?: StepState; type: "fail" };

export type StepContext<TUse = unknown, TInput = unknown> = {
  answers: Record<string, unknown>;
  emit: (event: EventPayload) => void;
  input: TInput;
  state: StepState;
  step: StepRuntimeMetadata;
  use: TUse;
  waitFor<TInput = unknown, TOutput = unknown>(
    hook: HookDefinition<TInput, TOutput>,
    input: TInput
  ): Promise<TOutput>;
};

export type StepRuntimeMetadata = {
  attempt: number;
  correlationId: string;
  id: string;
  idempotencyKey: string;
  runId: string;
};

export type StepDefinition<TUse = unknown, TInput = unknown> = {
  description?: string;
  id: string;
  kind?: string;
  label?: string;
  maxRetries?: number;
  run: (context: StepContext<TUse, TInput>) => Promise<StepResult> | StepResult;
};

export type StepOptions = {
  description?: string;
  kind?: string;
  label?: string;
  maxRetries?: number;
};

export type HookDefinition<TInput = unknown, TOutput = unknown> = {
  id: string;
  input?: TInput;
  schema?: unknown;
  title?: string;
  _output?: TOutput;
};

export type HookRequest<TInput = unknown> = {
  correlationId: string;
  id: string;
  input: TInput;
  kind?: string;
  stepId: string;
  token: string;
};

export type HookResume<TOutput = unknown> = {
  token: string;
  value: TOutput;
};

export type HarnessCheckpoint<TInput = unknown> = {
  attempt: number;
  checkpointId: string;
  eventIndex: number;
  input: TInput;
  runId: string;
  state: StepState;
  stepId: string;
  stepIndex: number;
  timestamp: string;
};

export type HarnessActionRecord = {
  actionId: string;
  input?: unknown;
  name: string;
  runId: string;
  timestamp: string;
};

export type HarnessSessionRecord<TInput = unknown> = {
  answers?: Record<string, unknown>;
  checkpoints?: Array<HarnessCheckpoint<TInput>>;
  consumedHookTokens?: string[];
  createdStepIds?: string[];
  currentStepIndex?: number;
  events?: EventRecord[];
  hasStarted?: boolean;
  hookAnswers?: Record<string, unknown>;
  hookRequests?: Array<HookRequest>;
  input: TInput;
  nextEventIndex?: number;
  parentCheckpointId?: string;
  parentRunId?: string;
  pendingHooks?: HookRequest[];
  pendingQuestions?: Question[];
  retryCounts?: Array<[string, number]>;
  runId: string;
  state?: StepState;
  status: HarnessStatus;
  stepRunCounts?: Array<[string, number]>;
};

export type HarnessStore<TInput = unknown> = {
  appendAction?(action: HarnessActionRecord): Promise<void> | void;
  appendCheckpoint?(
    checkpoint: HarnessCheckpoint<TInput>
  ): Promise<void> | void;
  appendEvent?(event: EventRecord): Promise<void> | void;
  getSession?(
    runId: string
  ):
    | Promise<HarnessSessionRecord<TInput> | undefined>
    | HarnessSessionRecord<TInput>
    | undefined;
  listActions?(
    runId: string
  ): Promise<HarnessActionRecord[]> | HarnessActionRecord[];
  listCheckpoints?(
    runId: string
  ):
    | Promise<Array<HarnessCheckpoint<TInput>>>
    | Array<HarnessCheckpoint<TInput>>;
  listEvents?(runId: string): Promise<EventRecord[]> | EventRecord[];
  saveSession?(session: HarnessSessionRecord<TInput>): Promise<void> | void;
};

export class InMemoryHarnessStore<TInput = unknown>
  implements HarnessStore<TInput>
{
  readonly actions = new Map<string, HarnessActionRecord[]>();
  readonly checkpoints = new Map<string, Array<HarnessCheckpoint<TInput>>>();
  readonly events = new Map<string, EventRecord[]>();
  readonly sessions = new Map<string, HarnessSessionRecord<TInput>>();

  appendAction(action: HarnessActionRecord) {
    const records = this.actions.get(action.runId) ?? [];
    records.push(cloneSnapshot(action));
    this.actions.set(action.runId, records);
  }

  appendCheckpoint(checkpoint: HarnessCheckpoint<TInput>) {
    const records = this.checkpoints.get(checkpoint.runId) ?? [];
    records.push(cloneSnapshot(checkpoint));
    this.checkpoints.set(checkpoint.runId, records);
  }

  appendEvent(event: EventRecord) {
    const records = this.events.get(event.runId) ?? [];
    records.push(cloneSnapshot(event));
    this.events.set(event.runId, records);
  }

  getSession(runId: string) {
    const session = this.sessions.get(runId);
    return session ? cloneSnapshot(session) : undefined;
  }

  listActions(runId: string) {
    return cloneSnapshot(this.actions.get(runId) ?? []);
  }

  listCheckpoints(runId: string) {
    return cloneSnapshot(this.checkpoints.get(runId) ?? []);
  }

  listEvents(runId: string) {
    return cloneSnapshot(this.events.get(runId) ?? []);
  }

  saveSession(session: HarnessSessionRecord<TInput>) {
    this.sessions.set(session.runId, cloneSnapshot(session));
  }
}

export function createHook<TInput = unknown, TOutput = unknown>(input: {
  id: string;
  input?: TInput;
  schema?: unknown;
  title?: string;
}): HookDefinition<TInput, TOutput> {
  return input;
}

export const hook = createHook;

export function done(output?: unknown, state?: StepState): StepResult {
  return { output, state, type: "done" };
}

export function ask(
  question: Question | Question[],
  state?: StepState
): StepResult {
  return {
    questions: Array.isArray(question) ? question : [question],
    state,
    type: "ask",
  };
}

export function retry(reason: string, state?: StepState): StepResult {
  return { reason, state, type: "retry" };
}

export function goto(
  stepId: string,
  reason?: string,
  state?: StepState
): StepResult {
  return { reason, state, stepId, type: "goto" };
}

export function fail(error: string, state?: StepState): StepResult {
  return { error, state, type: "fail" };
}

export function workerItemEvent(input: WorkerItemEventInput): WorkerItemEvent {
  return {
    ...input,
    message: input.message ?? String(input.preview),
  } as WorkerItemEvent;
}

type StepFactory = {
  <TUse = unknown, TInput = unknown>(
    id: string,
    run: StepDefinition<TUse, TInput>["run"],
    options?: StepOptions
  ): StepDefinition<TUse, TInput>;
  ai<TUse = unknown, TInput = unknown>(
    id: string,
    options: { run: StepDefinition<TUse, TInput>["run"] } & StepOptions
  ): StepDefinition<TUse, TInput>;
  intent<
    TUse = unknown,
    TInput extends { prompt?: string } = { prompt?: string },
  >(
    id: string,
    options: { domain: Domain } & StepOptions
  ): StepDefinition<TUse, TInput>;
};

export const step = Object.assign(
  function createStep<TUse = unknown, TInput = unknown>(
    id: string,
    run: StepDefinition<TUse, TInput>["run"],
    options: StepOptions = {}
  ): StepDefinition<TUse, TInput> {
    return {
      description: options.description,
      id,
      kind: options.kind,
      label: options.label,
      maxRetries: options.maxRetries,
      run,
    };
  },
  {
    ai<TUse = unknown, TInput = unknown>(
      id: string,
      options: { run: StepDefinition<TUse, TInput>["run"] } & StepOptions
    ): StepDefinition<TUse, TInput> {
      return {
        description: options.description,
        id,
        kind: options.kind ?? "ai",
        label: options.label,
        maxRetries: options.maxRetries,
        run: options.run,
      };
    },
    intent<
      TUse = unknown,
      TInput extends { prompt?: string } = { prompt?: string },
    >(
      id: string,
      options: { domain: Domain } & StepOptions
    ): StepDefinition<TUse, TInput> {
      return {
        description: options.description,
        id,
        kind: options.kind ?? "intent",
        label: options.label,
        maxRetries: options.maxRetries,
        async run(context) {
          const prompt =
            typeof context.input === "object" &&
            context.input !== null &&
            "prompt" in context.input &&
            typeof context.input.prompt === "string"
              ? context.input.prompt
              : String(context.input);
          const intent = await resolveIntent({
            answers: context.answers,
            domain: options.domain,
            prompt,
          });
          context.emit({
            detail: {
              questions: intent.questions.length,
              requirements: intent.contract.requirements.length,
              steps: intent.contract.steps.length,
            },
            message:
              intent.status === "resolved"
                ? "Resolved intent contract."
                : "Intent needs more input.",
            stepId: id,
            type: "intent.resolved",
          });
          if (intent.status === "needs_input") {
            return ask(intent.questions, { intent: intent.contract });
          }
          return done({ intent: intent.contract });
        },
      };
    },
  }
) as StepFactory;

export type HarnessConfig<TUse, TInput> = {
  description?: string;
  id: string;
  label?: string;
  steps: StepDefinition<TUse, TInput>[];
  use?: TUse;
};

export type HarnessGraphNode = {
  description?: string;
  id: string;
  kind: string;
  label: string;
  maxRetries: number;
};

export type HarnessGraphEdge = {
  from: string;
  id: string;
  kind: "sequence";
  to: string;
};

export type HarnessGraphProjection = {
  description?: string;
  edges: HarnessGraphEdge[];
  id: string;
  label: string;
  nodes: HarnessGraphNode[];
};

export type HarnessStartOptions<TInput = unknown> = {
  answers?: Record<string, unknown>;
  onEvent?: EventSink;
  runId?: string;
  store?: HarnessStore<TInput>;
};

export type HarnessRerunOptions<TInput = unknown> =
  HarnessStartOptions<TInput> & {
    checkpointId: string;
    input?: TInput;
    state?: StepState;
  };

type HarnessSessionSeed = {
  answers?: Record<string, unknown>;
  checkpoints?: Array<HarnessCheckpoint<unknown>>;
  consumedHookTokens?: string[];
  createdStepIds?: string[];
  currentStepIndex?: number;
  events?: EventRecord[];
  hasStarted?: boolean;
  hookAnswers?: Record<string, unknown>;
  hookRequests?: Array<HookRequest>;
  initialState?: StepState;
  nextEventIndex?: number;
  parentCheckpointId?: string;
  parentRunId?: string;
  pendingHooks?: HookRequest[];
  pendingQuestions?: Question[];
  retryCounts?: Array<[string, number]>;
  startStepIndex?: number;
  status?: HarnessStatus;
  stepRunCounts?: Array<[string, number]>;
};

export function harness<TUse = unknown, TInput = unknown>(
  config: HarnessConfig<TUse, TInput>
) {
  async function restoreSession(
    runId: string,
    options: HarnessStartOptions<TInput> = {}
  ) {
    if (!options.store?.getSession) {
      throw new Error("Harness restore requires a store with getSession.");
    }
    const record = await options.store.getSession(runId);
    if (!record) {
      throw new Error(`Harness session not found: ${runId}`);
    }
    const events =
      record.events ?? (await options.store.listEvents?.(runId)) ?? [];
    const checkpoints =
      record.checkpoints ??
      (await options.store.listCheckpoints?.(runId)) ??
      [];
    return HarnessSession.fromRecord(
      config,
      record,
      {
        ...options,
        runId,
      },
      {
        checkpoints,
        events,
      }
    );
  }

  return {
    id: config.id,
    graph(): HarnessGraphProjection {
      return projectHarnessGraph(config);
    },
    async answer(
      runId: string,
      input: { questionId: string; value: unknown },
      options: HarnessStartOptions<TInput> = {}
    ) {
      const session = await restoreSession(runId, options);
      await session.answer(input);
      return session;
    },
    async cancel(
      runId: string,
      input: { reason?: string } = {},
      options: HarnessStartOptions<TInput> = {}
    ) {
      const session = await restoreSession(runId, options);
      await session.cancel(input);
      return session;
    },
    async pause(
      runId: string,
      input: { reason?: string } = {},
      options: HarnessStartOptions<TInput> = {}
    ) {
      const session = await restoreSession(runId, options);
      await session.pause(input);
      return session;
    },
    async restore(runId: string, options: HarnessStartOptions<TInput> = {}) {
      return restoreSession(runId, options);
    },
    async resume(runId: string, options: HarnessStartOptions<TInput> = {}) {
      const session = await restoreSession(runId, options);
      await session.resume();
      return session;
    },
    async resumeHook<TOutput = unknown>(
      runId: string,
      input: HookResume<TOutput>,
      options: HarnessStartOptions<TInput> = {}
    ) {
      const session = await restoreSession(runId, options);
      await session.resumeHook(input);
      return session;
    },
    async rerunFromCheckpoint(
      runId: string,
      input: HarnessRerunOptions<TInput>,
      options: HarnessStartOptions<TInput> = {}
    ) {
      const session = await restoreSession(runId, options);
      return session.rerunFromCheckpoint({
        ...input,
        store: input.store ?? options.store,
      });
    },
    async start(input: TInput, options: HarnessStartOptions<TInput> = {}) {
      const session = new HarnessSession(config, input, options);
      await session.resume();
      return session;
    },
  };
}

export class HarnessSession<TUse = unknown, TInput = unknown> {
  readonly answers: Record<string, unknown> = {};
  readonly checkpoints: Array<HarnessCheckpoint<TInput>> = [];
  readonly events: EventRecord[] = [];
  readonly hookAnswers: Record<string, unknown> = {};
  readonly parentCheckpointId?: string;
  readonly parentRunId?: string;
  readonly runId: string;
  readonly state: StepState = {};
  pendingHooks: HookRequest[] = [];
  pendingQuestions: Question[] = [];
  status: HarnessStatus = "idle";
  private readonly createdStepIds = new Set<string>();
  private currentStepIndex = 0;
  private hasStarted = false;
  private readonly hookRequests = new Map<string, HookRequest>();
  private nextEventIndex = 0;
  private readonly retryCounts = new Map<string, number>();
  private readonly stepRunCounts = new Map<string, number>();
  private readonly consumedHookTokens = new Set<string>();

  constructor(
    private readonly config: HarnessConfig<TUse, TInput>,
    readonly input: TInput,
    private readonly options: HarnessStartOptions<TInput> = {},
    seed: HarnessSessionSeed = {}
  ) {
    Object.assign(this.answers, seed.answers ?? options.answers ?? {});
    Object.assign(this.hookAnswers, seed.hookAnswers ?? {});
    Object.assign(this.state, seed.initialState ?? {});
    this.checkpoints.push(
      ...((seed.checkpoints ?? []) as Array<HarnessCheckpoint<TInput>>)
    );
    this.events.push(...(seed.events ?? []));
    this.pendingHooks = [...(seed.pendingHooks ?? [])];
    this.pendingQuestions = [...(seed.pendingQuestions ?? [])];
    this.currentStepIndex = seed.currentStepIndex ?? seed.startStepIndex ?? 0;
    this.hasStarted = seed.hasStarted ?? false;
    this.nextEventIndex = seed.nextEventIndex ?? this.events.length;
    this.parentCheckpointId = seed.parentCheckpointId;
    this.parentRunId = seed.parentRunId;
    this.runId = options.runId ?? createRunId();
    this.status = seed.status ?? "idle";
    for (const stepId of seed.createdStepIds ?? []) {
      this.createdStepIds.add(stepId);
    }
    for (const [stepId, count] of seed.retryCounts ?? []) {
      this.retryCounts.set(stepId, count);
    }
    for (const [stepId, count] of seed.stepRunCounts ?? []) {
      this.stepRunCounts.set(stepId, count);
    }
    for (const token of seed.consumedHookTokens ?? []) {
      this.consumedHookTokens.add(token);
    }
    for (const hookRequest of [
      ...(seed.hookRequests ?? []),
      ...this.pendingHooks,
    ]) {
      this.hookRequests.set(hookRequest.token, hookRequest);
    }
  }

  static fromRecord<TUse = unknown, TInput = unknown>(
    config: HarnessConfig<TUse, TInput>,
    record: HarnessSessionRecord<TInput>,
    options: HarnessStartOptions<TInput> = {},
    loaded: {
      checkpoints?: Array<HarnessCheckpoint<TInput>>;
      events?: EventRecord[];
    } = {}
  ) {
    return new HarnessSession(config, record.input, options, {
      answers: record.answers,
      checkpoints: record.checkpoints ?? loaded.checkpoints,
      consumedHookTokens: record.consumedHookTokens,
      createdStepIds: record.createdStepIds,
      currentStepIndex: record.currentStepIndex,
      events: record.events ?? loaded.events,
      hasStarted: record.hasStarted,
      hookAnswers: record.hookAnswers,
      hookRequests: record.hookRequests,
      initialState: record.state,
      nextEventIndex: record.nextEventIndex,
      parentCheckpointId: record.parentCheckpointId,
      parentRunId: record.parentRunId,
      pendingHooks: record.pendingHooks,
      pendingQuestions: record.pendingQuestions,
      retryCounts: record.retryCounts,
      status: record.status,
      stepRunCounts: record.stepRunCounts,
    });
  }

  async answer(input: { questionId: string; value: unknown }) {
    this.answers[input.questionId] = input.value;
    this.emit({
      detail: input,
      message: `Answered ${input.questionId}.`,
      type: "question.answered",
    });
    const hookRequest = this.pendingHooks.find(
      (hook) => hook.kind === "question" && hook.id === input.questionId
    );
    if (hookRequest && !this.consumedHookTokens.has(hookRequest.token)) {
      this.hookAnswers[hookRequest.token] = input.value;
      this.consumedHookTokens.add(hookRequest.token);
      this.emit({
        detail: {
          hook: hookRequest,
          value: input.value,
        },
        message: `Resumed hook ${hookRequest.id}.`,
        type: "hook.resumed",
      });
    }
  }

  async resumeHook<TOutput = unknown>(input: HookResume<TOutput>) {
    const hookRequest = this.hookRequests.get(input.token);
    if (this.consumedHookTokens.has(input.token)) {
      throw new Error(`Hook token has already been consumed: ${input.token}`);
    }
    if (!hookRequest) {
      throw new Error(`Unknown hook token: ${input.token}`);
    }
    this.hookAnswers[input.token] = input.value;
    this.consumedHookTokens.add(input.token);
    this.emit({
      detail: {
        hook: hookRequest,
        value: input.value,
      },
      message: `Resumed hook ${hookRequest.id}.`,
      type: "hook.resumed",
    });
    return this.resume();
  }

  async pause(input: { reason?: string } = {}) {
    if (isTerminalStatus(this.status)) {
      return this.snapshot();
    }
    this.status = "paused";
    this.emit({
      detail: input,
      message: input.reason
        ? `Run ${this.runId} paused: ${input.reason}`
        : `Run ${this.runId} paused.`,
      type: "run.paused",
    });
    return this.snapshot();
  }

  async cancel(input: { reason?: string } = {}) {
    if (isTerminalStatus(this.status)) {
      return this.snapshot();
    }
    this.status = "cancelled";
    this.pendingHooks = [];
    this.pendingQuestions = [];
    this.emit({
      detail: input,
      message: input.reason
        ? `Run ${this.runId} cancelled: ${input.reason}`
        : `Run ${this.runId} cancelled.`,
      type: "run.cancelled",
    });
    return this.snapshot();
  }

  async rerunFromCheckpoint(
    input: HarnessRerunOptions<TInput>
  ): Promise<HarnessSession<TUse, TInput>> {
    const checkpoint = this.checkpoints.find(
      (item) => item.checkpointId === input.checkpointId
    );
    if (!checkpoint) {
      throw new Error(`Unknown checkpoint: ${input.checkpointId}`);
    }
    const child = new HarnessSession(
      this.config,
      input.input ?? cloneSnapshot(checkpoint.input),
      {
        answers: input.answers,
        onEvent: input.onEvent,
        runId: input.runId,
        store: input.store ?? this.options.store,
      },
      {
        initialState: input.state ?? cloneSnapshot(checkpoint.state),
        parentCheckpointId: checkpoint.checkpointId,
        parentRunId: this.runId,
        startStepIndex: checkpoint.stepIndex,
      }
    );
    this.emit({
      detail: {
        childRunId: child.runId,
        checkpoint,
      },
      message: `Created rerun ${child.runId} from checkpoint ${checkpoint.checkpointId}.`,
      type: "run.rerun.created",
    });
    this.recordAction("rerunFromCheckpoint", {
      checkpointId: checkpoint.checkpointId,
      childRunId: child.runId,
    });
    await child.resume();
    return child;
  }

  async resume() {
    if (isTerminalStatus(this.status)) {
      return this.snapshot();
    }
    const waitingStepId =
      this.status === "waiting" || this.status === "paused"
        ? this.pendingHooks[0]?.stepId
        : undefined;
    if (!this.hasStarted) {
      this.hasStarted = true;
      this.emit({
        message: `Run ${this.runId} started.`,
        type: "run.started",
      });
    } else if (this.status === "paused") {
      this.emit({
        message: `Run ${this.runId} resumed.`,
        type: "run.resumed",
      });
    }
    this.status = "running";
    this.pendingHooks = [];
    this.pendingQuestions = [];
    while (this.currentStepIndex < this.config.steps.length) {
      const current = this.config.steps[this.currentStepIndex];
      const attempt =
        waitingStepId === current.id
          ? (this.stepRunCounts.get(current.id) ?? 1)
          : (this.stepRunCounts.get(current.id) ?? 0) + 1;
      this.stepRunCounts.set(current.id, attempt);
      const stepMetadata = this.stepMetadata(current.id, attempt);
      if (!this.createdStepIds.has(current.id)) {
        this.createdStepIds.add(current.id);
        this.emit(
          {
            message: `Created ${current.id}.`,
            stepId: current.id,
            type: "step.created",
          },
          stepMetadata
        );
      }
      this.emit(
        {
          message: `Starting ${current.id}.`,
          stepId: current.id,
          type: "step.started",
        },
        stepMetadata
      );
      this.createCheckpoint(current.id, this.currentStepIndex, stepMetadata);
      let result: StepResult;
      try {
        let hookOrdinal = 0;
        result = await current.run({
          answers: this.answers,
          emit: (event) => this.emit(event, stepMetadata),
          input: this.input,
          state: this.state,
          step: stepMetadata,
          use: this.config.use as TUse,
          waitFor: async <THookInput, THookOutput>(
            hookDefinition: HookDefinition<THookInput, THookOutput>,
            hookInput: THookInput
          ) => {
            const hookRequest = this.createHookRequest(
              hookDefinition,
              hookInput,
              stepMetadata,
              hookOrdinal
            );
            hookOrdinal += 1;
            if (hookRequest.token in this.hookAnswers) {
              return this.hookAnswers[hookRequest.token] as THookOutput;
            }
            throw new HookWaitSignal(hookRequest);
          },
        });
      } catch (error) {
        if (!(error instanceof HookWaitSignal)) {
          throw error;
        }
        this.pendingHooks = [error.request];
        this.status = "waiting";
        this.emit(
          {
            detail: { hook: error.request },
            message: `Created hook ${error.request.id}.`,
            stepId: current.id,
            type: "hook.created",
          },
          stepMetadata
        );
        this.emit(
          {
            detail: { hook: error.request },
            message: `Waiting for hook ${error.request.id}.`,
            stepId: current.id,
            type: "step.waiting",
          },
          stepMetadata
        );
        this.emit(
          {
            detail: { hook: error.request },
            message: `Waiting for hook ${error.request.id}.`,
            stepId: current.id,
            type: "hook.waiting",
          },
          stepMetadata
        );
        return this.snapshot();
      }
      if (result.state) {
        Object.assign(this.state, result.state);
      }
      if (result.type === "ask") {
        this.pendingQuestions = result.questions;
        this.pendingHooks = result.questions.map((question) =>
          this.questionHookRequest(question, stepMetadata)
        );
        this.status = "waiting";
        for (const hookRequest of this.pendingHooks) {
          this.emit(
            {
              detail: { hook: hookRequest },
              message: `Created hook ${hookRequest.id}.`,
              stepId: current.id,
              type: "hook.created",
            },
            stepMetadata
          );
        }
        this.emit(
          {
            detail: { hooks: this.pendingHooks, questions: result.questions },
            message: `Waiting for ${result.questions.length} answer${result.questions.length === 1 ? "" : "s"}.`,
            stepId: current.id,
            type: "step.waiting",
          },
          stepMetadata
        );
        for (const hookRequest of this.pendingHooks) {
          this.emit(
            {
              detail: { hook: hookRequest },
              message: `Waiting for hook ${hookRequest.id}.`,
              stepId: current.id,
              type: "hook.waiting",
            },
            stepMetadata
          );
        }
        this.emit(
          {
            detail: { questions: result.questions },
            message: `Waiting for ${result.questions.length} answer${result.questions.length === 1 ? "" : "s"}.`,
            stepId: current.id,
            type: "question.requested",
          },
          stepMetadata
        );
        return this.snapshot();
      }
      if (result.type === "fail") {
        this.status = "failed";
        this.emit(
          {
            detail: { error: result.error },
            message: result.error,
            stepId: current.id,
            type: "step.failed",
          },
          stepMetadata
        );
        this.emit({
          detail: { error: result.error },
          message: `Run ${this.runId} failed.`,
          type: "run.failed",
        });
        return this.snapshot();
      }
      if (result.type === "retry") {
        const retries = this.retryCounts.get(current.id) ?? 0;
        const maxRetries = current.maxRetries ?? 1;
        this.retryCounts.set(current.id, retries + 1);
        this.emit(
          {
            detail: { maxRetries, reason: result.reason, retries: retries + 1 },
            message: `Retry requested: ${result.reason}`,
            stepId: current.id,
            type: "step.retrying",
          },
          stepMetadata
        );
        if (retries >= maxRetries) {
          this.status = "failed";
          this.emit(
            {
              detail: {
                maxRetries,
                reason: result.reason,
                retries: retries + 1,
              },
              message: `Retry limit reached for ${current.id}.`,
              stepId: current.id,
              type: "step.failed",
            },
            stepMetadata
          );
          this.emit({
            detail: { reason: result.reason },
            message: `Run ${this.runId} failed.`,
            type: "run.failed",
          });
          return this.snapshot();
        }
        continue;
      }
      if (result.type === "goto") {
        const targetStepIndex = this.config.steps.findIndex(
          (item) => item.id === result.stepId
        );
        if (targetStepIndex === -1) {
          this.status = "failed";
          this.emit(
            {
              detail: {
                fromStepId: current.id,
                reason: result.reason,
                targetStepId: result.stepId,
              },
              message: `Unknown step target: ${result.stepId}`,
              stepId: current.id,
              type: "step.failed",
            },
            stepMetadata
          );
          this.emit({
            detail: { reason: `Unknown step target: ${result.stepId}` },
            message: `Run ${this.runId} failed.`,
            type: "run.failed",
          });
          return this.snapshot();
        }
        this.emit(
          {
            detail: {
              fromStepId: current.id,
              reason: result.reason,
              targetStepId: result.stepId,
            },
            message: result.reason
              ? `Continuing at ${result.stepId}: ${result.reason}`
              : `Continuing at ${result.stepId}.`,
            stepId: current.id,
            type: "step.goto",
          },
          stepMetadata
        );
        this.currentStepIndex = targetStepIndex;
        continue;
      }
      mergeOutput(this.state, current.id, result.output);
      this.emit(
        {
          detail: result.output,
          message: `Completed ${current.id}.`,
          stepId: current.id,
          type: "step.completed",
        },
        stepMetadata
      );
      this.currentStepIndex += 1;
    }
    this.status = "completed";
    this.emit({
      message: `Run ${this.runId} completed.`,
      type: "run.completed",
    });
    return this.snapshot();
  }

  snapshot() {
    return {
      checkpoints: this.checkpoints,
      events: this.events,
      parentCheckpointId: this.parentCheckpointId,
      parentRunId: this.parentRunId,
      pendingHooks: this.pendingHooks,
      pendingQuestions: this.pendingQuestions,
      runId: this.runId,
      state: this.state,
      status: this.status,
    };
  }

  private recordAction(name: string, input?: unknown) {
    const action = {
      actionId: `action_${crypto.randomUUID()}`,
      input: cloneSnapshot(input),
      name,
      runId: this.runId,
      timestamp: new Date().toISOString(),
    };
    void this.options.store?.appendAction?.(action);
    return action;
  }

  private createCheckpoint(
    stepId: string,
    stepIndex: number,
    step: StepRuntimeMetadata
  ) {
    const checkpoint = {
      attempt: step.attempt,
      checkpointId: `checkpoint_${crypto.randomUUID()}`,
      eventIndex: this.nextEventIndex,
      input: cloneSnapshot(this.input),
      runId: this.runId,
      state: cloneSnapshot(this.state),
      stepId,
      stepIndex,
      timestamp: new Date().toISOString(),
    };
    this.checkpoints.push(checkpoint);
    void this.options.store?.appendCheckpoint?.(checkpoint);
    this.emit(
      {
        detail: { checkpoint },
        message: `Checkpointed ${stepId}.`,
        stepId,
        type: "checkpoint.created",
      },
      step
    );
    return checkpoint;
  }

  private emit(event: EventPayload, step?: StepRuntimeMetadata) {
    const index = this.nextEventIndex;
    const eventRecord = {
      ...event,
      attempt: step?.attempt ?? event.attempt,
      correlationId: step?.correlationId ?? `run:${this.runId}:event:${index}`,
      index,
      runId: this.runId,
      timestamp: new Date().toISOString(),
    };
    this.nextEventIndex += 1;
    this.events.push(eventRecord);
    void this.options.store?.appendEvent?.(eventRecord);
    void this.options.store?.saveSession?.(this.sessionRecord());
    void this.options.onEvent?.(eventRecord);
  }

  private sessionRecord(): HarnessSessionRecord<TInput> {
    return {
      answers: cloneSnapshot(this.answers),
      checkpoints: cloneSnapshot(this.checkpoints),
      consumedHookTokens: [...this.consumedHookTokens],
      createdStepIds: [...this.createdStepIds],
      currentStepIndex: this.currentStepIndex,
      events: cloneSnapshot(this.events),
      hasStarted: this.hasStarted,
      hookAnswers: cloneSnapshot(this.hookAnswers),
      hookRequests: cloneSnapshot([...this.hookRequests.values()]),
      input: cloneSnapshot(this.input),
      nextEventIndex: this.nextEventIndex,
      parentCheckpointId: this.parentCheckpointId,
      parentRunId: this.parentRunId,
      pendingHooks: cloneSnapshot(this.pendingHooks),
      pendingQuestions: cloneSnapshot(this.pendingQuestions),
      retryCounts: [...this.retryCounts.entries()],
      runId: this.runId,
      state: cloneSnapshot(this.state),
      status: this.status,
      stepRunCounts: [...this.stepRunCounts.entries()],
    };
  }

  private stepMetadata(stepId: string, attempt: number): StepRuntimeMetadata {
    const correlationId = `run:${this.runId}:step:${stepId}:attempt:${attempt}`;
    return {
      attempt,
      correlationId,
      id: stepId,
      idempotencyKey: `${this.runId}:${stepId}:${attempt}`,
      runId: this.runId,
    };
  }

  private createHookRequest<TInput, TOutput>(
    hookDefinition: HookDefinition<TInput, TOutput>,
    input: TInput,
    step: StepRuntimeMetadata,
    ordinal: number
  ): HookRequest<TInput> {
    const request = {
      correlationId: step.correlationId,
      id: hookDefinition.id,
      input,
      stepId: step.id,
      token: hookToken(
        this.runId,
        step.id,
        step.attempt,
        hookDefinition.id,
        ordinal
      ),
    };
    this.hookRequests.set(request.token, request);
    return request;
  }

  private questionHookRequest(
    question: Question,
    step: StepRuntimeMetadata
  ): HookRequest<Question> {
    const request = {
      correlationId: step.correlationId,
      id: question.id,
      input: question,
      kind: "question",
      stepId: step.id,
      token: `question:${this.runId}:${question.id}`,
    };
    this.hookRequests.set(request.token, request);
    return request;
  }
}

function mergeOutput(state: StepState, stepId: string, output: unknown) {
  state[stepId] = output;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    Object.assign(state, output);
  }
}

export function projectHarnessGraph<TUse, TInput>(
  config: HarnessConfig<TUse, TInput>
): HarnessGraphProjection {
  const nodes = config.steps.map((item) => ({
    description: item.description,
    id: item.id,
    kind: item.kind ?? "step",
    label: item.label ?? humanizeId(item.id),
    maxRetries: item.maxRetries ?? 1,
  }));
  return {
    description: config.description,
    edges: config.steps.slice(1).map((item, index) => ({
      from: config.steps[index]!.id,
      id: `${config.steps[index]!.id}->${item.id}`,
      kind: "sequence",
      to: item.id,
    })),
    id: config.id,
    label: config.label ?? humanizeId(config.id),
    nodes,
  };
}

function createRunId() {
  return `run_${crypto.randomUUID()}`;
}

function hookToken(
  runId: string,
  stepId: string,
  attempt: number,
  hookId: string,
  ordinal: number
) {
  return [
    "hook",
    encodeTokenPart(runId),
    encodeTokenPart(stepId),
    String(attempt),
    String(ordinal),
    encodeTokenPart(hookId),
  ].join(":");
}

function encodeTokenPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isTerminalStatus(status: HarnessStatus) {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function humanizeId(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function cloneSnapshot<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

class HookWaitSignal extends Error {
  constructor(readonly request: HookRequest) {
    super(`Waiting for hook ${request.id}.`);
  }
}
