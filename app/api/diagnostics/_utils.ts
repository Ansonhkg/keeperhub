import type {
  DiagnosticRun,
  DiagnosticRunSummary,
  TraceJsonObject,
} from "@keeperhub/trace-sdk/core";
import { NextResponse } from "next/server";
import { getDualAuthContext } from "@/lib/middleware/auth-helpers";
import { isTraceEnabled } from "@/lib/trace/feature-flag";

export type DiagnosticsAuthContext = {
  userId: string | null;
  organizationId: string | null;
};

export async function getDiagnosticsAuth(request: Request) {
  const authContext = await getDualAuthContext(request);
  if ("error" in authContext) {
    return {
      response: NextResponse.json(
        { error: authContext.error, ok: false },
        { status: authContext.status }
      ),
    };
  }

  const { organizationId, userId } = authContext;
  if (userId == null && organizationId == null) {
    return {
      response: NextResponse.json(
        { error: "Forbidden", ok: false },
        { status: 403 }
      ),
    };
  }

  return {
    auth: { organizationId, userId },
  };
}

export function traceDisabledResponse() {
  if (isTraceEnabled()) {
    return null;
  }

  return NextResponse.json(
    { error: "Trace is disabled", ok: false },
    { status: 404 }
  );
}

function readStringAttribute(attributes: TraceJsonObject | null, key: string) {
  const value = attributes?.[key];
  return typeof value === "string" ? value : "";
}

export function canAccessDiagnosticRun(
  run: DiagnosticRun | DiagnosticRunSummary,
  auth: DiagnosticsAuthContext
) {
  const runUserId = readStringAttribute(run.attributes, "userId");
  const runOrganizationId = readStringAttribute(
    run.attributes,
    "organizationId"
  );

  if (runUserId || runOrganizationId) {
    const userMatches = Boolean(runUserId && auth.userId === runUserId);
    const organizationMatches = Boolean(
      runOrganizationId && auth.organizationId === runOrganizationId
    );
    return userMatches || organizationMatches;
  }

  return true;
}

export function filterAccessibleRuns<
  T extends DiagnosticRun | DiagnosticRunSummary,
>(runs: T[], auth: DiagnosticsAuthContext) {
  return runs.filter((run) => canAccessDiagnosticRun(run, auth));
}

export function diagnosticsError(error: unknown, fallback: string) {
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : fallback,
      ok: false,
    },
    { status: 500 }
  );
}
