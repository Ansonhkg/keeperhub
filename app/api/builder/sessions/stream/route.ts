import type { BuilderProgressEvent } from "@keeperhub/agentic-builder/runtime";
import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";
import { resolveBuilderAuthContext } from "@/lib/agentic-builder/keeperhub-auth";
import { keeperHubBuilderRuntime } from "@/lib/agentic-builder/keeperhub-runtime";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

type BuilderStreamEvent =
  | ({ type: "status" } & BuilderProgressEvent)
  | { type: "projection"; projection: BuilderProjection }
  | { type: "error"; error: string };

function encodeServerEvent(event: BuilderStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJson(request: Request): Promise<unknown> {
  return request.headers.get("content-length") === "0" ? {} : request.json();
}

async function postBuilderSessionStream(request: Request): Promise<Response> {
  const body = (await readJson(request)) as {
    context?: unknown;
    prompt?: unknown;
  };

  if (typeof body.prompt !== "string" || body.prompt.length === 0) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }
  const prompt = body.prompt;
  const context = typeof body.context === "string" ? body.context : undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: BuilderStreamEvent) => {
        controller.enqueue(encodeServerEvent(event));
      };

      try {
        send({
          label: "Preparing the builder context",
          stage: "context",
          status: "running",
          type: "status",
        });
        const auth = await resolveBuilderAuthContext(request);
        send({
          label: "Builder context is ready",
          stage: "context",
          status: "completed",
          type: "status",
        });

        const projection =
          await keeperHubBuilderRuntime.startSessionWithProgress(
            auth,
            prompt,
            context,
            (event) => send({ ...event, type: "status" })
          );

        send({ projection, type: "projection" });
      } catch (error) {
        send({
          error: error instanceof Error ? error.message : "Unknown error",
          type: "error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
    },
  });
}

export const POST = withTracedApiHandler(
  "POST /api/builder/sessions/stream",
  postBuilderSessionStream
);
