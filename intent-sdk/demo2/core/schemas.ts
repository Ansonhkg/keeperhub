import { z } from "zod";

export const PhaseSchema = z.enum([
  "queued",
  "running",
  "passed",
  "failed",
  "cancelled",
]);
export const ResponseFormatSchema = z.enum(["human", "json", "both"]);
export const EvaluationModeSchema = z.enum(["pass_fail", "score", "exact"]);

export const LoopConfigSchema = z
  .object({
    scoreThreshold: z.number().min(0).max(1).default(0.995),
    maxExecutionRounds: z.number().int().min(1).default(5),
    maxFixRounds: z.number().int().min(0).default(3),
    requireRealEvidence: z.boolean().default(true),
  })
  .strict();

export const RunRequestDraftSchema = z
  .object({
    task: z.string().optional(),
    workdir: z.string().optional(),
    responseFormat: ResponseFormatSchema.optional(),
    successCriteria: z.array(z.string()).optional(),
    evaluationMode: EvaluationModeSchema.optional(),
    scoreThreshold: z.number().min(0).max(1).optional(),
    expectedAnswer: z.string().optional(),
    rubric: z.array(z.string()).optional(),
    maxExecutionRounds: z.number().int().min(1).optional(),
    maxFixRounds: z.number().int().min(0).optional(),
    maxDepth: z.number().int().min(1).optional(),
    executorModel: z.string().optional(),
    evaluatorModel: z.string().optional(),
    fixerModel: z.string().optional(),
    manualStepMode: z.boolean().optional(),
  })
  .strict();

export const RunRequestSchema = z
  .object({
    task: z.string().min(1),
    workdir: z.string().min(1),
    responseFormat: ResponseFormatSchema.default("human"),
    successCriteria: z.array(z.string()).default([]),
    evaluationMode: EvaluationModeSchema.default("score"),
    scoreThreshold: z.number().min(0).max(1).default(0.995),
    expectedAnswer: z.string().optional(),
    rubric: z.array(z.string()).default([]),
    maxExecutionRounds: z.number().int().min(1).default(5),
    maxFixRounds: z.number().int().min(0).default(3),
    maxDepth: z.number().int().min(1).default(2),
    executorModel: z.string().optional(),
    evaluatorModel: z.string().optional(),
    fixerModel: z.string().optional(),
    manualStepMode: z.boolean().default(false),
  })
  .strict();

export const PrepareRequestSchema = z
  .object({
    intent: z.string().optional(),
    request: RunRequestDraftSchema.optional(),
    workdir: z.string().optional(),
    model: z.string().optional(),
  })
  .strict();

export const AttemptSchema = z
  .object({
    output: z.string(),
    evidence: z.array(z.string()).default([]),
    missingRequirements: z.array(z.string()).default([]),
    complete: z.boolean(),
  })
  .strict();

export const EvaluationSchema = z
  .object({
    score: z.number().min(0).max(1),
    passed: z.boolean(),
    error: z.string().optional(),
  })
  .strict();

export const FixInputSchema = z
  .object({
    prompt: z.string(),
    attempt: AttemptSchema,
    evaluation: EvaluationSchema,
    executionRound: z.number().int().min(1),
    fixRound: z.number().int().min(1),
  })
  .strict();

export const FixerOutputSchema = z
  .object({
    prompt: z.string().min(1),
  })
  .strict();

export const WorkerItemEventTypeSchema = z.enum([
  "worker.item.started",
  "worker.item.delta",
  "worker.item.completed",
  "worker.item.failed",
]);

export const WorkerItemKindSchema = z.enum([
  "model_step",
  "assistant_message",
  "tool_call",
  "tool_output",
  "reasoning",
]);

export const WorkerNodeIdSchema = z.enum([
  "prepare-request",
  "executor",
  "evaluator",
  "fixer",
]);
export const WorkerPhaseSchema = z.enum([
  "prepare",
  "executor",
  "evaluator",
  "fixer",
]);

export const WorkerProviderRefsSchema = z
  .object({
    sessionId: z.string().optional(),
    messageId: z.string().optional(),
    partId: z.string().optional(),
    callId: z.string().optional(),
    itemId: z.string().optional(),
  })
  .strict();

export const WorkerStreamEventSchema = z
  .object({
    type: WorkerItemEventTypeSchema,
    provider: z.string().min(1),
    nodeId: WorkerNodeIdSchema,
    phase: WorkerPhaseSchema,
    round: z.number().int().min(0),
    itemId: z.string().min(1),
    parentItemId: z.string().min(1).optional(),
    providerRefs: WorkerProviderRefsSchema.optional(),
    itemKind: WorkerItemKindSchema,
    title: z.string().min(1),
    preview: z.string().min(1),
    text: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    rawType: z.string().optional(),
    raw: z.unknown().optional(),
    error: z.string().optional(),
  })
  .strict();

export const PrepareResponseSchema = z
  .object({
    preparedRequest: RunRequestSchema,
    workdirResolved: z.string().min(1),
    source: z.enum(["adapter", "fallback"]),
    assumptions: z.array(z.string()).default([]),
    adapter: z.string().min(1),
    config: LoopConfigSchema,
    workflow: z.array(z.string()).default([]),
  })
  .strict();

export const RunEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run:start"), runId: z.string() }).strict(),
  z
    .object({
      type: z.literal("checkpoint:created"),
      checkpointId: z.string().min(1),
      nodeId: z.enum([
        "prepare-request",
        "executor",
        "evaluator",
        "decision",
        "fixer",
        "result",
      ]),
      round: z.number().int().min(0),
      state: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("prompt:rendered"),
      nodeId: z.enum(["executor", "evaluator", "fixer"]),
      templateKey: z.enum(["executor", "evaluator", "fixer"]),
      phase: z.enum(["executor", "evaluator", "fixer"]),
      round: z.number().int().min(1),
      prompt: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("execute:start"),
      round: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("execute:end"),
      round: z.number().int().min(1),
      output: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("evaluate:start"),
      round: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("evaluate:end"),
      round: z.number().int().min(1),
      score: z.number(),
      passed: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("fix:start"),
      round: z.number().int().min(1),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("fix:end"),
      round: z.number().int().min(1),
      prompt: z.string(),
    })
    .strict(),
  WorkerStreamEventSchema,
  z
    .object({
      type: z.literal("run:end"),
      runId: z.string(),
      phase: PhaseSchema,
    })
    .strict(),
]);

export const RunRecordSchema = z
  .object({
    id: z.string().min(1),
    phase: PhaseSchema,
    input: z.string(),
    request: RunRequestSchema,
    currentPrompt: z.string(),
    latestAttempt: AttemptSchema.optional(),
    latestEvaluation: EvaluationSchema.optional(),
    latestError: z.string().optional(),
    latestScore: z.number().optional(),
    executionRound: z.number().int().min(0),
    fixRound: z.number().int().min(0),
    evidence: z.array(z.string()).default([]),
    events: z.array(RunEventSchema).default([]),
    cancelled: z.boolean().default(false),
  })
  .strict();

export const RunResponseSchema = z
  .object({
    runId: z.string().min(1),
    phase: PhaseSchema,
    adapter: z.string().min(1),
    request: RunRequestSchema,
    output: z.string().optional(),
    score: z.number().optional(),
    error: z.string().optional(),
    evidence: z.array(z.string()).default([]),
    attempt: AttemptSchema.optional(),
    evaluation: EvaluationSchema.optional(),
    events: z.array(RunEventSchema).default([]),
    executionRound: z.number().int().min(0),
    fixRound: z.number().int().min(0),
  })
  .strict();

export const ProviderEnvSchema = z
  .object({
    backend: z.enum(["demo", "opencode"]).default("demo"),
    stateBackend: z.enum(["memory", "file"]).default("memory"),
    workdir: z.string().optional(),
    dataDir: z.string().optional(),
    model: z.string().optional(),
    opencodeBinary: z.string().optional(),
  })
  .strict();

export type Phase = z.infer<typeof PhaseSchema>;
export type ResponseFormat = z.infer<typeof ResponseFormatSchema>;
export type EvaluationMode = z.infer<typeof EvaluationModeSchema>;
export type LoopConfig = z.infer<typeof LoopConfigSchema>;
export type RunRequestDraft = z.infer<typeof RunRequestDraftSchema>;
export type RunRequest = z.infer<typeof RunRequestSchema>;
export type PrepareRequest = z.infer<typeof PrepareRequestSchema>;
export type Attempt = z.infer<typeof AttemptSchema>;
export type Evaluation = z.infer<typeof EvaluationSchema>;
export type FixInput = z.infer<typeof FixInputSchema>;
export type FixerOutput = z.infer<typeof FixerOutputSchema>;
export type WorkerItemEventType = z.infer<typeof WorkerItemEventTypeSchema>;
export type WorkerItemKind = z.infer<typeof WorkerItemKindSchema>;
export type WorkerStreamEvent = z.infer<typeof WorkerStreamEventSchema>;
export type PrepareResponse = z.infer<typeof PrepareResponseSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;
export type RunResponse = z.infer<typeof RunResponseSchema>;
export type ProviderEnv = z.infer<typeof ProviderEnvSchema>;
