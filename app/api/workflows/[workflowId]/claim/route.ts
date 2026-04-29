import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflows } from "@/lib/db/schema";
import { ErrorCategory, logSystemError } from "@/lib/logging";
import { getOrgContext } from "@/lib/middleware/org-context";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

export const POST = withTracedApiHandler("POST /api/workflows/:workflowId/claim", async function POST(
  _request: Request,
  context: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await context.params;

    const orgContext = await getOrgContext();

    if (!orgContext.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!orgContext.organization?.id) {
      return NextResponse.json(
        { error: "No organization found" },
        { status: 400 }
      );
    }

    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    if (!workflow.isAnonymous || workflow.userId !== orgContext.user.id) {
      return NextResponse.json(
        { error: "Cannot claim this workflow" },
        { status: 403 }
      );
    }

    const [updatedWorkflow] = await db
      .update(workflows)
      .set({
        organizationId: orgContext.organization.id,
        isAnonymous: false,
        userId: orgContext.user.id,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, workflowId))
      .returning();

    return NextResponse.json(updatedWorkflow);
  } catch (error) {
    logSystemError(ErrorCategory.DATABASE, "Failed to claim workflow", error, { endpoint: "/api/workflows/[workflowId]/claim", operation: "post" });
    return NextResponse.json(
      { error: "Failed to claim workflow" },
      { status: 500 }
    );
  }
});
