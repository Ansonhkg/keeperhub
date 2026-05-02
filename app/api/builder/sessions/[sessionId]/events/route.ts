import { createHttpHandlers } from "@keeperhub/agentic-builder/http";
import { resolveBuilderAuthContext } from "@/lib/agentic-builder/keeperhub-auth";
import { keeperHubBuilderRuntime } from "@/lib/agentic-builder/keeperhub-runtime";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

const handlers = createHttpHandlers(
  keeperHubBuilderRuntime,
  resolveBuilderAuthContext
);

async function getBuilderEvents(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const { sessionId } = await context.params;
  return handlers.getEvents(request, sessionId);
}

export const GET = withTracedApiHandler(
  "GET /api/builder/sessions/:sessionId/events",
  getBuilderEvents
);
