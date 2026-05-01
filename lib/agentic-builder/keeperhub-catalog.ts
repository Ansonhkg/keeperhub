import type { CatalogPort } from "@keeperhub/agentic-builder/ports";
import { inferCandidateCapability } from "@keeperhub/agentic-builder/runtime";
import type {
  CatalogCandidate,
  CatalogCapabilityField,
  IntentPlan,
} from "@keeperhub/agentic-builder/schemas";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workflows } from "@/lib/db/schema";
import { getRegisteredProtocols } from "@/lib/protocol-registry";
import type { ActionConfigFieldBase, OutputField } from "@/plugins/registry";
import { flattenConfigFields, getAllActions } from "@/plugins/registry";

export function createKeeperHubCatalog(): CatalogPort {
  return {
    async search({ intentPlan }) {
      return searchKeeperHubCatalog(intentPlan);
    },
  };
}

export async function searchKeeperHubCatalog(
  intentPlan: IntentPlan
): Promise<readonly CatalogCandidate[]> {
  const intentText = [
    intentPlan.sourceText,
    ...intentPlan.entities.map(
      (entity) => entity.canonicalValue ?? entity.label
    ),
    ...intentPlan.steps.map((step) => step.label),
  ].join(" ");
  const keywords = new Set(
    intentText
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
  );
  const scoreText = (text: string, base: number) => {
    const haystack = text.toLowerCase();
    const matches = [...keywords].filter((keyword) =>
      haystack.includes(keyword)
    );
    return Math.min(0.99, base + matches.length * 0.04);
  };
  const protocolSlugs = new Set(
    getRegisteredProtocols().map((protocol) => protocol.slug)
  );
  const pluginCandidates: CatalogCandidate[] = getAllActions()
    .map((action) => {
      const providerTier = protocolSlugs.has(action.integration)
        ? "protocol"
        : "native";
      return withInferredCapability({
        credentialsAvailable: action.requiresCredentials !== true,
        description: action.description,
        id: `native-${action.id}`,
        label: action.label,
        manifest: {
          actionId: action.id,
          credentialIntegrationType: action.credentialIntegrationType,
          credentialRequired: action.requiresCredentials === true,
          description: action.description,
          facts: {
            category: action.category,
            provider: action.id.split("/")[0] ?? action.category,
            slug: action.slug,
            stepFunction: action.stepFunction,
            stepImportPath: action.stepImportPath,
          },
          optionalFields: manifestFieldsFromConfig(
            flattenConfigFields(action.configFields).filter(
              (field) => field.required !== true
            )
          ),
          outputFields: manifestFieldsFromOutputs(action.outputFields ?? []),
          providerTier,
          requiredFields: manifestFieldsFromConfig(
            flattenConfigFields(action.configFields).filter(
              (field) => field.required === true
            )
          ),
          risk: action.requiresCredentials === true ? "medium" : "low",
          source: providerTier === "protocol" ? "protocol" : "plugin",
          title: action.label,
        },
        outputFields: action.outputFields?.map((field) => field.field) ?? [],
        provider: providerTier,
        requiredInputs: action.configFields.flatMap((field) =>
          field.type === "group"
            ? field.fields
                .filter((nested) => nested.required)
                .map((nested) => nested.key)
            : field.required
              ? [field.key]
              : []
        ),
        score: scoreText(`${action.label} ${action.description}`, 0.62),
      });
    })
    .sort((left, right) => right.score - left.score);
  const listedWorkflows = await db
    .select({
      description: workflows.description,
      id: workflows.id,
      name: workflows.name,
    })
    .from(workflows)
    .where(eq(workflows.isListed, true))
    .orderBy(desc(workflows.listedAt))
    .limit(12);
  const workflowCandidates: CatalogCandidate[] = listedWorkflows.map(
    (workflow) =>
      withInferredCapability({
        credentialsAvailable: true,
        description:
          workflow.description ??
          "Reuse an existing listed KeeperHub workflow as a nested action.",
        id: `workflow-${workflow.id}`,
        label: workflow.name,
        manifest: {
          credentialRequired: false,
          description:
            workflow.description ??
            "Reuse an existing listed KeeperHub workflow as a nested action.",
          facts: { workflowId: workflow.id },
          optionalFields: [],
          outputFields: [
            {
              key: "workflowRunId",
              label: "Workflow Run Id",
              type: "string",
            },
          ],
          providerTier: "workflow",
          requiredFields: intentPlan.entities.map((entity) => ({
            key: entity.kind,
            label: entity.label,
            type: "entity",
          })),
          risk: "medium",
          source: "workflow",
          title: workflow.name,
        },
        outputFields: ["workflowRunId"],
        provider: "workflow",
        requiredInputs: intentPlan.entities.map((entity) => entity.kind),
        score: scoreText(
          `${workflow.name} ${workflow.description ?? ""}`,
          0.58
        ),
      })
  );
  const missingCandidates: CatalogCandidate[] = intentPlan.steps
    .filter((step) => step.status === "blocked")
    .map((step) =>
      withInferredCapability({
        credentialsAvailable: false,
        description: `Capture missing native capability for: ${step.label}`,
        id: `missing-${step.id}`,
        label: `Request native support for ${step.label}`,
        manifest: {
          credentialRequired: false,
          description: `Capture missing native capability for: ${step.label}`,
          facts: {
            builderStepId: step.id,
            builderStepKind: step.kind,
          },
          optionalFields: [],
          outputFields: [{ key: "result", label: "Result", type: "unknown" }],
          providerTier: "missing",
          requiredFields: step.requiredEntityIds.map((entityId) => ({
            key: entityId,
            type: "entity",
          })),
          risk: "high",
          source: "missing",
          title: `Request native support for ${step.label}`,
        },
        outputFields: ["result"],
        provider: "missing" as const,
        requiredInputs: step.requiredEntityIds,
        score: 0.2,
      })
    );
  return [
    ...pluginCandidates,
    ...workflowCandidates,
    ...missingCandidates,
  ].sort((left, right) => right.score - left.score);
}

function withInferredCapability(candidate: CatalogCandidate): CatalogCandidate {
  return {
    ...candidate,
    capability: inferCatalogCandidateCapability(candidate),
  };
}

export function inferCatalogCandidateCapability(
  candidate: CatalogCandidate
): CatalogCandidate["capability"] {
  return inferCandidateCapability(candidate);
}

function manifestFieldsFromConfig(
  fields: readonly ActionConfigFieldBase[]
): CatalogCapabilityField[] {
  return fields.map((field) => ({
    defaultValue: field.defaultValue,
    key: field.key,
    label: field.label,
    metadata: {
      ...(field.allowedChainIds
        ? { allowedChainIds: field.allowedChainIds }
        : {}),
      ...(field.chainTypeFilter
        ? { chainTypeFilter: field.chainTypeFilter }
        : {}),
      ...(field.helpTip ? { helpTip: field.helpTip } : {}),
      ...(field.isAddressField ? { isAddressField: field.isAddressField } : {}),
      ...(field.solidityType ? { solidityType: field.solidityType } : {}),
    },
    options: field.options?.map((option) => option.value),
    required: field.required === true,
    type: field.type,
  }));
}

function manifestFieldsFromOutputs(
  outputs: readonly OutputField[]
): CatalogCapabilityField[] {
  return outputs.map((output) => ({
    key: output.field,
    label: output.description,
    type: "output",
  }));
}
