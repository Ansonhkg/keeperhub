import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isBillingEnabled } from "@/lib/billing/feature-flag";
import { getUpgradeSuggestion } from "@/lib/billing/tier-suggestions";
import { ErrorCategory, logSystemError } from "@/lib/logging";
import { getActiveOrgId } from "@/lib/middleware/org-context";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

export const GET = withTracedApiHandler(
  "GET /api/billing/usage-suggestion",
  async function GET(): Promise<NextResponse> {
    if (!isBillingEnabled()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
      const session = await auth.api.getSession({
        headers: await headers(),
      });

      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const activeOrgId = getActiveOrgId(session);
      if (!activeOrgId) {
        return NextResponse.json(
          { error: "No active organization" },
          { status: 400 }
        );
      }

      const suggestion = await getUpgradeSuggestion(activeOrgId);
      return NextResponse.json(suggestion);
    } catch (error) {
      logSystemError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[Billing] Usage suggestion error",
        error,
        { endpoint: "/api/billing/usage-suggestion", operation: "get" }
      );
      return NextResponse.json(
        { error: "Failed to fetch usage suggestion" },
        { status: 500 }
      );
    }
  }
);
