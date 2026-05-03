import { createBuilderFlow } from "../builder-flow/workflow";
import type { BuilderPorts } from "../ports/all";

export { runPredictionEngine } from "../builder-flow/artifact";
export {
  runCatalogSearch,
  runOptionGenerator,
} from "../builder-flow/capabilities";
export {
  inferCandidateCapability,
  resolveIntentConstraints,
  runIntentPlanner,
} from "../builder-flow/workflow";

export type BuilderRuntime = ReturnType<typeof createBuilderRuntime>;

export type { BuilderProgressEvent } from "../builder-flow/workflow";

export function createBuilderRuntime(ports: BuilderPorts) {
  const flow = createBuilderFlow(ports);

  return {
    answerQuestion: flow.answerQuestion,
    cancelSession: flow.cancelSession,
    getEvents: flow.getEvents,
    getProjection: flow.getProjection,
    materializeWorkflow: flow.materializeWorkflow,
    regenerateFromNode: flow.regenerateFromNode,
    rejectOption: flow.rejectOption,
    requestNativeCapability: flow.requestNativeCapability,
    selectOption: flow.selectOption,
    startSession: flow.startSession,
    startSessionWithProgress: flow.startSessionWithProgress,
  };
}
