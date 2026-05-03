import type { EvalExecWorkerPort } from "../providers.js";
import { getRequestPolicy } from "../request/policy.js";
import {
  type LoopConfig,
  type PrepareRequest,
  type PrepareResponse,
  PrepareResponseSchema,
} from "../schemas.js";
import {
  defaultLoopConfig,
  materializeRunRequest,
  normalizePrepareInput,
  normalizeText,
  resolveDefaultWorkdir,
} from "./request-policy.js";

export async function prepareEvalExecRequest(
  input: string | PrepareRequest,
  worker: EvalExecWorkerPort,
  config: LoopConfig = defaultLoopConfig
): Promise<PrepareResponse> {
  const prepareInput = normalizePrepareInput(input);
  const resolvedWorkdir = resolveDefaultWorkdir(
    prepareInput.workdir ?? prepareInput.request?.workdir
  );

  try {
    const generated = await worker.prepare(prepareInput, resolvedWorkdir);
    const preparedRequest = materializeRunRequest(
      {
        ...generated,
        ...(prepareInput.request ?? {}),
        task:
          normalizeText(prepareInput.request?.task) ||
          normalizeText(generated.task) ||
          normalizeText(prepareInput.intent),
        workdir:
          normalizeText(prepareInput.request?.workdir) ||
          normalizeText(prepareInput.workdir) ||
          normalizeText(generated.workdir) ||
          resolvedWorkdir,
      },
      config
    );

    return PrepareResponseSchema.parse({
      preparedRequest,
      workdirResolved: preparedRequest.workdir,
      source: "adapter",
      assumptions: [],
      adapter: worker.name,
      config,
      workflow: ["prepare", "run-loop", "result"],
    });
  } catch {
    const policy = getRequestPolicy();
    const preparedRequest = materializeRunRequest(
      {
        ...(prepareInput.request ?? {}),
        task:
          normalizeText(prepareInput.request?.task) ||
          normalizeText(prepareInput.intent),
        workdir:
          normalizeText(prepareInput.request?.workdir) ||
          normalizeText(prepareInput.workdir) ||
          resolvedWorkdir,
      },
      config
    );

    return PrepareResponseSchema.parse({
      preparedRequest,
      workdirResolved: preparedRequest.workdir,
      source: "fallback",
      assumptions: [
        preparedRequest.expectedAnswer
          ? policy.fallbackAssumptions.exact
          : policy.fallbackAssumptions.default,
      ],
      adapter: worker.name,
      config,
      workflow: policy.workflow,
    });
  }
}
