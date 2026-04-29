import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
} from "react";
import type { DiagnosticSpan } from "../types";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type TraceButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "ghost" | "outline";
  size?: "default" | "sm" | "icon";
};

export type TraceLinkRenderProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children?: ReactNode;
  "data-trace-ignore"?: boolean | string;
};

export type TraceToastAdapter = {
  success?: (message: string) => void;
  error?: (message: string) => void;
};

export type TraceUiHighlightHandle =
  | {
      clear?: () => void;
    }
  | (() => void)
  | undefined;

export type TraceUiHighlightAdapter = {
  resolveMatch?: (
    span: Pick<DiagnosticSpan, "attributes" | "step"> | null | undefined
  ) => unknown;
  createHighlight?: (match: unknown) => TraceUiHighlightHandle;
  clearHighlight?: () => void;
};

export type TraceReactAdapter = {
  Button?: ComponentType<TraceButtonProps>;
  renderLink?: (props: TraceLinkRenderProps) => ReactNode;
  toast?: TraceToastAdapter;
  uiHighlight?: TraceUiHighlightAdapter;
};

const DEFAULT_ADAPTER: TraceReactAdapter = {};
const TraceReactAdapterContext =
  createContext<TraceReactAdapter>(DEFAULT_ADAPTER);

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50";
const BUTTON_VARIANTS = {
  default: "bg-slate-950 text-white hover:bg-slate-800",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
  outline: "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
  secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
};
const BUTTON_SIZES = {
  default: "h-9 px-4",
  icon: "h-8 w-8",
  sm: "h-8 px-3 text-xs",
};

export function DefaultTraceButton({
  className,
  size = "default",
  type = "button",
  variant = "default",
  ...props
}: TraceButtonProps) {
  return (
    <button
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      type={type}
      {...props}
    />
  );
}

export function TraceReactAdapterProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: TraceReactAdapter;
}) {
  return (
    <TraceReactAdapterContext.Provider value={value ?? DEFAULT_ADAPTER}>
      {children}
    </TraceReactAdapterContext.Provider>
  );
}

export function useTraceReactAdapter() {
  return useContext(TraceReactAdapterContext);
}

export function useTraceButton() {
  return useTraceReactAdapter().Button ?? DefaultTraceButton;
}

export function useTraceLinkRenderer() {
  return useTraceReactAdapter().renderLink;
}
