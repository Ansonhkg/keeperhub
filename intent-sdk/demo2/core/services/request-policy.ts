import { getModePolicy, getRequestPolicy } from "../request/policy.js";
import {
  type EvaluationMode,
  EvaluationModeSchema,
  type LoopConfig,
  LoopConfigSchema,
  type PrepareRequest,
  PrepareRequestSchema,
  type RunRequest,
  type RunRequestDraft,
  RunRequestDraftSchema,
  RunRequestSchema,
} from "../schemas.js";

export const defaultLoopConfig = LoopConfigSchema.parse({});

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveDefaultWorkdir(explicitWorkdir?: string): string {
  return (
    normalizeText(explicitWorkdir) ||
    normalizeText(process.env.EVAL_EXEC_V3_WORKDIR) ||
    normalizeText(process.env.EVAL_EXEC_LOOP_CALLER_CWD) ||
    normalizeText(process.env.INIT_CWD) ||
    normalizeText(process.env.PWD) ||
    process.cwd()
  );
}

export function normalizePrepareInput(
  input: string | PrepareRequest
): PrepareRequest {
  return typeof input === "string"
    ? { intent: input }
    : PrepareRequestSchema.parse(input);
}

export function defaultRubric(mode: EvaluationMode): string[] {
  return getModePolicy(mode).rubric;
}

export function defaultSuccessCriteria(mode: EvaluationMode): string[] {
  return getModePolicy(mode).successCriteria;
}

export function materializeRunRequest(
  input: RunRequestDraft,
  config: LoopConfig = defaultLoopConfig
): RunRequest {
  const draft = RunRequestDraftSchema.parse(input);
  const task = normalizeText(draft.task) || getRequestPolicy().defaultTask;
  const workdir = resolveDefaultWorkdir(draft.workdir);
  const evaluationMode = EvaluationModeSchema.parse(
    draft.evaluationMode ?? (draft.expectedAnswer ? "exact" : "score")
  );
  const scoreThreshold =
    draft.scoreThreshold ??
    (evaluationMode === "exact" ? 1 : config.scoreThreshold);

  return RunRequestSchema.parse({
    ...draft,
    task,
    workdir,
    responseFormat: draft.responseFormat ?? "human",
    evaluationMode,
    scoreThreshold,
    rubric: draft.rubric ?? defaultRubric(evaluationMode),
    successCriteria:
      draft.successCriteria ?? defaultSuccessCriteria(evaluationMode),
    maxExecutionRounds: draft.maxExecutionRounds ?? config.maxExecutionRounds,
    maxFixRounds: draft.maxFixRounds ?? config.maxFixRounds,
    maxDepth: draft.maxDepth ?? 2,
  });
}
