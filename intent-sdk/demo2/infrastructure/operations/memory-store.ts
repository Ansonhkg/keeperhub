import type {
  OperationActionRecord,
  OperationEventRecord,
  OperationSessionRecord,
  OperationStorePort,
} from "../../core/providers.js";

export class InMemoryOperationStore implements OperationStorePort {
  private readonly sessions = new Map<string, OperationSessionRecord>();
  private readonly events = new Map<string, OperationEventRecord[]>();
  private readonly actions = new Map<string, OperationActionRecord[]>();
  private readonly listeners = new Map<
    string,
    Set<(event: OperationEventRecord) => void>
  >();

  listSessions(): OperationSessionRecord[] {
    return [...this.sessions.values()].map((session) =>
      structuredClone(session)
    );
  }

  getSession(sessionId: string): OperationSessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(session) : undefined;
  }

  saveSession(session: OperationSessionRecord): void {
    this.sessions.set(session.sessionId, structuredClone(session));
  }

  listEvents(sessionId: string): OperationEventRecord[] {
    return structuredClone(this.events.get(sessionId) ?? []);
  }

  appendEvent(event: OperationEventRecord): void {
    const existing = this.events.get(event.sessionId) ?? [];
    existing.push(structuredClone(event));
    this.events.set(event.sessionId, existing);
    for (const listener of this.listeners.get(event.sessionId) ?? []) {
      listener(structuredClone(event));
    }
  }

  listActions(sessionId: string): OperationActionRecord[] {
    return structuredClone(this.actions.get(sessionId) ?? []);
  }

  appendAction(action: OperationActionRecord): void {
    const existing = this.actions.get(action.sessionId) ?? [];
    existing.push(structuredClone(action));
    this.actions.set(action.sessionId, existing);
  }

  subscribe(
    sessionId: string,
    listener: (event: OperationEventRecord) => void
  ): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => listeners.delete(listener);
  }
}
