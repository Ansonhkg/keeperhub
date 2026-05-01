import type { FeatureRequestPort } from "@keeperhub/agentic-builder/ports";
import type {
  BuilderAuthContext,
  FeatureRequest,
  MissingCapability,
} from "@keeperhub/agentic-builder/schemas";
import { db } from "@/lib/db";
import { builderFeatureRequests } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

export function createKeeperHubFeatureRequests(): FeatureRequestPort {
  return {
    async create(
      auth: BuilderAuthContext,
      sessionId: string,
      missingCapability: MissingCapability
    ) {
      const request: FeatureRequest = {
        createdAt: new Date().toISOString(),
        id: generateId(),
        missingCapability,
        sessionId,
      };
      await db.insert(builderFeatureRequests).values({
        id: request.id,
        missingCapability: missingCapability as Record<string, unknown>,
        organizationId: auth.organizationId,
        sessionId,
      });
      return request;
    },
  };
}
