import type { BuilderStorePort } from "@keeperhub/agentic-builder/ports";
import type {
  BuilderAuthContext,
  BuilderEvent,
  BuilderSession,
} from "@keeperhub/agentic-builder/schemas";

const sessions = new Map<string, BuilderSession>();

function assertScope(auth: BuilderAuthContext, session: BuilderSession): void {
  if (session.auth.organizationId !== auth.organizationId) {
    throw new Error("Builder session organization mismatch");
  }
}

export function createMemoryBuilderStore(): BuilderStorePort {
  return {
    async createSession(auth, session) {
      assertScope(auth, session);
      sessions.set(session.id, session);
    },
    async getSession(auth, sessionId) {
      const session = sessions.get(sessionId);
      if (session) assertScope(auth, session);
      return session;
    },
    async saveSession(auth, session) {
      assertScope(auth, session);
      sessions.set(session.id, session);
    },
    async listEvents(auth, sessionId): Promise<readonly BuilderEvent[]> {
      const session = sessions.get(sessionId);
      if (!session) return [];
      assertScope(auth, session);
      return session.events;
    },
  };
}
