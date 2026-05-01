import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";

export function ValidationPanel({
  projection,
}: {
  readonly projection: BuilderProjection;
}) {
  return (
    <section className="rounded-lg border p-3">
      <h2 className="font-medium">Validation</h2>
      {projection.validation.issues.map((issue) => (
        <p className="text-sm" key={issue.code}>
          {issue.message}
        </p>
      ))}
    </section>
  );
}
