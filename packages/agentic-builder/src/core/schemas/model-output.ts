import { z } from "zod";
import {
  builderOptionSchema,
  builderPatchSchema,
  candidateEvaluationSchema,
  catalogCandidateSchema,
  catalogEvaluationResultSchema,
  decisionGroupSchema,
  dynamicRequirementSchema,
  entitySchema,
  intentPlanSchema,
} from "./all";

const predictionEngineOutputSchema = z.object({
  predictions: z
    .array(
      z.object({
        optionId: z.string().min(1),
        patch: builderPatchSchema,
      })
    )
    .default([]),
});

const entityExtractionResultSchema = z.object({
  entities: z.array(entitySchema).default([]),
});

const candidateEvaluatorModelOutputSchema = z
  .object({
    decisionGroups: z.array(decisionGroupSchema).default([]),
    dynamicRequirements: z.array(dynamicRequirementSchema).default([]),
    evidence: z.array(candidateEvaluationSchema).default([]),
  })
  .or(catalogEvaluationResultSchema);

const schemasByName = new Map<string, z.ZodType>([
  ["{ entities: Entity[] }", entityExtractionResultSchema],
  ["EntityExtractionResult", entityExtractionResultSchema],
  ["IntentPlan", intentPlanSchema],
  ["BuilderOption[]", z.array(builderOptionSchema)],
  ["BuilderOptions", z.array(builderOptionSchema)],
  ["CandidateEvaluationResult", candidateEvaluatorModelOutputSchema],
  ["CatalogCandidate[]", z.array(catalogCandidateSchema)],
  ["RankedCandidates", z.array(catalogCandidateSchema)],
  ["CandidateBranches", predictionEngineOutputSchema],
]);

export function modelOutputSchemaForName(name: string): z.ZodType | undefined {
  return schemasByName.get(name);
}

export function modelOutputJsonSchemaForName(name: string): string {
  const schema = modelOutputSchemaForName(name);
  if (!schema) {
    return JSON.stringify(
      {
        additionalProperties: true,
        description: `No registered runtime schema for ${name}; return JSON matching the named schema.`,
        type: "object",
      },
      null,
      2
    );
  }
  return JSON.stringify(z.toJSONSchema(schema), null, 2);
}
