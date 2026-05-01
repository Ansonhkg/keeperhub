export function MissingCapabilityCard({
  label,
  onRequest,
}: {
  readonly label: string;
  readonly onRequest: () => void;
}) {
  return (
    <article className="rounded-lg border p-3">
      <h3 className="font-medium">Missing capability</h3>
      <p className="text-muted-foreground text-sm">{label}</p>
      <button
        className="mt-2 rounded border px-2 py-1"
        onClick={onRequest}
        type="button"
      >
        Request native node
      </button>
    </article>
  );
}
