import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";

export function BuilderCanvas({
  projection,
}: {
  readonly projection: BuilderProjection;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-[1fr_280px]">
      <div className="rounded-lg border p-3">
        <h2 className="font-medium">Committed workflow</h2>
        <div className="mt-3 grid gap-2">
          {projection.committed.nodes.map((node) => (
            <div
              className="rounded-md border bg-background p-2 text-sm"
              key={node.id}
            >
              {node.label}
            </div>
          ))}
        </div>
        <CandidateBranchLayer projection={projection} />
      </div>
      <ValidationPanel projection={projection} />
    </section>
  );
}

function CandidateBranchLayer({
  projection,
}: {
  readonly projection: BuilderProjection;
}) {
  return (
    <div className="mt-4 grid gap-2">
      {projection.candidateBranches.map((branch) => (
        <div
          className="rounded-md border border-dashed bg-muted/40 p-2 text-muted-foreground text-sm"
          key={branch.branchId}
        >
          Grey preview: {branch.optionId}
        </div>
      ))}
    </div>
  );
}

function ValidationPanel({
  projection,
}: {
  readonly projection: BuilderProjection;
}) {
  return (
    <aside className="rounded-lg border p-3">
      <h2 className="font-medium">Validation</h2>
      <p className="mt-2 text-sm">
        {projection.validation.valid ? "Ready to materialize" : "Needs review"}
      </p>
    </aside>
  );
}
