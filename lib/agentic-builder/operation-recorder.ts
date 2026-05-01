import type { EventSinkPort } from "@keeperhub/agentic-builder/ports";
import type {
  BuilderAuthContext,
  BuilderEvent,
} from "@keeperhub/agentic-builder/schemas";

const events = new Map<string, BuilderEvent[]>();

export function createOperationRecorder(): EventSinkPort {
  return {
    async emit(_auth: BuilderAuthContext, event: BuilderEvent) {
      events.set(event.sessionId, [
        ...(events.get(event.sessionId) ?? []),
        event,
      ]);
    },
  };
}

export function readRecordedBuilderEvents(
  sessionId: string
): readonly BuilderEvent[] {
  return events.get(sessionId) ?? [];
}
