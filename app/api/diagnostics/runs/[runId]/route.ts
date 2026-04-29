import { NextResponse } from "next/server";
import { getKeeperTraceProviders } from "@/lib/trace/providers";
import {
  canAccessDiagnosticRun,
  diagnosticsError,
  getDiagnosticsAuth,
  traceDisabledResponse,
} from "../../_utils";

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
    const run = await getKeeperTraceProviders().store.getRun(runId);
    if (!run) {
      return NextResponse.json(
        { error: "diagnostic run not found", ok: false },
        { status: 404 }
      );
    }
    if (!canAccessDiagnosticRun(run, authResult.auth)) {
      return NextResponse.json(
        { error: "Forbidden", ok: false },
        { status: 403 }
      );
    }

    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return diagnosticsError(error, "Failed to load diagnostic run");
  }
}
