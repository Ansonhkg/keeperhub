import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getAnalyticsChecksum,
  getAnalyticsSummary,
} from "@/lib/analytics/queries";
import { parseTimeRange } from "@/lib/analytics/time-range";
import type { AnalyticsStreamEvent } from "@/lib/analytics/types";
import { apiError } from "@/lib/api-error";
import { requireOrganization } from "@/lib/middleware/require-org";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_LIFETIME_MS = 5 * 60 * 1000;
const MIN_EVENT_INTERVAL_MS = 1000;

function formatSSE(event: AnalyticsStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function fetchAndEmit(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  organizationId: string,
  range: ReturnType<typeof parseTimeRange>,
  customStart: string | undefined,
  customEnd: string | undefined,
  projectId: string | undefined
): Promise<void> {
  const summary = await getAnalyticsSummary(
    organizationId,
    range,
    customStart,
    customEnd,
    projectId
  );

  const event: AnalyticsStreamEvent = {
    type: "summary",
    data: summary,
  };

  controller.enqueue(encoder.encode(formatSSE(event)));
}

export const GET = withTracedApiHandler(
  "GET /api/analytics/stream",
  requireOrganization(async (req: NextRequest, context): Promise<Response> => {
    try {
      const organizationId = context.organization?.id;
      if (!organizationId) {
        return NextResponse.json(
          { error: "No active organization" },
          { status: 400 }
        );
      }

      const params = req.nextUrl.searchParams;
      const range = parseTimeRange(params.get("range"));
      const customStart = params.get("customStart") ?? undefined;
      const customEnd = params.get("customEnd") ?? undefined;
      const projectId = params.get("projectId") ?? undefined;

      let lastChecksum = "";
      let lastEventTime = 0;
      let closed = false;

      const stream = new ReadableStream({
        start(controller): void {
          const encoder = new TextEncoder();
          const startTime = Date.now();

          const cleanup = (): void => {
            closed = true;
            clearInterval(pollTimer);
            clearInterval(heartbeatTimer);
          };

          const pollTimer = setInterval(async () => {
            if (closed) {
              return;
            }

            if (Date.now() - startTime > MAX_LIFETIME_MS) {
              cleanup();
              controller.close();
              return;
            }

            try {
              const checksum = await getAnalyticsChecksum(organizationId);

              if (checksum === lastChecksum) {
                return;
              }

              lastChecksum = checksum;

              const now = Date.now();
              if (now - lastEventTime < MIN_EVENT_INTERVAL_MS) {
                return;
              }
              lastEventTime = now;

              await fetchAndEmit(
                controller,
                encoder,
                organizationId,
                range,
                customStart,
                customEnd,
                projectId
              );
            } catch {
              cleanup();
              controller.close();
            }
          }, POLL_INTERVAL_MS);

          const heartbeatTimer = setInterval(() => {
            if (closed) {
              return;
            }

            try {
              const event: AnalyticsStreamEvent = {
                type: "heartbeat",
                data: { timestamp: new Date().toISOString() },
              };
              controller.enqueue(encoder.encode(formatSSE(event)));
            } catch {
              cleanup();
            }
          }, HEARTBEAT_INTERVAL_MS);

          req.signal.addEventListener("abort", () => {
            cleanup();
            controller.close();
          });
        },
      });

      return await Promise.resolve(
        new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        })
      );
    } catch (error: unknown) {
      return apiError(error, "Failed to start analytics stream");
    }
  })
);
