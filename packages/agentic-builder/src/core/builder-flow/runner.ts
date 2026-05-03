export type BuilderProgressEvent = {
  readonly detail?: string;
  readonly label: string;
  readonly stage: string;
  readonly status: "running" | "completed";
};

export type BuilderProgressReporter = (
  event: BuilderProgressEvent
) => Promise<void> | void;

export async function reportBuilderProgress(
  reporter: BuilderProgressReporter,
  event: BuilderProgressEvent
) {
  await Promise.resolve(reporter(event));
}
