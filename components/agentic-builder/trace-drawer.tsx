import type { BuilderEvent } from "@keeperhub/agentic-builder/schemas";

export function TraceDrawer({
  events,
}: {
  readonly events: readonly BuilderEvent[];
}) {
  return (
    <section className="rounded-lg border p-3">
      <h2 className="font-medium">Trace</h2>
      {events.map((event) => (
        <p className="text-xs" key={event.id}>
          {event.eventKind}: {event.stage}
        </p>
      ))}
    </section>
  );
}
