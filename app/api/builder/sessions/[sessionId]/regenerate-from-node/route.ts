import { createHttpHandlers } from "@keeperhub/agentic-builder/http";
import { resolveBuilderAuthContext } from "@/lib/agentic-builder/keeperhub-auth";
import { keeperHubBuilderRuntime } from "@/lib/agentic-builder/keeperhub-runtime";

const handlers = createHttpHandlers(
  keeperHubBuilderRuntime,
  resolveBuilderAuthContext
);

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const { sessionId } = await context.params;
  return handlers.regenerateFromNode(request, sessionId);
}
