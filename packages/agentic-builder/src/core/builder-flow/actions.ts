import { done, type HarnessStore, harness, step } from "@keeperhub/intent-sdk";

type BuilderActionInput = Record<string, never>;

export async function runBuilderActionHarness<TOutput>(input: {
  detail?: unknown;
  execute: () => Promise<TOutput>;
  runId: string;
  store?: HarnessStore<BuilderActionInput>;
  stepId: string;
  type: string;
}): Promise<TOutput> {
  const actionHarness = harness<
    { detail?: unknown; execute: () => Promise<TOutput>; type: string },
    BuilderActionInput
  >({
    id: `agentic-builder.${input.type}`,
    steps: [
      step(input.stepId, async ({ emit, use }) => {
        emit({
          detail: use.detail,
          message: `${use.type} started.`,
          type: `${use.type}.started`,
        });
        const output = await use.execute();
        emit({
          detail: use.detail,
          message: `${use.type} completed.`,
          type: `${use.type}.completed`,
        });
        return done({ output });
      }),
    ],
    use: {
      detail: input.detail,
      execute: input.execute,
      type: input.type,
    },
  });
  const result = await actionHarness.start(
    {},
    { runId: input.runId, store: input.store }
  );
  return result.state.output as TOutput;
}
