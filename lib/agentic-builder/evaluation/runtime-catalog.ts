import { getRegisteredProtocols } from "@/lib/protocol-registry";
import { getAllActions } from "@/plugins/registry";
import type { CapabilityDescriptor, EvaluationPolicy } from "./contracts";
import { buildCapabilityCatalog } from "./catalog";
import { evaluationPolicy } from "./policy";

export function buildCurrentCapabilityCatalog(
  policy: EvaluationPolicy = evaluationPolicy
): CapabilityDescriptor[] {
  const protocolSlugs = getRegisteredProtocols().map((protocol) => protocol.slug);

  return buildCapabilityCatalog({
    actions: getAllActions().map((action) => ({
      id: action.id,
      slug: action.slug,
      label: action.label,
      description: action.description,
      category: action.category,
      integration: action.integration,
    })),
    protocolSlugs,
    policy,
  });
}
