import { createHash } from "node:crypto";
import type { MaterializeWorkflowPort } from "@keeperhub/agentic-builder/ports";
import { and, eq } from "drizzle-orm";
import { materializeBuilderProjectionToRuntime } from "@/lib/agentic-builder/runtime-materializer";
import { db } from "@/lib/db";
import { builderMaterializations, workflows } from "@/lib/db/schema";

function toWorkflowNodes(
  projection: Parameters<
    MaterializeWorkflowPort["materialize"]
  >[0]["projection"]
) {
  return materializeBuilderProjectionToRuntime(projection).nodes;
}

function toWorkflowEdges(
  projection: Parameters<
    MaterializeWorkflowPort["materialize"]
  >[0]["projection"]
) {
  return materializeBuilderProjectionToRuntime(projection).edges;
}

export function createKeeperHubWorkflowMaterializer(): MaterializeWorkflowPort {
  return {
    async materialize(input) {
      const inputHash = createHash("sha256")
        .update(
          JSON.stringify({
            committed: input.projection.committed,
            mode: input.mode,
            name: input.name,
            workflowId: input.workflowId,
          })
        )
        .digest("hex");
      const [existingMaterialization] = await db
        .select({
          revision: builderMaterializations.revision,
          workflowId: builderMaterializations.workflowId,
        })
        .from(builderMaterializations)
        .where(
          and(
            eq(
              builderMaterializations.organizationId,
              input.auth.organizationId
            ),
            eq(builderMaterializations.sessionId, input.session.id),
            eq(builderMaterializations.idempotencyKey, input.idempotencyKey),
            eq(builderMaterializations.inputHash, inputHash)
          )
        )
        .limit(1);
      if (existingMaterialization) {
        return existingMaterialization;
      }
      const nodes = toWorkflowNodes(input.projection);
      const edges = toWorkflowEdges(input.projection);
      if (input.mode === "create") {
        const workflowId = `builder-${inputHash.slice(0, 32)}`;
        await db
          .insert(workflows)
          .values({
            description: `Created from builder session ${input.session.id}`,
            edges,
            id: workflowId,
            isAnonymous: false,
            name: input.name ?? "Agentic Workflow",
            nodes,
            organizationId: input.auth.organizationId,
            userId: input.auth.userId,
          })
          .onConflictDoNothing();
        const revision = Date.now();
        await db
          .insert(builderMaterializations)
          .values({
            idempotencyKey: input.idempotencyKey,
            inputHash,
            mode: input.mode,
            organizationId: input.auth.organizationId,
            revision,
            sessionId: input.session.id,
            workflowId,
          })
          .onConflictDoNothing();
        const [persistedMaterialization] = await db
          .select({
            revision: builderMaterializations.revision,
            workflowId: builderMaterializations.workflowId,
          })
          .from(builderMaterializations)
          .where(
            and(
              eq(
                builderMaterializations.organizationId,
                input.auth.organizationId
              ),
              eq(builderMaterializations.sessionId, input.session.id),
              eq(builderMaterializations.idempotencyKey, input.idempotencyKey),
              eq(builderMaterializations.inputHash, inputHash)
            )
          )
          .limit(1);
        return persistedMaterialization ?? { revision, workflowId };
      }
      const [existing] = await db
        .select({ id: workflows.id, updatedAt: workflows.updatedAt })
        .from(workflows)
        .where(
          and(
            eq(workflows.id, input.workflowId ?? ""),
            eq(workflows.organizationId, input.auth.organizationId)
          )
        )
        .limit(1);
      if (!existing) {
        throw new Error("Workflow not found for materialization update");
      }
      const currentRevision = existing.updatedAt.getTime();
      if (input.overwritePolicy === "fail") {
        if (input.expectedRevision === undefined) {
          throw new Error(
            "expectedRevision is required for fail-on-conflict updates"
          );
        }
        if (input.expectedRevision !== currentRevision) {
          throw new Error(
            `Workflow revision conflict: expected ${input.expectedRevision}, got ${currentRevision}`
          );
        }
      }
      const updatedAt = new Date();
      await db
        .update(workflows)
        .set({ edges, nodes, updatedAt })
        .where(eq(workflows.id, existing.id));
      await db
        .insert(builderMaterializations)
        .values({
          idempotencyKey: input.idempotencyKey,
          inputHash,
          mode: input.mode,
          organizationId: input.auth.organizationId,
          revision: updatedAt.getTime(),
          sessionId: input.session.id,
          workflowId: existing.id,
        })
        .onConflictDoNothing();
      return {
        revision: updatedAt.getTime(),
        workflowId: existing.id,
      };
    },
  };
}
