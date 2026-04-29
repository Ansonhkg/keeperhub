import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSpendCapData } from "@/lib/analytics/queries";
import { apiError } from "@/lib/api-error";
import { requireOrganization } from "@/lib/middleware/require-org";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

export const GET = withTracedApiHandler(
  "GET /api/analytics/spend-cap",
  requireOrganization(async (_req: NextRequest, context): Promise<Response> => {
    const organizationId = context.organization?.id;
    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 403 }
      );
    }

    try {
      const data = await getSpendCapData(organizationId);
      return NextResponse.json(data);
    } catch (error: unknown) {
      return apiError(error, "Failed to fetch spend cap data");
    }
  })
);
