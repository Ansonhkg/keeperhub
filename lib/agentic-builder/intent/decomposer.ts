import builderIntentDraftJsonSchema from "./generated/builder-intent-draft.schema.json";
import promptGuidance from "./generated/prompt-guidance.json";
import { BuilderIntentDraftSchema } from "./schema";
import {
  getSkillTemplate,
  renderSkillTemplate,
} from "../templates/loader";

export type IntentDecomposerPromptInput = {
  userPrompt: string;
  capabilityCatalogSummary: string;
  contextSummary?: string;
};

export function buildIntentDecomposerPrompt(input: IntentDecomposerPromptInput): string {
  const template = getSkillTemplate("intent-decomposer");

  return renderSkillTemplate(template, {
    userPrompt: input.userPrompt,
    intentSchema: JSON.stringify(builderIntentDraftJsonSchema, null, 2),
    requirementStatusGuide: promptGuidance.requirementStatusGuide,
    requirementKindGuide: promptGuidance.requirementKindGuide,
    builderRuleGuide: promptGuidance.builderRuleGuide,
    capabilityCatalogSummary: input.capabilityCatalogSummary,
    contextSummary: input.contextSummary ?? "No additional workflow context was provided.",
  });
}

export function parseIntentDraft(value: unknown) {
  return BuilderIntentDraftSchema.parse(value);
}
