import type { BuilderAuthContext, BuilderEvent } from "../schemas/all";

export function createLifecycleEvent(input: {
  readonly id: string;
  readonly sessionId: string;
  readonly actor: BuilderAuthContext;
  readonly stage: string;
  readonly phaseStatus: "started" | "completed" | "failed";
  readonly createdAt: string;
  readonly turnId?: string;
  readonly model?: string;
  readonly templateName?: string;
  readonly templateVersion?: string;
  readonly durationMs?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
}): BuilderEvent {
  return { ...input, eventKind: "lifecycle" };
}

export function createAuditEvent(input: {
  readonly id: string;
  readonly sessionId: string;
  readonly actor: BuilderAuthContext;
  readonly stage: string;
  readonly outcome:
    | "accepted"
    | "rejected"
    | "blocked"
    | "requested"
    | "materialized";
  readonly createdAt: string;
  readonly targetId?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}): BuilderEvent {
  return { ...input, eventKind: "audit" };
}
