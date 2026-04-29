import { NextResponse } from "next/server";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

/**
 * GET /api/health
 * Health check endpoint for monitoring and load balancers
 */
export const GET = withTracedApiHandler("GET /api/health", function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});
