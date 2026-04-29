import { AsyncLocalStorage } from "node:async_hooks";
import type { TraceContext, TraceContextProvider } from "./contracts";

export function createAsyncLocalTraceContextProvider(): TraceContextProvider {
  const storage = new AsyncLocalStorage<TraceContext>();

  return {
    get() {
      return storage.getStore() ?? null;
    },

    run<T>(context: TraceContext, callback: () => T) {
      return storage.run(context, callback);
    },
  };
}
