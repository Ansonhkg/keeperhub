import type {
  EvalExecWorkerPort,
  OperationStorePort,
  RunStorePort,
} from "../core/providers.js";
import { type LoopConfig, ProviderEnvSchema } from "../core/schemas.js";
import {
  defaultLoopConfig,
  resolveDefaultWorkdir,
} from "../core/services/request-policy.js";
import { FileOperationStore } from "../infrastructure/operations/file-store.js";
import { InMemoryOperationStore } from "../infrastructure/operations/memory-store.js";
import { FileRunStore } from "../infrastructure/state/file-store.js";
import { InMemoryRunStore } from "../infrastructure/state/memory-store.js";
import { DemoWorker } from "../infrastructure/workers/demo-worker.js";
import { OpencodeWorker } from "../infrastructure/workers/opencode-worker.js";

export type EvalExecRuntime = {
  worker: EvalExecWorkerPort;
  runStore: RunStorePort;
  operationStore: OperationStorePort;
  config: LoopConfig;
  defaultWorkdir: string;
  now: () => string;
};

export function createEvalExecRuntime(
  env: NodeJS.ProcessEnv = process.env
): EvalExecRuntime {
  const parsed = ProviderEnvSchema.parse({
    backend: env.EVAL_EXEC_V3_BACKEND,
    stateBackend: env.EVAL_EXEC_V3_STATE_BACKEND,
    workdir: env.EVAL_EXEC_V3_WORKDIR,
    dataDir: env.EVAL_EXEC_V3_DATA_DIR,
    model: env.EVAL_EXEC_V3_MODEL,
    opencodeBinary: env.OPENCODE_BIN,
  });
  const defaultWorkdir = resolveDefaultWorkdir(parsed.workdir);
  const dataDir = parsed.dataDir ?? `${defaultWorkdir}/data`;

  const stateIsFile = parsed.stateBackend === "file";
  return {
    worker: createWorker(
      parsed.backend,
      defaultWorkdir,
      parsed.model,
      parsed.opencodeBinary
    ),
    runStore: stateIsFile
      ? new FileRunStore({ dataDir })
      : new InMemoryRunStore(),
    operationStore: stateIsFile
      ? new FileOperationStore({ dataDir })
      : new InMemoryOperationStore(),
    config: defaultLoopConfig,
    defaultWorkdir,
    now: () => new Date().toISOString(),
  };
}

function createWorker(
  backend: "demo" | "opencode",
  workdir: string,
  model?: string,
  binary?: string
): EvalExecWorkerPort {
  if (backend === "opencode") {
    return new OpencodeWorker({ workdir, model, binary });
  }
  return new DemoWorker();
}
