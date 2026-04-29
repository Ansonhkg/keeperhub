import type {
  TraceEventBus,
  TraceEventListener,
  TraceRecordEvent,
} from "./contracts";

export function createInMemoryTraceEventBus(): TraceEventBus {
  const listeners = new Map<string, Set<TraceEventListener>>();

  return {
    publish(event: TraceRecordEvent) {
      const runId = event.runId;
      if (!runId) {
        return;
      }

      for (const listener of listeners.get(runId) ?? []) {
        listener(event);
      }
    },

    subscribe(runId: string, listener: TraceEventListener) {
      const runListeners =
        listeners.get(runId) ?? new Set<TraceEventListener>();
      runListeners.add(listener);
      listeners.set(runId, runListeners);

      return () => {
        runListeners.delete(listener);
        if (!runListeners.size) {
          listeners.delete(runId);
        }
      };
    },
  };
}
