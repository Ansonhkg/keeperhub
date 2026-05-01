import evaluationPolicyArtifact from "./generated/policy.json";
import type { EvaluationPolicy } from "./contracts";

export const evaluationPolicy = evaluationPolicyArtifact as EvaluationPolicy;
