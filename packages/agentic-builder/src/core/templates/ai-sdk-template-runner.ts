import type { AiTemplateRunnerPort } from "../ports/all";
import { loadTemplate } from "./loader";

export function createDeterministicTemplateRunner(): AiTemplateRunnerPort {
  return {
    async run(input, validate) {
      loadTemplate(input.templateName);
      const startedAt = Date.now();
      const syntheticOutput = synthesizeTemplateOutput(
        input.templateName,
        input.variables
      );
      return {
        output: validate(syntheticOutput),
        model: "deterministic-template-runner",
        durationMs: Date.now() - startedAt,
        repairAttempts: 0,
      };
    },
  };
}

function synthesizeTemplateOutput(
  templateName: string,
  variables: Readonly<Record<string, string>>
): unknown {
  if (templateName === "entity-extractor") {
    const intent = variables.intent ?? "";
    return {
      entities: [
        ...(intent.toLowerCase().includes("eth")
          ? [
              {
                id: "entity-asset-eth",
                kind: "asset",
                label: "ETH",
                canonicalValue: "ETH",
                confidence: 0.95,
              },
            ]
          : []),
        {
          id: "entity-schedule-15m",
          kind: "schedule",
          label: "Every 15 minutes",
          canonicalValue: "PT15M",
          confidence: 0.9,
        },
        {
          id: "entity-channel",
          kind: "channel",
          label: "notification channel",
          confidence: 0.55,
        },
      ],
    };
  }
  if (templateName === "intent-decomposer") {
    return {
      id: "intent-plan-template-output",
      sourceText:
        variables.intent ?? "Get ETH price every 15 mins and notify me",
      entities: JSON.parse(variables.entities || "[]") as unknown,
      steps: [
        {
          id: "step-schedule",
          kind: "trigger",
          label: "Run every 15 minutes",
          dependsOn: [],
          requiredEntityIds: ["entity-schedule-15m"],
          status: "ready",
        },
        {
          id: "step-read-price",
          kind: "read",
          label: "Read ETH/USD price",
          dependsOn: ["step-schedule"],
          requiredEntityIds: ["entity-asset-eth"],
          status: "ready",
        },
        {
          id: "step-notify",
          kind: "notify",
          label: "Notify user",
          dependsOn: ["step-read-price"],
          requiredEntityIds: ["entity-channel"],
          status: "needs_answer",
        },
      ],
      openQuestionIds: ["question-notification-channel"],
    };
  }
  if (templateName === "catalog-ranker") {
    return JSON.parse(variables.candidates || "[]") as unknown;
  }
  if (templateName === "candidate-evaluator") {
    return JSON.parse(variables.fallbackEvaluation || "{}") as unknown;
  }
  if (templateName === "option-generator") {
    const intentPlan = JSON.parse(variables.intentPlan) as {
      steps: Array<{ id: string }>;
    };
    const candidates = JSON.parse(variables.candidates) as Array<{
      id: string;
      provider: string;
      label: string;
      description: string;
      requiredInputs: string[];
      score: number;
    }>;
    return candidates.slice(0, 3).map((candidate, index) => {
      const stepId =
        intentPlan.steps[Math.min(index + 1, intentPlan.steps.length - 1)]
          ?.id ?? "step-notify";
      return {
        id: `option-${candidate.id}`,
        stepId,
        strategy:
          candidate.provider === "native" || candidate.provider === "protocol"
            ? "native_action"
            : candidate.provider === "missing"
              ? "request_native_capability"
              : "fallback_action",
        title: candidate.label,
        rationale: candidate.description,
        risk:
          candidate.provider === "missing"
            ? "high"
            : candidate.provider === "native" ||
                candidate.provider === "protocol"
              ? "low"
              : "medium",
        confidence: candidate.score,
        candidateIds: [candidate.id],
        patch: {
          id: `patch-${candidate.id}`,
          summary: `Use ${candidate.label}`,
          ops: [
            {
              op: "update_step",
              stepId,
              changes: {
                label: candidate.label,
                status: candidate.provider === "missing" ? "blocked" : "ready",
              },
            },
          ],
        },
        requiredInputs: candidate.requiredInputs,
      };
    });
  }
  if (templateName === "prediction-engine") {
    const options = JSON.parse(variables.options || "[]") as Array<{
      id: string;
      stepId: string;
      title: string;
    }>;
    return {
      predictions: options.map((option) => ({
        optionId: option.id,
        patch: {
          id: `prediction-${option.id}`,
          ops: [
            {
              op: "add_step",
              step: {
                dependsOn: [option.stepId],
                id: `future-${option.id}`,
                kind: "notify",
                label: `Future follow-up after ${option.title}`,
                requiredEntityIds: [],
                status: "planned",
              },
            },
            {
              fromStepId: option.stepId,
              op: "add_edge",
              toStepId: `future-${option.id}`,
            },
          ],
          summary: `Predict next step after ${option.title}`,
        },
      })),
    };
  }
  return { repaired: true };
}
