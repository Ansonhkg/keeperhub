import {
  createAsyncLocalTraceContextProvider,
  createInMemoryTraceEventBus,
  createTracePropagationProvider,
  createTraceRecorder,
  type TraceContextProvider,
  type TraceEventBus,
  type TracePropagationProvider,
  type TraceRecorder,
  type TraceStore,
} from "@keeperhub/trace-sdk/server";
import { DrizzleTraceStore } from "./drizzle-trace-store";

export type KeeperTraceProviders = {
  store: TraceStore;
  contextProvider: TraceContextProvider;
  eventBus: TraceEventBus;
  propagationProvider: TracePropagationProvider;
  recorder: TraceRecorder;
};

export type KeeperTraceProviderOverrides = Partial<
  Pick<
    KeeperTraceProviders,
    "contextProvider" | "eventBus" | "propagationProvider" | "store"
  >
>;

let sharedProviders: KeeperTraceProviders | null = null;

export function createKeeperTraceProviders(
  overrides: KeeperTraceProviderOverrides = {}
): KeeperTraceProviders {
  const store = overrides.store ?? new DrizzleTraceStore();
  const contextProvider =
    overrides.contextProvider ?? createAsyncLocalTraceContextProvider();
  const eventBus = overrides.eventBus ?? createInMemoryTraceEventBus();
  const propagationProvider =
    overrides.propagationProvider ?? createTracePropagationProvider();
  const recorder = createTraceRecorder({ contextProvider, eventBus, store });

  return {
    contextProvider,
    eventBus,
    propagationProvider,
    recorder,
    store,
  };
}

export function getKeeperTraceProviders() {
  sharedProviders ??= createKeeperTraceProviders();
  return sharedProviders;
}

export function resetKeeperTraceProvidersForTests() {
  sharedProviders = null;
}
