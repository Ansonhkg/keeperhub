import type { BuilderAuthContext } from "../../core/schemas/all";
import {
  answerQuestionInputSchema,
  materializeWorkflowInputSchema,
  regenerateInputSchema,
} from "../../core/schemas/all";
import type { BuilderRuntime } from "../../core/services/runtime";
import { errorResponse, eventStream, jsonResponse } from "./format";

export type ResolveAuth = (request: Request) => Promise<BuilderAuthContext>;

async function readJson(request: Request): Promise<unknown> {
  return request.headers.get("content-length") === "0" ? {} : request.json();
}

export function createHttpHandlers(
  runtime: BuilderRuntime,
  resolveAuth: ResolveAuth
) {
  return {
    async startSession(request: Request) {
      try {
        const auth = await resolveAuth(request);
        const body = (await readJson(request)) as {
          context?: unknown;
          prompt?: unknown;
        };
        if (typeof body.prompt !== "string" || body.prompt.length === 0)
          throw new Error("prompt is required");
        return jsonResponse(
          await runtime.startSession(
            auth,
            body.prompt,
            typeof body.context === "string" ? body.context : undefined
          )
        );
      } catch (error) {
        return errorResponse(error);
      }
    },
    async getProjection(request: Request, sessionId: string) {
      try {
        return jsonResponse(
          await runtime.getProjection(await resolveAuth(request), sessionId)
        );
      } catch (error) {
        return errorResponse(error, 404);
      }
    },
    async getEvents(request: Request, sessionId: string) {
      try {
        return eventStream(
          await runtime.getEvents(await resolveAuth(request), sessionId)
        );
      } catch (error) {
        return errorResponse(error, 404);
      }
    },
    async selectOption(request: Request, sessionId: string, optionId: string) {
      try {
        const body = (await readJson(request)) as {
          expectedRevision?: unknown;
        };
        return jsonResponse(
          await runtime.selectOption(
            await resolveAuth(request),
            sessionId,
            optionId,
            typeof body.expectedRevision === "number"
              ? body.expectedRevision
              : undefined
          )
        );
      } catch (error) {
        return errorResponse(error);
      }
    },
    async rejectOption(request: Request, sessionId: string, optionId: string) {
      try {
        return jsonResponse(
          await runtime.rejectOption(
            await resolveAuth(request),
            sessionId,
            optionId
          )
        );
      } catch (error) {
        return errorResponse(error);
      }
    },
    async answerQuestion(request: Request, sessionId: string) {
      try {
        return jsonResponse(
          await runtime.answerQuestion(
            await resolveAuth(request),
            sessionId,
            answerQuestionInputSchema.parse(await readJson(request))
          )
        );
      } catch (error) {
        return errorResponse(error);
      }
    },
    async regenerateFromNode(request: Request, sessionId: string) {
      try {
        return jsonResponse(
          await runtime.regenerateFromNode(
            await resolveAuth(request),
            sessionId,
            regenerateInputSchema.parse(await readJson(request))
          )
        );
      } catch (error) {
        return errorResponse(error);
      }
    },
    async requestNativeCapability(request: Request, sessionId: string) {
      try {
        return jsonResponse(
          await runtime.requestNativeCapability(
            await resolveAuth(request),
            sessionId,
            (await readJson(request)) as never
          )
        );
      } catch (error) {
        return errorResponse(error);
      }
    },
    async materializeWorkflow(request: Request, sessionId: string) {
      try {
        return jsonResponse(
          await runtime.materializeWorkflow(
            await resolveAuth(request),
            sessionId,
            materializeWorkflowInputSchema.parse(await readJson(request))
          )
        );
      } catch (error) {
        return errorResponse(error);
      }
    },
    async cancelSession(request: Request, sessionId: string) {
      try {
        return jsonResponse(
          await runtime.cancelSession(await resolveAuth(request), sessionId)
        );
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
