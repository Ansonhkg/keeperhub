import type {
  BuilderAuthContext,
  MaterializeWorkflowInput,
  MissingCapability,
  RegenerateInput,
} from "../../core/schemas/all";
import type { BuilderRuntime } from "../../core/services/runtime";

export type BuilderMcpToolName =
  | "builder_start_session"
  | "builder_get_projection"
  | "builder_get_events"
  | "builder_select_option"
  | "builder_reject_option"
  | "builder_answer_question"
  | "builder_regenerate_from_node"
  | "builder_request_native_capability"
  | "builder_materialize_workflow"
  | "builder_cancel_session";

export type BuilderMcpTool = {
  readonly name: BuilderMcpToolName;
  readonly description: string;
  readonly run: (
    auth: BuilderAuthContext,
    input: Readonly<Record<string, unknown>>
  ) => Promise<unknown>;
};

export function createBuilderMcpTools(
  runtime: BuilderRuntime
): readonly BuilderMcpTool[] {
  return [
    {
      name: "builder_start_session",
      description: "Start agentic builder session",
      run: (auth, input) =>
        runtime.startSession(auth, String(input.prompt ?? "")),
    },
    {
      name: "builder_get_projection",
      description: "Get builder projection",
      run: (auth, input) =>
        runtime.getProjection(auth, String(input.sessionId)),
    },
    {
      name: "builder_get_events",
      description: "Get builder events",
      run: (auth, input) => runtime.getEvents(auth, String(input.sessionId)),
    },
    {
      name: "builder_select_option",
      description: "Select option into DAG commit",
      run: (auth, input) =>
        runtime.selectOption(
          auth,
          String(input.sessionId),
          String(input.optionId),
          typeof input.expectedRevision === "number"
            ? input.expectedRevision
            : undefined
        ),
    },
    {
      name: "builder_reject_option",
      description: "Reject option without moving head",
      run: (auth, input) =>
        runtime.rejectOption(
          auth,
          String(input.sessionId),
          String(input.optionId)
        ),
    },
    {
      name: "builder_answer_question",
      description: "Answer open question and resume planning",
      run: (auth, input) =>
        runtime.answerQuestion(auth, String(input.sessionId), {
          questionId: String(input.questionId),
          answer: String(input.answer),
        }),
    },
    {
      name: "builder_regenerate_from_node",
      description: "Regenerate downstream from node or commit",
      run: (auth, input) =>
        runtime.regenerateFromNode(
          auth,
          String(input.sessionId),
          input as RegenerateInput
        ),
    },
    {
      name: "builder_request_native_capability",
      description: "Create contextual native capability request",
      run: (auth, input) =>
        runtime.requestNativeCapability(
          auth,
          String(input.sessionId),
          input as MissingCapability
        ),
    },
    {
      name: "builder_materialize_workflow",
      description: "Materialize committed workflow state",
      run: (auth, input) =>
        runtime.materializeWorkflow(
          auth,
          String(input.sessionId),
          input as MaterializeWorkflowInput
        ),
    },
    {
      name: "builder_cancel_session",
      description: "Cancel builder session",
      run: (auth, input) =>
        runtime.cancelSession(auth, String(input.sessionId)),
    },
  ];
}
