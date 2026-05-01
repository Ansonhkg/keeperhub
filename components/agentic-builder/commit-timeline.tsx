import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";

export function CommitTimeline({
  projection,
}: {
  readonly projection: BuilderProjection;
}) {
  return (
    <ol className="grid gap-1">
      {projection.timeline.map((item) => (
        <li className="text-sm" key={item.id}>
          {item.kind}: {item.label}
        </li>
      ))}
    </ol>
  );
}
