import type { EvalExecWorkerPort, RunStorePort } from "../providers.js";
import type {
  LoopConfig,
  PrepareRequest,
  RunRequestDraft,
} from "../schemas.js";
import { prepareEvalExecRequest } from "./prepare-request.js";
import { defaultLoopConfig } from "./request-policy.js";
import {
  createRunRecord,
  executeRunRecord,
  toRunResponse,
} from "./run-loop.js";

export class EvalExecLoopV3 {
  constructor(
    private readonly worker: EvalExecWorkerPort,
    private readonly runStore: RunStorePort,
    private readonly config: LoopConfig = defaultLoopConfig
  ) {}

  prepare(input: string | PrepareRequest) {
    return prepareEvalExecRequest(input, this.worker, this.config);
  }

  async start(input: string | RunRequestDraft) {
    const run = createRunRecord(
      typeof input === "string" ? { task: input } : input,
      this.config
    );
    await this.runStore.create(run);
    void executeRunRecord(run, this.worker, this.runStore, this.config);
    return {
      runId: run.id,
      adapter: this.worker.name,
      task: run.request.task,
      workdir: run.request.workdir,
    };
  }

  async status(runId: string) {
    const run = await this.mustGet(runId);
    return {
      runId: run.id,
      phase: run.phase,
      adapter: this.worker.name,
      task: run.request.task,
      workdir: run.request.workdir,
      executionRound: run.executionRound,
      fixRound: run.fixRound,
      latestScore: run.latestScore,
      latestError: run.latestError,
    };
  }

  async result(runId: string) {
    return toRunResponse(await this.mustGet(runId), this.worker.name);
  }

  async cancel(runId: string) {
    const run = await this.mustGet(runId);
    run.cancelled = true;
    await this.runStore.save(run);
    return { runId, cancelled: true };
  }

  private async mustGet(runId: string) {
    const run = await this.runStore.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    return run;
  }
}
