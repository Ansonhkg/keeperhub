import { NextResponse } from "next/server";
import { PAID_PLANS, VALID_INTERVALS } from "@/lib/billing/constants";
import { isBillingEnabled } from "@/lib/billing/feature-flag";
import type { PlanName, TierKey } from "@/lib/billing/plans";
import { getOrgSubscription, getPriceId } from "@/lib/billing/plans-server";
import { getBillingProvider } from "@/lib/billing/providers";
import { requireOrgOwner } from "@/lib/billing/require-org-owner";
import { ErrorCategory, logSystemError } from "@/lib/logging";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

type PreviewRequestBody = {
  plan?: string;
  tier?: string | null;
  interval?: string;
};

export const POST = withTracedApiHandler(
  "POST /api/billing/preview-proration",
  async function POST(request: Request): Promise<NextResponse> {
    if (!isBillingEnabled()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
      const authResult = await requireOrgOwner();
      if ("error" in authResult) {
        return authResult.error;
      }
      const { orgId: activeOrgId } = authResult;

      const body = (await request.json()) as PreviewRequestBody;
      const { plan, tier, interval } = body;

      if (!(plan && PAID_PLANS.has(plan))) {
        return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
      }

      if (!(interval && VALID_INTERVALS.has(interval))) {
        return NextResponse.json(
          { error: "Invalid interval" },
          { status: 400 }
        );
      }

      const priceId = getPriceId(
        plan as PlanName,
        (tier ?? null) as TierKey | null,
        interval as "monthly" | "yearly"
      );

      if (!priceId) {
        return NextResponse.json(
          { error: "Price not found for selected plan" },
          { status: 400 }
        );
      }

      const sub = await getOrgSubscription(activeOrgId);
      const existingSubId = sub?.providerSubscriptionId;

      if (!existingSubId || sub.status === "canceled" || sub.plan === "free") {
        return NextResponse.json({
          amountDue: 0,
          currency: "usd",
          periodEnd: null,
          lineItems: [],
        });
      }

      const provider = getBillingProvider();
      const preview = await provider.previewProration(existingSubId, priceId);

      return NextResponse.json({
        amountDue: preview.amountDue,
        currency: preview.currency,
        periodEnd: preview.periodEnd?.toISOString() ?? null,
        lineItems: preview.lineItems,
      });
    } catch (error) {
      logSystemError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[Billing] Preview proration error",
        error,
        { endpoint: "/api/billing/preview-proration", operation: "post" }
      );
      return NextResponse.json(
        { error: "Failed to preview proration" },
        { status: 500 }
      );
    }
  }
);
