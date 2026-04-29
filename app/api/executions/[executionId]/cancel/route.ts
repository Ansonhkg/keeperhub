import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  workflowExecutionLogs,
  workflowExecutions,
  workflows,
} from "@/lib/db/schema";
import { ErrorCategory, logSystemError } from "@/lib/logging";
import { getOrgContext } from "@/lib/middleware/org-context";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

export const POST = withTracedApiHandler(
  "POST /api/executions/:executionId/cancel",
  async function POST(
    _request: Request,
    context: { params: Promise<{ executionId: string }> }
  ): Promise<NextResponse> {
    try {
      const { executionId } = await context.params;

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

      // Fetch execution and verify it belongs to the user's org via the workflow
      const execution = await db.query.workflowExecutions.findFirst({
        where: eq(workflowExecutions.id, executionId),
        columns: {
          id: true,
          status: true,
          workflowId: true,
          startedAt: true,
        },
      });

      if (!execution) {
        return NextResponse.json(
          { error: "Execution not found" },
          { status: 404 }
        );
      }

      // Verify the workflow belongs to the user's organization
      const workflow = await db.query.workflows.findFirst({
        where: and(
          eq(workflows.id, execution.workflowId),
          eq(workflows.organizationId, orgContext.organization.id)
        ),
        columns: { id: true },
      });

      if (!workflow) {
        return NextResponse.json(
          { error: "Execution not found" },
          { status: 404 }
        );
      }

      if (execution.status !== "running") {
        return NextResponse.json(
          { error: "Execution is not running" },
          { status: 400 }
        );
      }

      const now = new Date();
      const duration = now.getTime() - execution.startedAt.getTime();

      await db
        .update(workflowExecutions)
        .set({
          status: "cancelled",
          error: "Cancelled by user",
          completedAt: now,
          duration: duration.toString(),
          currentNodeId: null,
          currentNodeName: null,
        })
        .where(eq(workflowExecutions.id, executionId));

      // Mark any in-flight step logs as "error" to prevent orphaned "running" entries
      await db
        .update(workflowExecutionLogs)
        .set({
          status: "cancelled",
          error: "Cancelled by user",
          completedAt: now,
        })
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.status, "running")
          )
        );

      return NextResponse.json({ success: true });
    } catch (error) {
      logSystemError(
        ErrorCategory.DATABASE,
        "Failed to cancel execution",
        error,
        { endpoint: "/api/executions/[executionId]/cancel", operation: "post" }
      );
      return NextResponse.json(
        { error: "Failed to cancel execution" },
        { status: 500 }
      );
    }
  }
);
