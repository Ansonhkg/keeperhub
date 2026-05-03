import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  OperationActionRecord,
  OperationEventRecord,
  OperationSessionRecord,
  OperationStorePort,
} from "../../core/providers.js";

export class FileOperationStore implements OperationStorePort {
  private readonly operationsDir: string;
  private readonly listeners = new Map<
    string,
    Set<(event: OperationEventRecord) => void>
  >();

  constructor(options: { dataDir: string }) {
    this.operationsDir = path.join(options.dataDir, "operations");
  }

  async listSessions(): Promise<OperationSessionRecord[]> {
    await mkdir(this.operationsDir, { recursive: true });
    const entries = await readdir(this.operationsDir, { withFileTypes: true });
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.getSession(entry.name))
    );
    return sessions.filter((session): session is OperationSessionRecord =>
      Boolean(session)
    );
  }

  async getSession(
    sessionId: string
  ): Promise<OperationSessionRecord | undefined> {
    try {
      return JSON.parse(
        await readFile(
          path.join(this.sessionDir(sessionId), "session.json"),
          "utf8"
        )
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return undefined;
      throw error;
    }
  }

  async saveSession(session: OperationSessionRecord): Promise<void> {
    await mkdir(this.sessionDir(session.sessionId), { recursive: true });
    await writeFile(
      path.join(this.sessionDir(session.sessionId), "session.json"),
      `${JSON.stringify(session, null, 2)}\n`
    );
  }

  async listEvents(sessionId: string): Promise<OperationEventRecord[]> {
    return this.readList<OperationEventRecord>(sessionId, "events.json");
  }

  async appendEvent(event: OperationEventRecord): Promise<void> {
    const events = await this.listEvents(event.sessionId);
    events.push(event);
    await this.writeList(event.sessionId, "events.json", events);
    for (const listener of this.listeners.get(event.sessionId) ?? []) {
      listener(structuredClone(event));
    }
  }

  async listActions(sessionId: string): Promise<OperationActionRecord[]> {
    return this.readList<OperationActionRecord>(sessionId, "actions.json");
  }

  async appendAction(action: OperationActionRecord): Promise<void> {
    const actions = await this.listActions(action.sessionId);
    actions.push(action);
    await this.writeList(action.sessionId, "actions.json", actions);
  }

  subscribe(
    sessionId: string,
    listener: (event: OperationEventRecord) => void
  ): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(sessionId);
    };
  }

  private async readList<T>(sessionId: string, fileName: string): Promise<T[]> {
    try {
      return JSON.parse(
        await readFile(path.join(this.sessionDir(sessionId), fileName), "utf8")
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return [];
      throw error;
    }
  }

  private async writeList<T>(
    sessionId: string,
    fileName: string,
    records: T[]
  ): Promise<void> {
    await mkdir(this.sessionDir(sessionId), { recursive: true });
    await writeFile(
      path.join(this.sessionDir(sessionId), fileName),
      `${JSON.stringify(records, null, 2)}\n`
    );
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.operationsDir, safeFileId(sessionId));
  }
}

function safeFileId(value: string): string {
  if (
    !value ||
    value !== path.basename(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new Error("Invalid operation session id.");
  }
  return value;
}
