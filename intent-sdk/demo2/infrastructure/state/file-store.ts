import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunStorePort } from "../../core/providers.js";
import { type RunRecord, RunRecordSchema } from "../../core/schemas.js";

export type FileRunStoreOptions = {
  dataDir: string;
};

export class FileRunStore implements RunStorePort {
  private readonly runsDir: string;

  constructor(options: FileRunStoreOptions) {
    this.runsDir = path.join(options.dataDir, "runs");
  }

  async create(run: RunRecord): Promise<void> {
    await this.save(run);
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    try {
      const raw = await readFile(this.filePath(runId), "utf8");
      return RunRecordSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  async save(run: RunRecord): Promise<void> {
    await mkdir(this.runsDir, { recursive: true });
    await writeFile(
      this.filePath(run.id),
      `${JSON.stringify(RunRecordSchema.parse(run), null, 2)}\n`
    );
  }

  private filePath(runId: string): string {
    return path.join(this.runsDir, `${safeFileId(runId)}.json`);
  }
}

function safeFileId(value: string): string {
  if (
    !value ||
    value !== path.basename(value) ||
    value === "." ||
    value === ".."
  ) {
    throw new Error("Invalid run id.");
  }
  return value;
}
