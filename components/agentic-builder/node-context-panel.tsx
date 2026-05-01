export function NodeContextPanel({
  nodeId,
  onRegenerate,
}: {
  readonly nodeId: string;
  readonly onRegenerate: (nodeId: string) => void;
}) {
  return (
    <aside className="rounded-lg border p-3">
      <h2 className="font-medium">Node actions</h2>
      <button
        className="mt-2 rounded border px-2 py-1"
        onClick={() => onRegenerate(nodeId)}
        type="button"
      >
        Regenerate after node
      </button>
    </aside>
  );
}
