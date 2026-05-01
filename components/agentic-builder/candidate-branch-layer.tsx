import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";

export function CandidateBranchLayer({
  projection,
}: {
  readonly projection: BuilderProjection;
}) {
  return (
    <div className="grid gap-2">
      {projection.candidateBranches.map((branch) => (
        <div
          className="rounded border border-dashed p-2 text-muted-foreground"
          key={branch.branchId}
        >
          {branch.status}: {branch.optionId}
        </div>
      ))}
    </div>
  );
}
