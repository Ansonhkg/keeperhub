import { JsonContracts, renderJsonContract } from "../json-contracts.js";
import type {
  Attempt,
  FixInput,
  PrepareRequest,
  RunRequest,
} from "../schemas.js";
import { getSkillTemplate, renderTemplate } from "../templates/loader.js";
import { normalizeText } from "./request-policy.js";

export function buildPreparePrompt(
  input: PrepareRequest,
  resolvedWorkdir: string
): string {
  return renderTemplate(getSkillTemplate("prepare").body, {
    requestSchema: renderJsonContract(JsonContracts.runRequestDraft),
    resolvedWorkdir,
    intent: normalizeText(input.intent) || "<none provided>",
    partialRequest: JSON.stringify(input.request ?? {}, null, 2),
  });
}

export function buildExecutorPrompt(
  request: RunRequest,
  prompt: string,
  round: number
): string {
  return renderTemplate(getSkillTemplate("executor").body, {
    round: String(round),
    attemptSchema: renderJsonContract(JsonContracts.attempt),
    prompt,
    requestJson: JSON.stringify(request, null, 2),
  });
}

export function buildEvaluatorPrompt(
  request: RunRequest,
  attempt: Attempt,
  round: number
): string {
  return renderTemplate(getSkillTemplate("evaluator").body, {
    round: String(round),
    evaluationSchema: renderJsonContract(JsonContracts.evaluation),
    requestJson: JSON.stringify(request, null, 2),
    attemptJson: JSON.stringify(attempt, null, 2),
  });
}

export function buildFixerPrompt(request: RunRequest, input: FixInput): string {
  return renderTemplate(getSkillTemplate("fixer").body, {
    executionRound: String(input.executionRound),
    fixRound: String(input.fixRound),
    fixSchema: renderJsonContract(JsonContracts.fixerOutput),
    requestJson: JSON.stringify(request, null, 2),
    fixInputJson: JSON.stringify(input, null, 2),
  });
}

export function buildHumanSummary(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
