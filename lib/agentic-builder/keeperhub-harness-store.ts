import type { BuilderAuthContext } from "@keeperhub/agentic-builder/schemas";
import type {
  EventRecord,
  HarnessActionRecord,
  HarnessCheckpoint,
  HarnessSessionRecord,
  HarnessStore,
} from "@keeperhub/intent-sdk";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  harnessActions,
  harnessCheckpoints,
  harnessEvents,
  harnessSessions,
} from "@/lib/db/schema";

function eventId(runId: string, index: number) {
  return `${runId}:${index}`;
}

export function createKeeperHubHarnessStore<TInput = unknown>(
  auth: BuilderAuthContext
): HarnessStore<TInput> {
  async function ensureSession(runId: string) {
    await db
      .insert(harnessSessions)
      .values({
        input: {},
        organizationId: auth.organizationId,
        runId,
        snapshot: { input: {}, runId, status: "running" },
        status: "running",
        userId: auth.userId,
      })
      .onConflictDoNothing();
  }

  return {
    async appendAction(action) {
      await ensureSession(action.runId);
      await db
        .insert(harnessActions)
        .values({
          action: action as Record<string, unknown>,
          actionId: action.actionId,
          organizationId: auth.organizationId,
          runId: action.runId,
        })
        .onConflictDoNothing();
    },
    async appendCheckpoint(checkpoint) {
      await ensureSession(checkpoint.runId);
      await db
        .insert(harnessCheckpoints)
        .values({
          checkpoint: checkpoint as Record<string, unknown>,
          checkpointId: checkpoint.checkpointId,
          organizationId: auth.organizationId,
          runId: checkpoint.runId,
        })
        .onConflictDoNothing();
    },
    async appendEvent(event) {
      await ensureSession(event.runId);
      await db
        .insert(harnessEvents)
        .values({
          event: event as Record<string, unknown>,
          eventIndex: event.index,
          id: eventId(event.runId, event.index),
          organizationId: auth.organizationId,
          runId: event.runId,
        })
        .onConflictDoNothing();
    },
    async getSession(runId) {
      const [row] = await db
        .select()
        .from(harnessSessions)
        .where(
          and(
            eq(harnessSessions.runId, runId),
            eq(harnessSessions.organizationId, auth.organizationId)
          )
        )
        .limit(1);
      return row ? (row.snapshot as HarnessSessionRecord<TInput>) : undefined;
    },
    async listActions(runId) {
      const rows = await db
        .select()
        .from(harnessActions)
        .where(
          and(
            eq(harnessActions.runId, runId),
            eq(harnessActions.organizationId, auth.organizationId)
          )
        )
        .orderBy(asc(harnessActions.createdAt));
      return rows.map((row) => row.action as HarnessActionRecord);
    },
    async listCheckpoints(runId) {
      const rows = await db
        .select()
        .from(harnessCheckpoints)
        .where(
          and(
            eq(harnessCheckpoints.runId, runId),
            eq(harnessCheckpoints.organizationId, auth.organizationId)
          )
        )
        .orderBy(asc(harnessCheckpoints.createdAt));
      return rows.map((row) => row.checkpoint as HarnessCheckpoint<TInput>);
    },
    async listEvents(runId) {
      const rows = await db
        .select()
        .from(harnessEvents)
        .where(
          and(
            eq(harnessEvents.runId, runId),
            eq(harnessEvents.organizationId, auth.organizationId)
          )
        )
        .orderBy(asc(harnessEvents.eventIndex));
      return rows.map((row) => row.event as EventRecord);
    },
    async saveSession(session) {
      await db
        .insert(harnessSessions)
        .values({
          input: session.input,
          organizationId: auth.organizationId,
          runId: session.runId,
          snapshot: session as Record<string, unknown>,
          status: session.status,
          userId: auth.userId,
        })
        .onConflictDoUpdate({
          set: {
            input: session.input,
            snapshot: session as Record<string, unknown>,
            status: session.status,
            updatedAt: new Date(),
          },
          target: harnessSessions.runId,
        });
    },
  };
}
