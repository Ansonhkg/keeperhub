import "server-only";

import { NextResponse } from "next/server";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";
import { validateApiKey } from "../_lib/auth";

export const POST = withTracedApiHandler(
  "POST /api/execute/swap",
  async function POST(request: Request): Promise<NextResponse> {
    const apiKeyCtx = await validateApiKey(request);
    if (!apiKeyCtx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ message: "Coming soon" }, { status: 501 });
  }
);
