import { createHttpHandlers } from "@keeperhub/agentic-builder/http";
import { resolveBuilderAuthContext } from "@/lib/agentic-builder/keeperhub-auth";
import { keeperHubBuilderRuntime } from "@/lib/agentic-builder/keeperhub-runtime";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

const handlers = createHttpHandlers(
  keeperHubBuilderRuntime,
  resolveBuilderAuthContext
);

async function postBuilderOptionSelect(
  request: Request,
  context: { params: Promise<{ sessionId: string; optionId: string }> }
): Promise<Response> {
  const { sessionId, optionId } = await context.params;
  return handlers.selectOption(request, sessionId, optionId);
}

export const POST = withTracedApiHandler(
  "POST /api/builder/sessions/:sessionId/options/:optionId/select",
  postBuilderOptionSelect
);
