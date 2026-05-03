import { done, goto, harness, step } from "../../../src/sdk/harness.js";
import type { EvalExecWorkerPort, RunStorePort } from "../providers.js";
import {
  type Evaluation,
  type LoopConfig,
  type RunRecord,
  RunRecordSchema,
  type RunRequest,
  type RunRequestDraft,
  RunRequestSchema,
  type RunResponse,
  RunResponseSchema,
  type WorkerStreamEvent,
} from "../schemas.js";
import {
  buildEvaluatorPrompt,
  buildExecutorPrompt,
  buildFixerPrompt,
} from "./prompt-builder.js";
import { defaultLoopConfig, materializeRunRequest } from "./request-policy.js";

export type RunLoopEvent = RunRecord["events"][number];
export type RunLoopObserver = (event: RunLoopEvent) => Promise<void> | void;
export type RunLoopCheckpointNodeId = Extract<
  RunLoopEvent,
  { type: "checkpoint:created" }
>["nodeId"];
export type RunLoopCheckpointState = {
  nodeId: RunLoopCheckpointNodeId;
  request: RunRequest;
  currentPrompt?: string;
  attempt?: RunRecord["latestAttempt"];
  evaluation?: RunRecord["latestEvaluation"];
  executionRound?: number;
  fixRound?: number;
};

type EvalExecHarnessUse = {
  config: LoopConfig;
  onEvent?: RunLoopObserver;
  run: RunRecord;
  runStore: RunStorePort;
  startNodeId?: RunLoopCheckpointNodeId;
  worker: EvalExecWorkerPort;
};

export async function runEvalExecLoop(
  input: RunRequestDraft,
  worker: EvalExecWorkerPort,
  runStore: RunStorePort,
  config: LoopConfig = defaultLoopConfig,
  onEvent?: RunLoopObserver
): Promise<RunResponse> {
  const request = materializeRunRequest(input, config);
  const run = RunRecordSchema.parse({
    id: crypto.randomUUID(),
    phase: "running",
    input: request.task,
    request,
    currentPrompt: request.task,
    executionRound: 0,
    fixRound: 0,
    evidence: [],
    events: [{ type: "run:start", runId: "pending" }],
    cancelled: false,
  });
  run.events = [];
  await pushRunEvent(run, { type: "run:start", runId: run.id }, onEvent);
  await runStore.create(run);

  try {
    await runLoop(run, worker, runStore, config, onEvent);
  } catch (error) {
    run.phase = isOperationCancelledError(error) ? "cancelled" : "failed";
    run.latestError = error instanceof Error ? error.message : String(error);
    await pushRunEvent(
      run,
      { type: "run:end", runId: run.id, phase: run.phase },
      onEvent
    );
    await runStore.save(run);
  }

  return toRunResponse(run, worker.name);
}

export async function runEvalExecFromCheckpoint(
  checkpoint: RunLoopCheckpointState,
  promptOverride: string | undefined,
  worker: EvalExecWorkerPort,
  runStore: RunStorePort,
  config: LoopConfig = defaultLoopConfig,
  onEvent?: RunLoopObserver
): Promise<RunResponse> {
  const request = RunRequestSchema.parse({
    ...checkpoint.request,
    ...(promptOverride ? { task: promptOverride } : {}),
  });
  const run = RunRecordSchema.parse({
    id: crypto.randomUUID(),
    phase: "running",
    input: request.task,
    request,
    currentPrompt: promptOverride ?? checkpoint.currentPrompt ?? request.task,
    latestAttempt: checkpoint.attempt,
    latestEvaluation: checkpoint.evaluation,
    executionRound: checkpoint.executionRound ?? 0,
    fixRound: checkpoint.fixRound ?? 0,
    evidence: checkpoint.attempt?.evidence ?? [],
    events: [],
    cancelled: false,
  });
  await pushRunEvent(run, { type: "run:start", runId: run.id }, onEvent);
  await runStore.create(run);

  try {
    await runFromCheckpoint(
      run,
      checkpoint.nodeId,
      worker,
      runStore,
      config,
      onEvent
    );
  } catch (error) {
    run.phase = isOperationCancelledError(error) ? "cancelled" : "failed";
    run.latestError = error instanceof Error ? error.message : String(error);
    await pushRunEvent(
      run,
      { type: "run:end", runId: run.id, phase: run.phase },
      onEvent
    );
    await runStore.save(run);
  }

  return toRunResponse(run, worker.name);
}

export function createRunRecord(
  input: RunRequestDraft,
  config: LoopConfig = defaultLoopConfig
): RunRecord {
  const request = materializeRunRequest(input, config);
  const run = RunRecordSchema.parse({
    id: crypto.randomUUID(),
    phase: "queued",
    input: request.task,
    request,
    currentPrompt: request.task,
    executionRound: 0,
    fixRound: 0,
    evidence: [],
    events: [],
    cancelled: false,
  });
  return run;
}

export async function executeRunRecord(
  run: RunRecord,
  worker: EvalExecWorkerPort,
  runStore: RunStorePort,
  config: LoopConfig = defaultLoopConfig
): Promise<void> {
  run.phase = "running";
  run.events.push({ type: "run:start", runId: run.id });
  await runStore.save(run);

  try {
    await runLoop(run, worker, runStore, config);
  } catch (error) {
    run.phase = isOperationCancelledError(error) ? "cancelled" : "failed";
    run.latestError = error instanceof Error ? error.message : String(error);
    run.events.push({ type: "run:end", runId: run.id, phase: run.phase });
    await runStore.save(run);
  }
}

async function runLoop(
  run: RunRecord,
  worker: EvalExecWorkerPort,
  runStore: RunStorePort,
  config: LoopConfig,
  onEvent?: RunLoopObserver
): Promise<void> {
  await runEvalExecHarness({
    config,
    onEvent,
    run,
    runStore,
    worker,
  });
}

async function runFromCheckpoint(
  run: RunRecord,
  nodeId: RunLoopCheckpointNodeId,
  worker: EvalExecWorkerPort,
  runStore: RunStorePort,
  config: LoopConfig,
  onEvent?: RunLoopObserver
): Promise<void> {
  return runEvalExecHarness({
    config,
    onEvent,
    run,
    runStore,
    startNodeId: nodeId,
    worker,
  });
}

async function runEvalExecHarness(use: EvalExecHarnessUse): Promise<void> {
  const app = harness<EvalExecHarnessUse, undefined>({
    id: "demo2.eval-exec",
    label: "Eval Exec Loop",
    use,
    steps: [
      step(
        "prepare",
        async ({ use }) => {
          if (use.startNodeId && use.startNodeId !== "prepare-request") {
            return goto(
              stepIdForCheckpoint(use.startNodeId),
              "resume from checkpoint"
            );
          }
          await pushCheckpoint(use.run, "prepare-request", 0, use.onEvent);
          return goto("execute");
        },
        {
          description: "Materialize the run request and initial state.",
          kind: "prepare",
          label: "Prepare",
        }
      ),
      step.ai("execute", {
        description: "Ask the worker to produce an attempt.",
        kind: "worker",
        label: "Execute",
        run: async ({ use }) => {
          await assertRunIsActive(use);
          const executionRound = use.run.executionRound + 1;
          const maxExecutionRounds =
            use.run.request.maxExecutionRounds ?? use.config.maxExecutionRounds;
          if (executionRound > maxExecutionRounds) {
            return goto("result", "execution round limit reached", {
              resultPhase: "failed",
            });
          }

          use.run.executionRound = executionRound;
          await pushCheckpoint(
            use.run,
            "executor",
            executionRound,
            use.onEvent
          );
          await pushRunEvent(
            use.run,
            {
              type: "prompt:rendered",
              nodeId: "executor",
              templateKey: "executor",
              phase: "executor",
              round: executionRound,
              prompt: buildExecutorPrompt(
                use.run.request,
                use.run.currentPrompt,
                executionRound
              ),
            },
            use.onEvent
          );
          await pushRunEvent(
            use.run,
            { type: "execute:start", round: executionRound },
            use.onEvent
          );
          await use.runStore.save(use.run);

          const attempt = await use.worker.execute(
            use.run.request,
            use.run.currentPrompt,
            executionRound,
            workerContext(
              use.run,
              "executor",
              "executor",
              executionRound,
              use.onEvent
            )
          );
          use.run.latestAttempt = attempt;
          use.run.evidence = attempt.evidence;
          await pushRunEvent(
            use.run,
            {
              type: "execute:end",
              round: executionRound,
              output: attempt.output,
            },
            use.onEvent
          );
          await use.runStore.save(use.run);
          return goto("evaluate");
        },
      }),
      step.ai("evaluate", {
        description: "Evaluate the latest attempt against the run policy.",
        kind: "worker",
        label: "Evaluate",
        run: async ({ use }) => {
          const attempt = use.run.latestAttempt;
          if (!attempt)
            return goto("result", "missing attempt", { resultPhase: "failed" });
          const executionRound = Math.max(1, use.run.executionRound || 1);
          await pushCheckpoint(
            use.run,
            "evaluator",
            executionRound,
            use.onEvent
          );
          await pushRunEvent(
            use.run,
            { type: "evaluate:start", round: executionRound },
            use.onEvent
          );
          await use.runStore.save(use.run);
          await pushRunEvent(
            use.run,
            {
              type: "prompt:rendered",
              nodeId: "evaluator",
              templateKey: "evaluator",
              phase: "evaluator",
              round: executionRound,
              prompt: buildEvaluatorPrompt(
                use.run.request,
                attempt,
                executionRound
              ),
            },
            use.onEvent
          );
          const evaluation = await use.worker.evaluate(
            use.run.request,
            attempt,
            executionRound,
            workerContext(
              use.run,
              "evaluator",
              "evaluator",
              executionRound,
              use.onEvent
            )
          );
          await applyEvaluation(
            use.run,
            evaluation,
            executionRound,
            use.onEvent
          );
          await use.runStore.save(use.run);
          return goto("decide");
        },
      }),
      step(
        "decide",
        async ({ use }) => {
          const attempt = use.run.latestAttempt;
          const evaluation = use.run.latestEvaluation;
          const executionRound = Math.max(1, use.run.executionRound || 1);
          await pushCheckpoint(
            use.run,
            "decision",
            executionRound,
            use.onEvent
          );
          if (!(attempt && evaluation)) {
            return goto("result", "missing attempt or evaluation", {
              resultPhase: "failed",
            });
          }

          const meetsThreshold =
            evaluation.score >=
            (use.run.request.scoreThreshold ?? use.config.scoreThreshold);
          const hasEvidence =
            !use.config.requireRealEvidence || attempt.evidence.length > 0;
          if (evaluation.passed && meetsThreshold && hasEvidence) {
            return goto("result", "evaluation passed", {
              resultPhase: "passed",
            });
          }

          const maxExecutionRounds =
            use.run.request.maxExecutionRounds ?? use.config.maxExecutionRounds;
          const maxFixRounds =
            use.run.request.maxFixRounds ?? use.config.maxFixRounds;
          if (
            executionRound >= maxExecutionRounds ||
            use.run.fixRound >= maxFixRounds
          ) {
            return goto("result", "round limit reached", {
              resultPhase: "failed",
            });
          }

          return goto("fix", evaluation.error ?? "Score below threshold");
        },
        {
          description: "Choose whether to pass, fail, or repair the prompt.",
          kind: "decision",
          label: "Decide",
        }
      ),
      step.ai("fix", {
        description:
          "Ask the worker to repair the prompt before another attempt.",
        kind: "worker",
        label: "Fix",
        run: async ({ use }) => {
          const attempt = use.run.latestAttempt;
          const evaluation = use.run.latestEvaluation;
          if (!(attempt && evaluation)) {
            return goto("result", "missing attempt or evaluation", {
              resultPhase: "failed",
            });
          }
          use.run.fixRound += 1;
          await pushCheckpoint(use.run, "fixer", use.run.fixRound, use.onEvent);
          await pushRunEvent(
            use.run,
            {
              type: "fix:start",
              round: use.run.fixRound,
              reason: evaluation.error ?? "Score below threshold",
            },
            use.onEvent
          );
          const fixInput = {
            prompt: use.run.currentPrompt,
            attempt,
            evaluation,
            executionRound: Math.max(1, use.run.executionRound || 1),
            fixRound: use.run.fixRound,
          };
          await pushRunEvent(
            use.run,
            {
              type: "prompt:rendered",
              nodeId: "fixer",
              templateKey: "fixer",
              phase: "fixer",
              round: use.run.fixRound,
              prompt: buildFixerPrompt(use.run.request, fixInput),
            },
            use.onEvent
          );
          use.run.currentPrompt = await use.worker.fix(
            use.run.request,
            fixInput,
            workerContext(
              use.run,
              "fixer",
              "fixer",
              use.run.fixRound,
              use.onEvent
            )
          );
          await pushRunEvent(
            use.run,
            {
              type: "fix:end",
              round: use.run.fixRound,
              prompt: use.run.currentPrompt,
            },
            use.onEvent
          );
          await use.runStore.save(use.run);
          return goto("execute", "retry after fix");
        },
      }),
      step(
        "result",
        async ({ state, use }) => {
          const phase =
            state.resultPhase === "passed" || state.resultPhase === "cancelled"
              ? state.resultPhase
              : "failed";
          await pushCheckpoint(
            use.run,
            "result",
            use.run.executionRound,
            use.onEvent
          );
          await finish(use.run, use.runStore, phase, use.onEvent);
          return done({ phase });
        },
        {
          description: "Persist the terminal run state.",
          kind: "result",
          label: "Result",
        }
      ),
    ],
  });

  await app.start(undefined, { runId: use.run.id });
}

async function applyEvaluation(
  run: RunRecord,
  evaluation: Evaluation,
  executionRound: number,
  onEvent?: RunLoopObserver
): Promise<void> {
  run.latestEvaluation = evaluation;
  run.latestScore = evaluation.score;
  run.latestError = evaluation.error;
  await pushRunEvent(
    run,
    {
      type: "evaluate:end",
      round: executionRound,
      score: evaluation.score,
      passed: evaluation.passed,
    },
    onEvent
  );
}

async function finish(
  run: RunRecord,
  runStore: RunStorePort,
  phase: RunRecord["phase"],
  onEvent?: RunLoopObserver
): Promise<void> {
  run.phase = phase;
  await pushRunEvent(run, { type: "run:end", runId: run.id, phase }, onEvent);
  await runStore.save(run);
}

function isOperationCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === "Operation cancelled.";
}

async function assertRunIsActive(use: EvalExecHarnessUse): Promise<void> {
  const stored = await use.runStore.get(use.run.id);
  if (stored?.cancelled) use.run.cancelled = true;
  if (use.run.cancelled) throw new Error("Operation cancelled.");
}

function stepIdForCheckpoint(nodeId: RunLoopCheckpointNodeId): string {
  if (nodeId === "prepare-request") return "prepare";
  if (nodeId === "executor") return "execute";
  if (nodeId === "evaluator") return "evaluate";
  if (nodeId === "decision") return "decide";
  if (nodeId === "fixer") return "fix";
  return "result";
}

async function pushRunEvent(
  run: RunRecord,
  event: RunLoopEvent,
  onEvent?: RunLoopObserver
): Promise<void> {
  run.events.push(event);
  await onEvent?.(event);
}

function workerContext(
  run: RunRecord,
  nodeId: WorkerStreamEvent["nodeId"],
  phase: WorkerStreamEvent["phase"],
  round: number,
  onEvent?: RunLoopObserver
) {
  return {
    nodeId,
    phase,
    round,
    emit: (event: WorkerStreamEvent) => pushRunEvent(run, event, onEvent),
  };
}

async function pushCheckpoint(
  run: RunRecord,
  nodeId: RunLoopCheckpointNodeId,
  round: number,
  onEvent?: RunLoopObserver
): Promise<void> {
  const state: Record<string, unknown> = {
    nodeId,
    request: run.request,
    currentPrompt: run.currentPrompt,
    executionRound: run.executionRound,
    fixRound: run.fixRound,
  };
  if (run.latestAttempt) state.attempt = run.latestAttempt;
  if (run.latestEvaluation) state.evaluation = run.latestEvaluation;
  await pushRunEvent(
    run,
    {
      type: "checkpoint:created",
      checkpointId: crypto.randomUUID(),
      nodeId,
      round,
      state,
    },
    onEvent
  );
}

export function toRunResponse(run: RunRecord, adapter: string): RunResponse {
  return RunResponseSchema.parse({
    runId: run.id,
    phase: run.phase,
    adapter,
    request: run.request,
    output: run.latestAttempt?.output,
    score: run.latestScore,
    error: run.latestError,
    evidence: run.evidence,
    attempt: run.latestAttempt,
    evaluation: run.latestEvaluation,
    events: run.events,
    executionRound: run.executionRound,
    fixRound: run.fixRound,
  });
}
