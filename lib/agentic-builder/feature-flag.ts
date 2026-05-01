function isTruthyFlag(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function isAgenticWorkflowBuilderEnabled(): boolean {
  if (
    process.env.KEEPERHUB_FEATURE_AGENTIC_WORKFLOW_BUILDER === "0" ||
    process.env.KEEPERHUB_FEATURE_AGENTIC_WORKFLOW_BUILDER === "false"
  ) {
    return false;
  }
  return (
    isTruthyFlag(process.env.KEEPERHUB_FEATURE_AGENTIC_WORKFLOW_BUILDER) ||
    isTruthyFlag(
      process.env.NEXT_PUBLIC_KEEPERHUB_FEATURE_AGENTIC_WORKFLOW_BUILDER
    ) ||
    process.env.NODE_ENV !== "production"
  );
}
