import type {
  CapabilityDescriptor,
  CapabilityIntent,
  EvaluationPolicy,
  SystemCapabilityDescriptor,
} from "./contracts";
import { evaluationPolicy } from "./policy";

export type CatalogAction = {
  id: string;
  slug: string;
  label: string;
  description: string;
  category: string;
  integration?: string;
  source?: string;
  capabilityIntent?: CapabilityIntent;
};

export type BuildCapabilityCatalogInput = {
  actions: CatalogAction[];
  protocolSlugs?: readonly string[];
  systemCapabilities?: readonly SystemCapabilityDescriptor[];
  policy?: EvaluationPolicy;
};

export function buildCapabilityCatalog(
  input: BuildCapabilityCatalogInput
): CapabilityDescriptor[] {
  const policy = input.policy ?? evaluationPolicy;
  const protocolSlugs = new Set(input.protocolSlugs ?? []);
  const systemCapabilities = input.systemCapabilities ?? policy.systemCapabilities;

  return [
    ...systemCapabilities.map((capability) =>
      systemCapabilityToDescriptor(capability, policy)
    ),
    ...input.actions.map((action) =>
      actionToCapabilityDescriptor(action, protocolSlugs, policy)
    ),
  ];
}

function systemCapabilityToDescriptor(
  capability: SystemCapabilityDescriptor,
  policy: EvaluationPolicy
): CapabilityDescriptor {
  return {
    id: capability.id,
    label: capability.label,
    source: policy.capabilityPolicy.sources.systemAction,
    description: capability.description,
    category: capability.category,
    capabilityIntent: capability.capabilityIntent,
  };
}

function actionToCapabilityDescriptor(
  action: CatalogAction,
  protocolSlugs: ReadonlySet<string>,
  policy: EvaluationPolicy
): CapabilityDescriptor {
  return {
    id: action.id,
    label: action.label,
    source: actionSource(action, protocolSlugs, policy),
    description: action.description,
    category: action.category,
    integration: action.integration,
    capabilityIntent: buildCapabilityIntent(action, policy),
  };
}

function buildCapabilityIntent(
  action: CatalogAction,
  policy: EvaluationPolicy
): CapabilityIntent {
  const integrationBindings = action.integration
    ? policy.capabilityBindings.integrationBindings[action.integration]
    : undefined;
  const categoryBindings = policy.capabilityBindings.categoryBindings[action.category];
  const actionBindings = policy.capabilityBindings.actionBindings[action.id];

  return compactCapabilityIntent({
    action: normalizeActionSlug(action.slug),
    ...(action.integration ? { provider: action.integration } : {}),
    ...categoryBindings,
    ...integrationBindings,
    ...actionBindings,
    ...action.capabilityIntent,
  });
}

function compactCapabilityIntent(
  intent: Partial<CapabilityIntent>
): CapabilityIntent {
  return Object.fromEntries(
    Object.entries(intent).filter((entry): entry is [string, string] => {
      const value = entry[1];
      return typeof value === "string" && value.length > 0;
    })
  ) as CapabilityIntent;
}

function actionSource(
  action: CatalogAction,
  protocolSlugs: ReadonlySet<string>,
  policy: EvaluationPolicy
): string {
  if (action.source) {
    return action.source;
  }

  if (action.integration && protocolSlugs.has(action.integration)) {
    return policy.capabilityPolicy.sources.protocolAction;
  }

  return policy.capabilityPolicy.sources.nativeAction;
}

function normalizeActionSlug(slug: string): string {
  return slug.replaceAll("-", "_");
}
