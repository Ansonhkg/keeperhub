import type { RunStorePort } from "../../core/providers.js";
import type { RunRecord } from "../../core/schemas.js";

export class InMemoryRunStore implements RunStorePort {
  private readonly runs = new Map<string, RunRecord>();

  create(run: RunRecord): void {
    this.runs.set(run.id, structuredClone(run));
  }

  get(runId: string): RunRecord | undefined {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  save(run: RunRecord): void {
    this.runs.set(run.id, structuredClone(run));
  }
}
