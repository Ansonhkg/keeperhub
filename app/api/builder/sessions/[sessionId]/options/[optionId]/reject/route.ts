import { createHttpHandlers } from "@keeperhub/agentic-builder/http";
import { resolveBuilderAuthContext } from "@/lib/agentic-builder/keeperhub-auth";
import { keeperHubBuilderRuntime } from "@/lib/agentic-builder/keeperhub-runtime";

const handlers = createHttpHandlers(
  keeperHubBuilderRuntime,
  resolveBuilderAuthContext
);

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string; optionId: string }> }
): Promise<Response> {
  const { sessionId, optionId } = await context.params;
  return handlers.rejectOption(request, sessionId, optionId);
}
