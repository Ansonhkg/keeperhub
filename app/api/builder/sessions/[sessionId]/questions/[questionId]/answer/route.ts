import { createHttpHandlers } from "@keeperhub/agentic-builder/http";
import { resolveBuilderAuthContext } from "@/lib/agentic-builder/keeperhub-auth";
import { keeperHubBuilderRuntime } from "@/lib/agentic-builder/keeperhub-runtime";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

const handlers = createHttpHandlers(
  keeperHubBuilderRuntime,
  resolveBuilderAuthContext
);

async function postBuilderQuestionAnswer(
  request: Request,
  context: { params: Promise<{ sessionId: string; questionId: string }> }
): Promise<Response> {
  const { sessionId, questionId } = await context.params;
  const body = await request.json();
  return handlers.answerQuestion(
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ ...body, questionId }),
    }),
    sessionId
  );
}

export const POST = withTracedApiHandler(
  "POST /api/builder/sessions/:sessionId/questions/:questionId/answer",
  postBuilderQuestionAnswer
);
