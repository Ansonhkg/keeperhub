import { z } from "zod";
import { type EvaluationMode, EvaluationModeSchema } from "../schemas.js";
import policy from "./policy.json" with { type: "json" };

const ModePolicySchema = z
  .object({
    successCriteria: z.array(z.string()),
    rubric: z.array(z.string()),
  })
  .strict();

export const RequestPolicySchema = z
  .object({
    defaultTask: z.string().min(1),
    fallbackAssumptions: z
      .object({
        default: z.string().min(1),
        exact: z.string().min(1),
      })
      .strict(),
    workflow: z.array(z.string().min(1)),
    modes: z.record(EvaluationModeSchema, ModePolicySchema),
  })
  .strict();

export type RequestPolicy = z.infer<typeof RequestPolicySchema>;

let cachedPolicy: RequestPolicy | null = null;

export function getRequestPolicy(): RequestPolicy {
  cachedPolicy ??= RequestPolicySchema.parse(policy);
  return cachedPolicy;
}

export function getModePolicy(mode: EvaluationMode) {
  return getRequestPolicy().modes[mode];
}
