import type { ValidationResult, WorkflowDraft } from "../schemas/all";

export function validateBuilderReadiness(
  committed: WorkflowDraft
): ValidationResult {
  const issues =
    committed.nodes.length === 0
      ? [
          {
            code: "empty_workflow",
            message: "No committed workflow steps",
            severity: "error" as const,
          },
        ]
      : [];
  return { issues, valid: issues.every((issue) => issue.severity !== "error") };
}
