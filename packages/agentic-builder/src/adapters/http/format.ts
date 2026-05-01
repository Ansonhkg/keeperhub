export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export function errorResponse(error: unknown, status = 400): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : "Unknown error" },
    { status }
  );
}

export function eventStream(events: readonly unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
