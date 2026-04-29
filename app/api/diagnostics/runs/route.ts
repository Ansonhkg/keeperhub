import { NextResponse } from "next/server";
import { getKeeperTraceProviders } from "@/lib/trace/providers";
import {
  diagnosticsError,
  filterAccessibleRuns,
  getDiagnosticsAuth,
  traceDisabledResponse,
} from "../_utils";

function readPositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request) {
  try {
    const disabled = traceDisabledResponse();
    if (disabled) {
      return disabled;
    }

    const authResult = await getDiagnosticsAuth(request);
    if (authResult.response) {
      return authResult.response;
    }

    const url = new URL(request.url);
    const page = readPositiveInt(url.searchParams.get("page"), 0);
    const pageSize = readPositiveInt(
      url.searchParams.get("pageSize") ?? url.searchParams.get("limit"),
      20
    );
    const result = await getKeeperTraceProviders().store.listRuns({
      capability: url.searchParams.get("capability") ?? undefined,
      page,
      pageSize,
      search: url.searchParams.get("search") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    const runs = filterAccessibleRuns(result.runs, authResult.auth);

    return NextResponse.json({
      capabilities: [
        ...new Set(runs.map((run) => run.capability).filter(Boolean)),
      ].sort(),
      ok: true,
      page,
      pageSize,
      runs,
      total: runs.length,
    });
  } catch (error) {
    return diagnosticsError(error, "Failed to list diagnostic runs");
  }
}

export async function DELETE(request: Request) {
  try {
    const disabled = traceDisabledResponse();
    if (disabled) {
      return disabled;
    }

    const authResult = await getDiagnosticsAuth(request);
    if (authResult.response) {
      return authResult.response;
    }

    const url = new URL(request.url);
    const retentionDays = readPositiveInt(
      url.searchParams.get("retentionDays"),
      0
    );
    if (!retentionDays) {
      return NextResponse.json(
        { error: "retentionDays is required", ok: false },
        { status: 400 }
      );
    }

    const result = await getKeeperTraceProviders().store.cleanupRuns({
      retentionDays,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return diagnosticsError(error, "Failed to clean up diagnostic runs");
  }
}
