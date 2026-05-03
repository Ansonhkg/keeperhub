import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createAiSdkJsonTemplateRunner } from "@keeperhub/agentic-builder/ai-sdk";
import { createBuilderRuntime } from "@keeperhub/agentic-builder/runtime";
import type { BuilderAuthContext } from "@keeperhub/agentic-builder/schemas";
import { createDeterministicTemplateRunner } from "@keeperhub/agentic-builder/templates";
import { nanoid } from "nanoid";
import { getOpenAICompatibleClientOptions } from "@/lib/openai-compatible";
import { createKeeperHubCatalog } from "./keeperhub-catalog";
import { createKeeperHubFeatureRequests } from "./keeperhub-feature-requests";
import { createKeeperHubHarnessStore } from "./keeperhub-harness-store";
import { createKeeperHubWorkflowMaterializer } from "./keeperhub-materializer";
import { createKeeperHubBuilderStore } from "./keeperhub-store";
import { createOperationRecorder } from "./operation-recorder";

function createKeeperHubTemplateRunner() {
  const modelName =
    process.env.AGENTIC_BUILDER_MODEL ?? process.env.AI_MODEL ?? "gpt-4o-mini";
  if (modelName.startsWith("claude-") && process.env.ANTHROPIC_API_KEY) {
    return createAiSdkJsonTemplateRunner(
      createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelName)
    );
  }
  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI(
      getOpenAICompatibleClientOptions(process.env.OPENAI_API_KEY)
    );
    return createAiSdkJsonTemplateRunner(openai.chat(modelName));
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Agentic builder requires OPENAI_API_KEY or ANTHROPIC_API_KEY in production"
    );
  }
  if (process.env.KEEPERHUB_AGENTIC_BUILDER_ALLOW_DETERMINISTIC !== "1") {
    throw new Error(
      "Agentic builder deterministic fallback is disabled. Set KEEPERHUB_AGENTIC_BUILDER_ALLOW_DETERMINISTIC=1 for local fixture mode."
    );
  }
  return createDeterministicTemplateRunner();
}

export const keeperHubBuilderRuntime = createBuilderRuntime({
  ai: createKeeperHubTemplateRunner(),
  catalog: createKeeperHubCatalog(),
  store: createKeeperHubBuilderStore(),
  featureRequests: createKeeperHubFeatureRequests(),
  workflowMaterializer: createKeeperHubWorkflowMaterializer(),
  events: createOperationRecorder(),
  clock: { now: () => new Date().toISOString() },
  ids: { next: (prefix) => `${prefix}_${nanoid(10)}` },
  diagnostics: {
    harnessStoreFor: <TInput>(auth: BuilderAuthContext) =>
      createKeeperHubHarnessStore<TInput>(auth),
  },
});
