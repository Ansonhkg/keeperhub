import { z } from "zod";

import {
  INTENT_CONNECTORS,
  REQUIREMENT_KINDS,
  REQUIREMENT_STATUSES,
  RESOLVED_REQUIREMENT_STATUS,
  UNRESOLVED_REQUIREMENT_STATUSES,
} from "./contracts";

export const RequirementStatusSchema = z.enum(REQUIREMENT_STATUSES);
export const UnresolvedRequirementStatusSchema = z.enum(
  UNRESOLVED_REQUIREMENT_STATUSES
);
export const RequirementKindSchema = z.enum(REQUIREMENT_KINDS);
export const IntentConnectorSchema = z.enum(INTENT_CONNECTORS);

export const CapabilityIntentSchema = z
  .object({
    action: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    channel: z.string().min(1).optional(),
    resource: z.string().min(1).optional(),
    operation: z.string().min(1).optional(),
  })
  .strict();

export const IntentRequirementSchema = z
  .object({
    id: z.string().min(1),
    kind: RequirementKindSchema,
    status: RequirementStatusSchema,
    summary: z.string().min(1),
    sourceText: z.string().min(1).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    capabilityIntent: CapabilityIntentSchema.optional(),
    question: z.string().min(1).optional(),
    blocksMaterialization: z.boolean().optional(),
  })
  .strict()
  .superRefine((requirement, context) => {
    if (
      requirement.status !== RESOLVED_REQUIREMENT_STATUS &&
      requirement.blocksMaterialization &&
      !requirement.question
    ) {
      context.addIssue({
        code: "custom",
        message: "blocking unresolved requirements must include a question",
        path: ["question"],
      });
    }
  });

export const IntentClauseSchema = z
  .object({
    id: z.string().min(1),
    sourceText: z.string().min(1),
    connector: IntentConnectorSchema.optional(),
    requirements: z.array(IntentRequirementSchema).min(1),
  })
  .strict();

export const UnresolvedRequirementSchema = z
  .object({
    requirementId: z.string().min(1),
    status: UnresolvedRequirementStatusSchema,
    question: z.string().min(1),
    blocksMaterialization: z.boolean(),
  })
  .strict();

export const BuilderAssumptionSchema = z
  .object({
    id: z.string().min(1),
    summary: z.string().min(1),
    reason: z.string().min(1),
    requirementIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const BuilderIntentDraftSchema = z
  .object({
    schemaVersion: z.literal("agentic-builder.intent.v1"),
    prompt: z.string().min(1),
    clauses: z.array(IntentClauseSchema).min(1),
    unresolved: z.array(UnresolvedRequirementSchema),
    assumptions: z.array(BuilderAssumptionSchema),
  })
  .strict()
  .superRefine((draft, context) => {
    const requirementIds = new Set<string>();

    for (const clause of draft.clauses) {
      for (const requirement of clause.requirements) {
        if (requirementIds.has(requirement.id)) {
          context.addIssue({
            code: "custom",
            message: `duplicate requirement id '${requirement.id}'`,
            path: ["clauses"],
          });
        }
        requirementIds.add(requirement.id);
      }
    }

    for (const unresolved of draft.unresolved) {
      if (!requirementIds.has(unresolved.requirementId)) {
        context.addIssue({
          code: "custom",
          message: `unresolved requirement '${unresolved.requirementId}' does not reference a requirement`,
          path: ["unresolved"],
        });
      }
    }
  });

export type BuilderIntentDraftInput = z.input<typeof BuilderIntentDraftSchema>;
