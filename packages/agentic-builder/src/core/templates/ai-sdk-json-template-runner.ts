import type { LanguageModelV2 } from "@ai-sdk/provider";
import { generateText } from "ai";
import type { AiTemplateRunnerPort } from "../ports/all";
import { modelOutputJsonSchemaForName } from "../schemas/model-output";
import { loadTemplate } from "./loader";

export function createAiSdkJsonTemplateRunner(
  model: LanguageModelV2 | string
): AiTemplateRunnerPort {
  return {
    async run(input, validate) {
      const template = loadTemplate(input.templateName);
      const startedAt = Date.now();
      const prompt = [
        template.skill,
        `Template: ${template.spec.name}@${template.spec.version}`,
        `Output schema: ${input.outputSchemaName}`,
        "JSON schema:",
        modelOutputJsonSchemaForName(input.outputSchemaName),
        "Return only one valid JSON value. Do not wrap in markdown.",
        "Variables:",
        JSON.stringify(input.variables, null, 2),
      ].join("\n\n");
      const first = await generateText({ model, prompt });
      const firstParsed = parseJson(first.text);
      if (firstParsed.ok) {
        try {
          return {
            output: validate(firstParsed.value),
            model: typeof model === "string" ? model : "ai-sdk-language-model",
            durationMs: Date.now() - startedAt,
            repairAttempts: 0,
          };
        } catch (error) {
          return repairAndValidate({
            durationStartedAt: startedAt,
            invalidOutput: first.text,
            model,
            outputSchemaName: input.outputSchemaName,
            reason: error instanceof Error ? error.message : String(error),
            validate,
          });
        }
      }
      return repairAndValidate({
        durationStartedAt: startedAt,
        invalidOutput: first.text,
        model,
        outputSchemaName: input.outputSchemaName,
        reason: "Output was not valid JSON",
        validate,
      });
    },
  };
}

async function repairAndValidate<TOutput>({
  durationStartedAt,
  invalidOutput,
  model,
  outputSchemaName,
  reason,
  validate,
}: {
  readonly durationStartedAt: number;
  readonly invalidOutput: string;
  readonly model: Parameters<typeof generateText>[0]["model"];
  readonly outputSchemaName: string;
  readonly reason: string;
  readonly validate: (output: unknown) => TOutput;
}) {
  const repairTemplate = loadTemplate("repair");
  const repaired = await generateText({
    model,
    prompt: [
      repairTemplate.skill,
      `Schema: ${outputSchemaName}`,
      "JSON schema:",
      modelOutputJsonSchemaForName(outputSchemaName),
      "Validation failure:",
      reason,
      "Invalid output:",
      invalidOutput,
      "Return only repaired JSON.",
    ].join("\n\n"),
  });
  const repairedParsed = parseJson(repaired.text);
  if (!repairedParsed.ok) {
    throw new Error("AI template output was not valid JSON after repair");
  }
  return {
    output: validate(repairedParsed.value),
    model: typeof model === "string" ? model : "ai-sdk-language-model",
    durationMs: Date.now() - durationStartedAt,
    repairAttempts: 1,
  };
}

function parseJson(
  text: string
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text.trim()) };
  } catch {
    return { ok: false };
  }
}
