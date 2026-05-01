import type { BuilderProjection } from "@keeperhub/agentic-builder/schemas";

export function OptionPanel({
  projection,
  onSelect,
  onReject,
}: {
  readonly projection: BuilderProjection;
  readonly onSelect: (optionId: string) => void;
  readonly onReject: (optionId: string) => void;
}) {
  return (
    <aside className="grid gap-2">
      {projection.options.map((option) => (
        <article className="rounded-lg border p-3" key={option.id}>
          <h3 className="font-medium">{option.title}</h3>
          <p className="text-muted-foreground text-sm">{option.rationale}</p>
          <p className="text-xs">Risk: {option.risk}</p>
          <div className="mt-2 flex gap-2">
            <button
              className="rounded border px-2 py-1"
              onClick={() => onSelect(option.id)}
              type="button"
            >
              Select
            </button>
            <button
              className="rounded border px-2 py-1"
              onClick={() => onReject(option.id)}
              type="button"
            >
              Reject
            </button>
          </div>
        </article>
      ))}
    </aside>
  );
}
