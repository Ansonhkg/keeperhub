import type { BuilderAuthContext } from "@keeperhub/agentic-builder/schemas";
import { resolveCreatorContext } from "@/lib/middleware/auth-helpers";
import { isAgenticWorkflowBuilderEnabled } from "./feature-flag";

export async function resolveBuilderAuthContext(
  request: Request
): Promise<BuilderAuthContext> {
  if (!isAgenticWorkflowBuilderEnabled()) {
    throw new Error("Agentic workflow builder is disabled");
  }
  const context = await resolveCreatorContext(request);
  if ("error" in context) {
    throw new Error(context.error);
  }
  return {
    actorType: "user",
    organizationId: context.organizationId,
    scopes: ["builder:read", "builder:write"],
    userId: context.userId,
  };
}

export function resolveMcpBuilderAuthContext(
  tokenSubject = "local-agent"
): BuilderAuthContext {
  if (!isAgenticWorkflowBuilderEnabled()) {
    throw new Error("Agentic workflow builder is disabled");
  }
  return {
    userId: tokenSubject,
    organizationId: "local-org",
    actorType: "agent",
    scopes: ["builder:read", "builder:write"],
  };
}
