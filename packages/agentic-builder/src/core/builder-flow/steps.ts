export const builderStartStepIds = {
  candidateEvaluation: "candidateEvaluation",
  candidateRanking: "candidateRanking",
  catalogSearch: "catalogSearch",
  intentPlanner: "intentPlanner",
  optionGeneration: "optionGeneration",
  previewProjection: "previewProjection",
  requirementResolution: "requirementResolution",
} as const;

export const builderActionStepIds = {
  eventsList: "eventsList",
  nativeCapabilityRequest: "nativeCapabilityRequest",
  nodeRegenerate: "nodeRegenerate",
  optionReject: "optionReject",
  optionSelect: "optionSelect",
  projectionGet: "projectionGet",
  questionAnswer: "questionAnswer",
  sessionCancel: "sessionCancel",
  workflowMaterialize: "workflowMaterialize",
} as const;
