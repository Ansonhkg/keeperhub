export type TemplateSpec = {
  readonly name: string;
  readonly version: string;
  readonly placeholders: readonly string[];
  readonly outputSchema: string;
};

export type LoadedTemplate = {
  readonly skill: string;
  readonly spec: TemplateSpec;
};

const templates: Readonly<Record<string, LoadedTemplate>> = {
  "entity-extractor": {
    skill:
      "Extract canonical entities from user intent. Return schema-valid JSON only.",
    spec: {
      name: "entity-extractor",
      version: "1.0.0",
      placeholders: ["intent"],
      outputSchema: "EntityExtractionResult",
    },
  },
  "intent-decomposer": {
    skill:
      "Decompose canonical entities into ordered workflow intent steps. Return schema-valid JSON only.",
    spec: {
      name: "intent-decomposer",
      version: "1.0.0",
      placeholders: ["intent", "entities"],
      outputSchema: "IntentPlan",
    },
  },
  "search-query-builder": {
    skill:
      "Build semantic catalog search queries from intent steps. Return schema-valid JSON only.",
    spec: {
      name: "search-query-builder",
      version: "1.0.0",
      placeholders: ["intentPlan"],
      outputSchema: "SearchQueries",
    },
  },
  "catalog-ranker": {
    skill:
      "Rank catalog candidates by native fit, safety, credentials, and output match. Return schema-valid JSON only.",
    spec: {
      name: "catalog-ranker",
      version: "1.0.0",
      placeholders: ["candidates"],
      outputSchema: "RankedCandidates",
    },
  },
  "candidate-evaluator": {
    skill:
      "Evaluate dynamic workflow requirements against catalog capability manifests. Prefer native and protocol candidates. Classify each candidate as accepted, rejected, or needs_input, and label relationships as competing, complementary, required_bundle, optional, or fallback. Return schema-valid JSON only.",
    spec: {
      name: "candidate-evaluator",
      version: "1.0.0",
      placeholders: [
        "sourceText",
        "dynamicRequirements",
        "candidates",
        "fallbackEvaluation",
      ],
      outputSchema: "CandidateEvaluationResult",
    },
  },
  "option-generator": {
    skill:
      "Generate selectable, patch-backed workflow options from ranked catalog candidates. Return schema-valid JSON only.",
    spec: {
      name: "option-generator",
      version: "1.0.0",
      placeholders: ["intentPlan", "candidates"],
      outputSchema: "BuilderOptions",
    },
  },
  "prediction-engine": {
    skill:
      "Predict grey future branch steps for every current option. Return schema-valid JSON only.",
    spec: {
      name: "prediction-engine",
      version: "1.0.0",
      placeholders: ["options"],
      outputSchema: "CandidateBranches",
    },
  },
  repair: {
    skill:
      "Repair invalid JSON output to match requested schema without adding unsupported capabilities. Return schema-valid JSON only.",
    spec: {
      name: "repair",
      version: "1.0.0",
      placeholders: ["invalidOutput", "schema"],
      outputSchema: "RepairedOutput",
    },
  },
};

export function loadTemplate(name: string): LoadedTemplate {
  const template = templates[name];
  if (!template) {
    throw new Error(`Unknown template: ${name}`);
  }
  return template;
}

export function listTemplates(): readonly LoadedTemplate[] {
  return Object.values(templates);
}
