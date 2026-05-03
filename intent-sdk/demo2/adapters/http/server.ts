import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import {
  createEvalExecPrepareRoute,
  createEvalExecRunRoute,
  createGraphWorkflowOperationStartRoute,
  createGraphWorkflowRunRoute,
  createNodeDiscoveryRoute,
  createOpenApiRoute,
  createOperationActionRoute,
  createOperationActionsRoute,
  createOperationCapabilitiesRoute,
  createOperationEventsRoute,
  createOperationEventsStreamRoute,
  createOperationProjectionStateRoute,
  createOperationSessionRoute,
  createOperationSessionsRoute,
  createSwaggerRoute,
  createVisualProjectionRoute,
  createWorkflowDiscoveryRoute,
} from "./routes.js";

const port = Number(process.env.EVAL_EXEC_V3_PORT ?? "4323");

const routes = {
  prepare: createEvalExecPrepareRoute(),
  run: createEvalExecRunRoute(),
  workflowRun: createGraphWorkflowRunRoute(),
  workflowOperationStart: createGraphWorkflowOperationStartRoute(),
  workflows: createWorkflowDiscoveryRoute(),
  nodes: createNodeDiscoveryRoute(),
  projection: createVisualProjectionRoute(),
  operationCapabilities: createOperationCapabilitiesRoute(),
  operationSessions: createOperationSessionsRoute(),
  operationSession: createOperationSessionRoute(),
  operationEvents: createOperationEventsRoute(),
  operationEventsStream: createOperationEventsStreamRoute(),
  operationProjectionState: createOperationProjectionStateRoute(),
  operationActions: createOperationActionsRoute(),
  operationAction: createOperationActionRoute(),
  openApi: createOpenApiRoute(),
  swagger: createSwaggerRoute(),
};

const server = createServer(async (incoming, outgoing) => {
  try {
    const request = requestFromIncoming(incoming);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/workflows") {
      return send(outgoing, json(await routes.workflows()));
    }
    if (request.method === "GET" && url.pathname === "/api/nodes") {
      return send(outgoing, json(await routes.nodes()));
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/graph/visual-projections"
    ) {
      return send(outgoing, json(await routes.projection(request)));
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/operations/capabilities"
    ) {
      return send(outgoing, json(await routes.operationCapabilities()));
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/operations/sessions"
    ) {
      requireOperationReadAuth(request);
      return send(outgoing, json(await routes.operationSessions()));
    }
    const operationPathMatch = url.pathname.match(
      /^\/api\/operations\/sessions\/([^/]+)(?:\/(events(?:\/stream)?|projection-state|actions(?:\/([^/]+))?))?$/
    );
    if (operationPathMatch?.[1]) {
      const params = {
        sessionId: decodeURIComponent(operationPathMatch[1]),
        actionKey: operationPathMatch[3]
          ? decodeURIComponent(operationPathMatch[3])
          : undefined,
      };
      const suffix = operationPathMatch[2];
      if (request.method === "GET" && !suffix) {
        requireOperationReadAuth(request);
        return send(
          outgoing,
          json(await routes.operationSession(request, params))
        );
      }
      if (request.method === "GET" && suffix === "events") {
        requireOperationReadAuth(request);
        return send(
          outgoing,
          json(await routes.operationEvents(request, params))
        );
      }
      if (request.method === "GET" && suffix === "events/stream") {
        requireOperationReadAuth(request);
        return send(
          outgoing,
          await routes.operationEventsStream(request, params)
        );
      }
      if (request.method === "GET" && suffix === "projection-state") {
        requireOperationReadAuth(request);
        return send(
          outgoing,
          json(await routes.operationProjectionState(request, params))
        );
      }
      if (request.method === "GET" && suffix === "actions") {
        requireOperationReadAuth(request);
        return send(
          outgoing,
          json(await routes.operationActions(request, params))
        );
      }
      if (request.method === "POST" && suffix?.startsWith("actions/")) {
        requireMutationAuth(request);
        const result = (await routes.operationAction(request, params)) as {
          status?: string;
          error?: { code?: string };
        };
        const conflictCodes = new Set([
          "LEASE_CONFLICT",
          "LEASE_EXPIRED",
          "REVISION_CONFLICT",
        ]);
        return send(
          outgoing,
          json(
            result,
            result.status === "rejected" &&
              conflictCodes.has(String(result.error?.code))
              ? 409
              : 200
          )
        );
      }
    }
    if (request.method === "GET" && url.pathname === "/api/openapi.json") {
      return send(outgoing, json(await routes.openApi()));
    }
    if (request.method === "GET" && url.pathname === "/api/swagger") {
      return send(outgoing, html(await routes.swagger()));
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/eval-exec/prepare"
    ) {
      requireMutationAuth(request);
      return send(outgoing, json(await routes.prepare(request)));
    }
    if (request.method === "POST" && url.pathname === "/api/eval-exec/run") {
      requireMutationAuth(request);
      return send(outgoing, json(await routes.run(request)));
    }
    const workflowMatch = url.pathname.match(
      /^\/api\/graph\/workflows\/([^/]+)\/runs$/
    );
    if (request.method === "POST" && workflowMatch?.[1]) {
      requireMutationAuth(request);
      return send(
        outgoing,
        json(
          await routes.workflowRun(request, {
            workflowKey: decodeURIComponent(workflowMatch[1]),
          })
        )
      );
    }
    const workflowOperationMatch = url.pathname.match(
      /^\/api\/graph\/workflows\/([^/]+)\/operations$/
    );
    if (request.method === "POST" && workflowOperationMatch?.[1]) {
      requireMutationAuth(request);
      return send(
        outgoing,
        json(
          await routes.workflowOperationStart(request, {
            workflowKey: decodeURIComponent(workflowOperationMatch[1]),
          }),
          202
        )
      );
    }
    return send(outgoing, json({ error: "Not found" }, 404));
  } catch (error) {
    if (error instanceof HttpError) {
      return send(outgoing, json({ error: error.message }, error.status));
    }
    return send(
      outgoing,
      json(
        { error: error instanceof Error ? error.message : String(error) },
        400
      )
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`eval-exec-loop-v3 listening on http://127.0.0.1:${port}`);
});

function requestFromIncoming(incoming: IncomingMessage): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
      continue;
    }
    if (value !== undefined) headers.set(key, value);
  }
  const host = headers.get("host") ?? `127.0.0.1:${port}`;
  const init: RequestInit & { duplex?: "half" } = {
    headers,
    method: incoming.method,
  };
  if (incoming.method !== "GET" && incoming.method !== "HEAD") {
    init.body = Readable.toWeb(incoming) as ReadableStream;
    init.duplex = "half";
  }
  return new Request(`http://${host}${incoming.url ?? "/"}`, init);
}

async function send(
  outgoing: import("node:http").ServerResponse,
  response: Response
) {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => {
    outgoing.setHeader(key, value);
  });
  if (!response.body) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    outgoing.write(value);
  }
  outgoing.end();
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function requireMutationAuth(request: Request): void {
  const apiKey = process.env.EVAL_EXEC_V3_API_KEY?.trim();
  if (!apiKey) {
    throw new HttpError(
      503,
      "EVAL_EXEC_V3_API_KEY is required for mutating workflow routes."
    );
  }

  requireApiKey(request, apiKey, "Missing or invalid workflow API key.");
}

function requireOperationReadAuth(request: Request): void {
  const apiKey = process.env.EVAL_EXEC_V3_API_KEY?.trim();
  if (!apiKey) return;
  requireApiKey(request, apiKey, "Missing or invalid operation API key.");
}

function requireApiKey(
  request: Request,
  apiKey: string,
  message: string
): void {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const headerApiKey = request.headers.get("x-api-key")?.trim() ?? "";
  if (authorization !== `Bearer ${apiKey}` && headerApiKey !== apiKey) {
    throw new HttpError(401, message);
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
