import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { ErrorCategory, logSystemError } from "@/lib/logging";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

// DELETE - Delete an API key
export const DELETE = withTracedApiHandler(
  "DELETE /api/api-keys/:keyId",
  async function DELETE(
    request: Request,
    context: { params: Promise<{ keyId: string }> }
  ) {
    try {
      const { keyId } = await context.params;
      const session = await auth.api.getSession({
        headers: request.headers,
      });

      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Delete the key (only if it belongs to the user)
      const result = await db
        .delete(apiKeys)
        .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, session.user.id)))
        .returning({ id: apiKeys.id });

      if (result.length === 0) {
        return NextResponse.json(
          { error: "API key not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      logSystemError(
        ErrorCategory.DATABASE,
        "Failed to delete API key",
        error,
        {
          endpoint: "/api/api-keys/[keyId]",
          operation: "delete",
        }
      );
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Failed to delete API key",
        },
        { status: 500 }
      );
    }
  }
);
