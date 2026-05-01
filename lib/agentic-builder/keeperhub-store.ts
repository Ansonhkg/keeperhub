import type { BuilderStorePort } from "@keeperhub/agentic-builder/ports";
import type {
  BuilderAuthContext,
  BuilderEvent,
  BuilderSession,
} from "@keeperhub/agentic-builder/schemas";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { builderEvents, builderSessions } from "@/lib/db/schema";

function sessionRowToSession(
  row: typeof builderSessions.$inferSelect
): BuilderSession {
  return {
    auth: {
      actorType: "user",
      organizationId: row.organizationId,
      scopes: ["builder:read", "builder:write"],
      userId: row.userId,
    },
    catalogCandidates:
      row.catalogCandidates as BuilderSession["catalogCandidates"],
    createdAt: row.createdAt.toISOString(),
    dag: row.dag as BuilderSession["dag"],
    events: [],
    featureRequests: row.featureRequests,
    id: row.id,
    options: row.options as BuilderSession["options"],
    prompt: row.prompt,
    questions: row.questions as BuilderSession["questions"],
    status: row.status as BuilderSession["status"],
    turns: row.turns as BuilderSession["turns"],
    updatedAt: row.updatedAt.toISOString(),
  };
}

function eventRowToEvent(row: typeof builderEvents.$inferSelect): BuilderEvent {
  return row.event as BuilderEvent;
}

async function listSessionEvents(
  auth: BuilderAuthContext,
  sessionId: string
): Promise<readonly BuilderEvent[]> {
  const rows = await db
    .select()
    .from(builderEvents)
    .where(
      and(
        eq(builderEvents.sessionId, sessionId),
        eq(builderEvents.organizationId, auth.organizationId)
      )
    );
  return rows.map(eventRowToEvent);
}

export function createKeeperHubBuilderStore(): BuilderStorePort {
  return {
    async createSession(auth, session) {
      await db
        .insert(builderSessions)
        .values({
          catalogCandidates: session.catalogCandidates,
          dag: session.dag as Record<string, unknown>,
          featureRequests: session.featureRequests,
          id: session.id,
          options: session.options,
          organizationId: auth.organizationId,
          prompt: session.prompt,
          questions: session.questions,
          status: session.status,
          turns: session.turns,
          userId: auth.userId,
        })
        .onConflictDoUpdate({
          set: {
            catalogCandidates: session.catalogCandidates,
            dag: session.dag as Record<string, unknown>,
            featureRequests: session.featureRequests,
            options: session.options,
            questions: session.questions,
            status: session.status,
            turns: session.turns,
            updatedAt: new Date(),
          },
          target: builderSessions.id,
        });
      for (const event of session.events) {
        await db
          .insert(builderEvents)
          .values({
            event: event as Record<string, unknown>,
            id: event.id,
            organizationId: auth.organizationId,
            sessionId: session.id,
          })
          .onConflictDoNothing();
      }
    },
    async getSession(auth, sessionId) {
      const [row] = await db
        .select()
        .from(builderSessions)
        .where(
          and(
            eq(builderSessions.id, sessionId),
            eq(builderSessions.organizationId, auth.organizationId)
          )
        )
        .limit(1);
      if (!row) {
        return undefined;
      }
      return {
        ...sessionRowToSession(row),
        events: [...(await listSessionEvents(auth, sessionId))],
      };
    },
    async listEvents(auth, sessionId) {
      return listSessionEvents(auth, sessionId);
    },
    async saveSession(auth, session) {
      await this.createSession(auth, session);
    },
  };
}
