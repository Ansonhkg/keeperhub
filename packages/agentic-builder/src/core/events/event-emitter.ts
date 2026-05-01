import type { EventSinkPort } from "../ports/all";
import type {
  BuilderAuthContext,
  BuilderEvent,
  BuilderSession,
} from "../schemas/all";

export async function emitBuilderEvent(
  eventSink: EventSinkPort,
  auth: BuilderAuthContext,
  session: BuilderSession,
  event: BuilderEvent
): Promise<BuilderSession> {
  await eventSink.emit(auth, event);
  return {
    ...session,
    events: [...session.events, event],
    updatedAt: event.createdAt,
  };
}
