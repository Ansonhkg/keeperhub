import {
  createSpanId,
  createTraceId,
  parseTraceparent,
} from "@keeperhub/trace-sdk/core";
import type { TraceContext } from "@keeperhub/trace-sdk/server";
import { isTraceEnabled } from "./feature-flag";
import { getKeeperTraceProviders } from "./providers";

type ApiTraceHandler<T extends Response> = (
  context: TraceContext | null
) => T | Promise<T>;

function readHeader(request: Request, name: string) {
  return request.headers.get(name)?.trim() || "";
}

function readBrowserTraceContext(request: Request): TraceContext | null {
  const runId = readHeader(request, "x-keeperhub-trace-run-id");
  const traceparent = parseTraceparent(readHeader(request, "traceparent"));
  const traceId =
    readHeader(request, "x-keeperhub-trace-id") || traceparent?.traceId;
  if (!(runId && traceId)) {
    return null;
  }
  return {
    parentSpanId:
      readHeader(request, "x-keeperhub-trace-parent-span-id") ||
      traceparent?.parentSpanId ||
      null,
    runId,
    spanId:
      readHeader(request, "x-keeperhub-trace-parent-span-id") ||
      traceparent?.parentSpanId ||
      undefined,
    traceId,
  };
}

function createApiRootTraceContext(request: Request): TraceContext {
  const url = new URL(request.url);
  return {
    parentSpanId: null,
    runId: `api_${createTraceId()}`,
    traceId: `api_${createTraceId()}`,
    attributes: {
      actor: readHeader(request, "x-keeperhub-trace-actor") || "server",
      capability: "api",
      mode: "server",
      origin: "api",
      platform: "nextjs",
      route: url.pathname,
      trigger: readHeader(request, "x-keeperhub-trace-trigger") || "http",
    },
  };
}

async function recordApiRunStartIfRoot(
  context: TraceContext,
  startedAt: string,
  isRootTrace: boolean
) {
  if (!isRootTrace) {
    return;
  }
  await getKeeperTraceProviders().recorder.record({
    at: startedAt,
    attributes: context.attributes,
    runId: context.runId,
    traceId: context.traceId,
    type: "run:start",
  });
}

async function recordApiRunCompletionIfRoot(
  context: TraceContext,
  isRootTrace: boolean,
  response: Response
) {
  if (!isRootTrace) {
    return;
  }
  const providers = getKeeperTraceProviders();
  if (response.ok) {
    await providers.recorder.record({
      at: new Date().toISOString(),
      payload: { status: response.status, statusText: response.statusText },
      runId: context.runId,
      traceId: context.traceId,
      type: "run:success",
    });
    return;
  }
  await providers.recorder.record({
    at: new Date().toISOString(),
    error: {
      message: `API request failed (${response.status})`,
      name: "ApiRequestError",
    },
    runId: context.runId,
    traceId: context.traceId,
    type: "run:error",
  });
}

export async function withApiRequestTrace<T extends Response>(
  request: Request,
  label: string,
  handler: ApiTraceHandler<T>
) {
  if (!isTraceEnabled()) {
    return await handler(null);
  }

  const incomingContext = readBrowserTraceContext(request);
  const isRootTrace = !incomingContext;
  const context = incomingContext ?? createApiRootTraceContext(request);
  const providers = getKeeperTraceProviders();
  const spanId = createSpanId();
  const startedAt = new Date().toISOString();
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  await recordApiRunStartIfRoot(context, startedAt, isRootTrace);

  await providers.recorder.record({
    at: startedAt,
    attributes: {
      method,
      pathname: url.pathname,
      summary: `${method} ${url.pathname}`,
      trace: { sourcePath: url.pathname, surface: "server" },
    },
    input: { method, pathname: url.pathname, search: url.search },
    kind: "http.server",
    label,
    parentSpanId: context.parentSpanId ?? null,
    runId: context.runId,
    spanId,
    step: "api-request",
    traceId: context.traceId,
    type: "step:start",
  });

  try {
    const response = await providers.contextProvider.run(
      { ...context, parentSpanId: context.parentSpanId ?? null, spanId },
      () =>
        handler({
          ...context,
          parentSpanId: context.parentSpanId ?? null,
          spanId,
        })
    );

    await recordApiRunCompletionIfRoot(context, isRootTrace, response);

    if (response.ok) {
      await providers.recorder.record({
        at: new Date().toISOString(),
        output: { status: response.status, statusText: response.statusText },
        runId: context.runId,
        spanId,
        traceId: context.traceId,
        type: "step:end",
      });
    } else {
      await providers.recorder.record({
        at: new Date().toISOString(),
        error: {
          message: `API request failed (${response.status})`,
          name: "ApiRequestError",
        },
        runId: context.runId,
        spanId,
        traceId: context.traceId,
        type: "step:error",
      });
    }
    return response;
  } catch (error) {
    await providers.recorder.record({
      at: new Date().toISOString(),
      error: {
        message: error instanceof Error ? error.message : "API request failed",
        name: error instanceof Error ? error.name : "ApiRequestError",
      },
      runId: context.runId,
      spanId,
      traceId: context.traceId,
      type: "step:error",
    });
    if (isRootTrace) {
      await providers.recorder.record({
        at: new Date().toISOString(),
        error: {
          message:
            error instanceof Error ? error.message : "API request failed",
          name: error instanceof Error ? error.name : "ApiRequestError",
        },
        runId: context.runId,
        traceId: context.traceId,
        type: "run:error",
      });
    }
    throw error;
  }
}

export function withTracedApiHandler<
  T extends Response,
  Args extends unknown[],
>(label: string, handler: (...args: Args) => T | Promise<T>) {
  return async (...args: Args) => {
    if (!isTraceEnabled()) {
      return await handler(...args);
    }

    const request = args.find((arg): arg is Request => arg instanceof Request);
    if (!request) {
      return await handler(...args);
    }
    return await withApiRequestTrace(request, label, () => handler(...args));
  };
}
