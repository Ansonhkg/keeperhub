import { type ZodType, z } from "zod";
import {
  AttemptSchema,
  EvaluationSchema,
  FixerOutputSchema,
  PrepareRequestSchema,
  PrepareResponseSchema,
  RunRequestDraftSchema,
  RunRequestSchema,
  RunResponseSchema,
} from "./schemas.ts";

export type JsonContract<T extends ZodType = ZodType> = {
  id: string;
  title: string;
  kind: "object";
  schema: T;
};

export const JsonContracts = {
  prepareRequest: defineJsonContract({
    id: "schema.eval-exec-v3.prepare-request",
    title: "Prepare request",
    schema: PrepareRequestSchema,
  }),
  prepareResponse: defineJsonContract({
    id: "schema.eval-exec-v3.prepare-response",
    title: "Prepare response",
    schema: PrepareResponseSchema,
  }),
  runRequestDraft: defineJsonContract({
    id: "schema.eval-exec-v3.run-request-draft",
    title: "Run request draft",
    schema: RunRequestDraftSchema,
  }),
  runRequest: defineJsonContract({
    id: "schema.eval-exec-v3.run-request",
    title: "Run request",
    schema: RunRequestSchema,
  }),
  runResponse: defineJsonContract({
    id: "schema.eval-exec-v3.run-response",
    title: "Run response",
    schema: RunResponseSchema,
  }),
  attempt: defineJsonContract({
    id: "schema.eval-exec-v3.attempt",
    title: "Executor attempt",
    schema: AttemptSchema,
  }),
  evaluation: defineJsonContract({
    id: "schema.eval-exec-v3.evaluation",
    title: "Evaluator verdict",
    schema: EvaluationSchema,
  }),
  fixerOutput: defineJsonContract({
    id: "schema.eval-exec-v3.fixer-output",
    title: "Fixer output",
    schema: FixerOutputSchema,
  }),
} as const;

export function renderJsonContract(contract: JsonContract): string {
  return JSON.stringify(z.toJSONSchema(contract.schema), null, 2);
}

function defineJsonContract<T extends ZodType>(
  input: Omit<JsonContract<T>, "kind">
): JsonContract<T> {
  return { ...input, kind: "object" };
}
