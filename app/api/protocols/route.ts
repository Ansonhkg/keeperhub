import { NextResponse } from "next/server";

import "@/protocols";
import { getRegisteredProtocols } from "@/lib/protocol-registry";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

export const GET = withTracedApiHandler(
  "GET /api/protocols",
  function GET(): NextResponse {
    const protocols = getRegisteredProtocols();
    return NextResponse.json(protocols);
  }
);
