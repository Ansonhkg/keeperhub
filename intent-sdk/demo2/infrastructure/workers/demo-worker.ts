import type {
  EvalExecWorkerPort,
  WorkerInvocationContext,
} from "../../core/providers.js";
import type {
  Attempt,
  Evaluation,
  FixInput,
  PrepareRequest,
  RunRequest,
  RunRequestDraft,
} from "../../core/schemas.js";
import { normalizeText } from "../../core/services/request-policy.js";

export class DemoWorker implements EvalExecWorkerPort {
  readonly name = "demo";

  async prepare(
    input: PrepareRequest,
    resolvedWorkdir: string,
    context?: WorkerInvocationContext
  ): Promise<RunRequestDraft> {
    await emitDemoEvent(
      context,
      "worker.item.started",
      "model_step",
      "Preparing request"
    );
    return {
      task: normalizeText(input.request?.task) || normalizeText(input.intent),
      workdir:
        normalizeText(input.request?.workdir) ||
        normalizeText(input.workdir) ||
        resolvedWorkdir,
      evaluationMode:
        input.request?.evaluationMode ??
        (input.request?.expectedAnswer ? "exact" : "score"),
      expectedAnswer: input.request?.expectedAnswer,
      responseFormat: input.request?.responseFormat ?? "human",
    };
  }

  async execute(
    _request: RunRequest,
    prompt: string,
    round: number,
    context?: WorkerInvocationContext
  ): Promise<Attempt> {
    await emitDemoEvent(
      context,
      "worker.item.started",
      "model_step",
      `Executor started round ${round}`
    );
    const output = `attempt ${round}: ${prompt}`;
    const passed = prompt.includes("fixed-");
    await emitDemoEvent(
      context,
      "worker.item.completed",
      "assistant_message",
      `Executor produced attempt ${round}`
    );
    return {
      output,
      evidence: passed
        ? ["demo worker observed a fixed prompt marker after a repair round"]
        : [],
      missingRequirements: passed
        ? []
        : ["Prompt still needs a repair-round marker"],
      complete: passed,
    };
  }

  async evaluate(
    _request: RunRequest,
    attempt: Attempt,
    _round: number,
    context?: WorkerInvocationContext
  ): Promise<Evaluation> {
    await emitDemoEvent(
      context,
      "worker.item.started",
      "model_step",
      "Evaluator started review"
    );
    const passed = attempt.complete;
    await emitDemoEvent(
      context,
      "worker.item.completed",
      "model_step",
      passed
        ? "Evaluator passed the attempt"
        : "Evaluator found missing requirements"
    );
    return {
      score: passed ? 1 : 0.6,
      passed,
      error: passed ? undefined : "Output did not satisfy the evaluator",
    };
  }

  async fix(
    _request: RunRequest,
    { prompt, fixRound }: FixInput,
    context?: WorkerInvocationContext
  ): Promise<string> {
    await emitDemoEvent(
      context,
      "worker.item.started",
      "model_step",
      `Fixer started repair ${fixRound}`
    );
    await emitDemoEvent(
      context,
      "worker.item.completed",
      "assistant_message",
      `Fixer produced repair ${fixRound}`
    );
    return `${prompt} | fixed-${fixRound}`;
  }
}

async function emitDemoEvent(
  context: WorkerInvocationContext | undefined,
  type: "worker.item.started" | "worker.item.completed",
  itemKind: "model_step" | "assistant_message",
  preview: string
) {
  await context?.emit?.({
    type,
    provider: "demo",
    nodeId: context.nodeId,
    phase: context.phase,
    round: context.round,
    itemId: `demo-${context.phase}-${context.round}-${itemKind}`,
    itemKind,
    title: preview,
    preview,
    rawType: "demo",
    raw: { preview },
  });
}
