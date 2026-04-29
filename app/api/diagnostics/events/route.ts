import type { TraceRecordEvent } from "@keeperhub/trace-sdk/server";
import { NextResponse } from "next/server";
import { getKeeperTraceProviders } from "@/lib/trace/providers";
import {
  diagnosticsError,
  getDiagnosticsAuth,
  traceDisabledResponse,
} from "../_utils";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeEvents(body: unknown) {
  let events = [body];
  if (isRecord(body) && Array.isArray(body.events)) {
    events = body.events;
  } else if (isRecord(body) && body.event) {
    events = [body.event];
  }
  return events.filter(
    (event): event is TraceRecordEvent =>
      isRecord(event) &&
      typeof event.type === "string" &&
      typeof event.runId === "string"
  );
}

export async function POST(request: Request) {
  try {
    const disabled = traceDisabledResponse();
    if (disabled) {
      return disabled;
    }

    const authResult = await getDiagnosticsAuth(request);
    if (authResult.response) {
      return authResult.response;
    }

    const events = normalizeEvents(await request.json().catch(() => null));
    if (!events.length) {
      return NextResponse.json(
        { error: "at least one event is required", ok: false },
        { status: 400 }
      );
    }

    const { recorder } = getKeeperTraceProviders();
    await recorder.recordMany(events);
    return NextResponse.json({
      async: true,
      ok: true,
      recorded: events.length,
    });
  } catch (error) {
    return diagnosticsError(error, "Failed to ingest diagnostic events");
  }
}
