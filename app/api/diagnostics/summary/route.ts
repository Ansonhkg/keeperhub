import { NextResponse } from "next/server";
import { getKeeperTraceProviders } from "@/lib/trace/providers";
import {
  diagnosticsError,
  filterAccessibleRuns,
  getDiagnosticsAuth,
  traceDisabledResponse,
} from "../_utils";

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

    const { store } = getKeeperTraceProviders();
    const [summary, runList] = await Promise.all([
      store.getSummary(),
      store.listRuns({ page: 0, pageSize: 200 }),
    ]);
    const accessibleRuns = filterAccessibleRuns(runList.runs, authResult.auth);

    return NextResponse.json({
      ok: true,
      summary: {
        ...summary,
        capabilities: [
          ...new Set(
            accessibleRuns.map((run) => run.capability).filter(Boolean)
          ),
        ].sort(),
        totalRuns: accessibleRuns.length,
      },
    });
  } catch (error) {
    return diagnosticsError(error, "Failed to load diagnostics summary");
  }
}
