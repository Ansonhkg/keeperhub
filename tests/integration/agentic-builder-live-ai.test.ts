import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createAiSdkJsonTemplateRunner } from "@keeperhub/agentic-builder/ai-sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getOpenAICompatibleClientOptions } from "@/lib/openai-compatible";

const hasLiveAiKey = Boolean(
  process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY
);

describe.skipIf(!hasLiveAiKey)("agentic builder live AI runner", () => {
  it("executes a schema-validated template through a real provider", async () => {
    const modelName =
      process.env.AGENTIC_BUILDER_MODEL ??
      process.env.AI_MODEL ??
      "gpt-4o-mini";
    const model =
      modelName.startsWith("claude-") && process.env.ANTHROPIC_API_KEY
        ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelName)
        : createOpenAI(
            getOpenAICompatibleClientOptions(process.env.OPENAI_API_KEY ?? "")
          ).chat(modelName);
    const runner = createAiSdkJsonTemplateRunner(model);

    const result = await runner.run(
      {
        outputSchemaName: "{ entities: Entity[] }",
        templateName: "entity-extractor",
        templateVersion: "1.0.0",
        variables: { intent: "Track ETH price every 15 minutes" },
      },
      (output) =>
        z
          .object({
            entities: z.record(z.string(), z.unknown()).array().min(1),
          })
          .parse(output)
    );

    expect(result.output.entities.length).toBeGreaterThan(0);
    expect(result.model).toBe("ai-sdk-language-model");
  }, 30_000);
});
