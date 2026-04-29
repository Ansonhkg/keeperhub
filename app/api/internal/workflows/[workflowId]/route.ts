import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workflows } from "@/lib/db/schema";
import { authenticateInternalService } from "@/lib/internal-service-auth";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

export const GET = withTracedApiHandler(
  "GET /api/internal/workflows/:workflowId",
  async function GET(
    request: Request,
    context: { params: Promise<{ workflowId: string }> }
  ) {
    const auth = authenticateInternalService(request);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || "Unauthorized" },
        { status: 401 }
      );
    }

    const { workflowId } = await context.params;

    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
      columns: {
        id: true,
        enabled: true,
        userId: true,
        nodes: true,
        edges: true,
      },
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ workflow });
  }
);
