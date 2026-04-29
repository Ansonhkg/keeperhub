import { useEffect, useReducer } from "react";
import type { DiagnosticRun } from "../types";

export type DiagnosticRunStreamStatus =
  | "idle"
  | "live"
  | "reconnecting"
  | "stale"
  | "closed"
  | "error";

export type DiagnosticRunStreamState = {
  run: DiagnosticRun | null;
  status: DiagnosticRunStreamStatus;
  error: string | null;
  lastEventAt: string | null;
};

export type DiagnosticRunStreamAction =
  | { type: "connect" }
  | { type: "snapshot"; run: DiagnosticRun }
  | { type: "diagnostic"; run?: DiagnosticRun | null; eventAt?: string | null }
  | { type: "stale" }
  | { type: "reconnecting"; error?: string | null }
  | { type: "close" }
  | { type: "error"; error: string };

export const initialDiagnosticRunStreamState: DiagnosticRunStreamState = {
  error: null,
  lastEventAt: null,
  run: null,
  status: "idle",
};

export function reduceDiagnosticRunStreamState(
  state: DiagnosticRunStreamState,
  action: DiagnosticRunStreamAction
): DiagnosticRunStreamState {
  switch (action.type) {
    case "connect":
      return { ...state, error: null, status: "live" };
    case "snapshot":
      return {
        error: null,
        lastEventAt: new Date().toISOString(),
        run: action.run,
        status: "live",
      };
    case "diagnostic":
      return {
        ...state,
        error: null,
        lastEventAt: action.eventAt ?? new Date().toISOString(),
        run: action.run ?? state.run,
        status: "live",
      };
    case "stale":
      return { ...state, status: "stale" };
    case "reconnecting":
      return { ...state, error: action.error ?? null, status: "reconnecting" };
    case "close":
      return { ...state, status: "closed" };
    case "error":
      return { ...state, error: action.error, status: "error" };
    default:
      return state;
  }
}

type UseDiagnosticRunStreamOptions = {
  enabled?: boolean;
  initialRun?: DiagnosticRun | null;
  streamUrl?: string | null;
  staleAfterMs?: number;
};

export function useDiagnosticRunStream({
  enabled = true,
  initialRun = null,
  staleAfterMs = 30_000,
  streamUrl,
}: UseDiagnosticRunStreamOptions) {
  const [state, dispatch] = useReducer(reduceDiagnosticRunStreamState, {
    ...initialDiagnosticRunStreamState,
    run: initialRun,
  });

  useEffect(() => {
    if (!(enabled && streamUrl && typeof EventSource !== "undefined")) {
      return;
    }

    dispatch({ type: "connect" });
    const source = new EventSource(streamUrl);
    const staleTimer = setInterval(
      () => dispatch({ type: "stale" }),
      staleAfterMs
    );

    source.addEventListener("snapshot", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as {
        run?: DiagnosticRun;
      };
      if (parsed.run) {
        dispatch({ run: parsed.run, type: "snapshot" });
      }
    });
    source.addEventListener("diagnostic", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as {
        run?: DiagnosticRun | null;
        event?: { at?: string };
      };
      dispatch({
        eventAt: parsed.event?.at,
        run: parsed.run,
        type: "diagnostic",
      });
    });
    source.onerror = () => dispatch({ type: "reconnecting" });

    return () => {
      clearInterval(staleTimer);
      source.close();
      dispatch({ type: "close" });
    };
  }, [enabled, staleAfterMs, streamUrl]);

  return state;
}
