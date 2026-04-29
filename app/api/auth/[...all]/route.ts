import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { ErrorCategory, logSystemError } from "@/lib/logging";
import { withTracedApiHandler } from "@/lib/trace/api-request-trace";

const handlers = toNextJsHandler(auth);

export const GET = withTracedApiHandler(
  "GET /api/auth/:all",
  async function GET(req: Request) {
    try {
      return await handlers.GET(req);
    } catch (error) {
      logSystemError(ErrorCategory.AUTH, "[Auth GET] Handler error:", error, {
        endpoint: "/api/auth",
        method: "GET",
      });
      throw error;
    }
  }
);

export const POST = withTracedApiHandler(
  "POST /api/auth/:all",
  async function POST(req: Request) {
    try {
      return await handlers.POST(req);
    } catch (error) {
      logSystemError(ErrorCategory.AUTH, "[Auth POST] Handler error:", error, {
        endpoint: "/api/auth",
        method: "POST",
      });
      throw error;
    }
  }
);
