import { createHttpHandlers } from "@keeperhub/agentic-builder/http";
import { resolveBuilderAuthContext } from "@/lib/agentic-builder/keeperhub-auth";
import { keeperHubBuilderRuntime } from "@/lib/agentic-builder/keeperhub-runtime";

const handlers = createHttpHandlers(
  keeperHubBuilderRuntime,
  resolveBuilderAuthContext
);

export async function POST(request: Request): Promise<Response> {
  return handlers.startSession(request);
}
