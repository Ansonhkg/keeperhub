/**
 * Executable step function for HTTP Request action
 */
import "server-only";

import { createSpanId, formatTraceparent } from "@keeperhub/trace-sdk/core";
import { safeFetch } from "../safe-fetch";
import { withServerTraceSpan } from "../trace/server-span";
import { getErrorMessage } from "../utils";
import { type StepInput, withStepLogging } from "./step-handler";

type HttpRequestResult =
  | { success: true; data: unknown; status: number }
  | { success: false; error: string; status?: number };

export type HttpRequestInput = StepInput & {
  endpoint: string;
  httpMethod: string;
  httpHeaders?: string;
  httpBody?: string;
};

function parseHeaders(httpHeaders?: string): Record<string, string> {
  if (!httpHeaders) {
    return {};
  }
  try {
    return JSON.parse(httpHeaders);
  } catch {
    return {};
  }
}

function headersWithTraceparent(input: HttpRequestInput) {
  const headers = parseHeaders(input.httpHeaders);
  const traceContext = input._context?.traceContext;
  if (!(traceContext && headers.traceparent === undefined)) {
    return headers;
  }

  const parentSpanId =
    traceContext.spanId ?? traceContext.parentSpanId ?? createSpanId();
  try {
    return {
      ...headers,
      traceparent: formatTraceparent({
        parentSpanId,
        traceId: traceContext.traceId,
      }),
    };
  } catch {
    return headers;
  }
}

function parseBody(httpMethod: string, httpBody?: string): string | undefined {
  if (httpMethod === "GET" || !httpBody) {
    return;
  }
  try {
    const parsedBody = JSON.parse(httpBody);
    return Object.keys(parsedBody).length > 0
      ? JSON.stringify(parsedBody)
      : undefined;
  } catch {
    const trimmed = httpBody.trim();
    return trimmed && trimmed !== "{}" ? httpBody : undefined;
  }
}

function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

/**
 * HTTP request logic
 */
async function httpRequest(
  input: HttpRequestInput
): Promise<HttpRequestResult> {
  if (!input.endpoint) {
    return {
      success: false,
      error: "HTTP request failed: URL is required",
    };
  }

  try {
    const endpoint = new URL(input.endpoint);
    const response = await withServerTraceSpan(
      {
        attributes: {
          host: endpoint.host,
          method: input.httpMethod,
          pathname: endpoint.pathname,
        },
        kind: "external",
        label: `${input.httpMethod} ${endpoint.host}${endpoint.pathname}`,
        step: "fetch.outbound",
      },
      () =>
        safeFetch(input.endpoint, {
          body: parseBody(input.httpMethod, input.httpBody),
          headers: headersWithTraceparent(input),
          method: input.httpMethod,
          plugin: "http-request",
        })
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return {
        success: false,
        error: `HTTP request failed with status ${response.status}: ${errorText}`,
        status: response.status,
      };
    }

    const data = await parseResponse(response);
    return { success: true, data, status: response.status };
  } catch (error) {
    return {
      success: false,
      error: `HTTP request failed: ${getErrorMessage(error)}`,
    };
  }
}

/**
 * HTTP Request Step
 * Makes an HTTP request to an endpoint
 */
export async function httpRequestStep(
  input: HttpRequestInput
): Promise<HttpRequestResult> {
  "use step";
  return withStepLogging(input, () => httpRequest(input));
}
httpRequestStep.maxRetries = 0;
