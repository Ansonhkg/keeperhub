import {
  formatSseEvent,
  formatSseHeartbeat,
} from "@keeperhub/trace-sdk/server";
import { getKeeperTraceProviders } from "@/lib/trace/providers";
import {
  canAccessDiagnosticRun,
  diagnosticsError,
  getDiagnosticsAuth,
  traceDisabledResponse,
} from "../../../_utils";

const HEARTBEAT_INTERVAL_MS = 25_000;

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const disabled = traceDisabledResponse();
    if (disabled) {
      return disabled;
    }

    const authResult = await getDiagnosticsAuth(request);
    if (authResult.response) {
      return authResult.response;
    }

    const { runId } = await context.params;
    const providers = getKeeperTraceProviders();
    const run = await providers.store.getRun(runId);
    if (!run) {
      return Response.json(
        { error: "diagnostic run not found", ok: false },
        { status: 404 }
      );
    }
    if (!canAccessDiagnosticRun(run, authResult.auth)) {
      return Response.json({ error: "Forbidden", ok: false }, { status: 403 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        const enqueue = (frame: string) => {
          if (!closed) {
            controller.enqueue(encoder.encode(frame));
          }
        };
        const cleanup = () => {
          if (closed) {
            return;
          }
          closed = true;
          clearInterval(heartbeatTimer);
          unsubscribe();
        };
        const unsubscribe = providers.eventBus.subscribe(runId, (event) => {
          enqueue(
            formatSseEvent({ data: { event, ok: true }, event: "diagnostic" })
          );
        });
        const heartbeatTimer = setInterval(() => {
          enqueue(formatSseHeartbeat());
        }, HEARTBEAT_INTERVAL_MS);

        enqueue(formatSseEvent({ data: { ok: true, run }, event: "snapshot" }));
        request.signal.addEventListener("abort", cleanup, { once: true });
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return diagnosticsError(error, "Failed to stream diagnostic run");
  }
}
