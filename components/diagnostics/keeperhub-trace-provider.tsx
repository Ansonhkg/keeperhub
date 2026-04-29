"use client";

import {
  type TraceReactAdapter,
  TraceReactAdapterProvider,
} from "@keeperhub/trace-sdk/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const KEEPERHUB_TRACE_ADAPTER: TraceReactAdapter = {
  Button,
  renderLink: ({ href, children, ...props }) => (
    <Link href={href ?? "/diagnostics"} {...props}>
      {children}
    </Link>
  ),
  toast: {
    error: (message) => toast.error(message),
    success: (message) => toast.success(message),
  },
};

export function KeeperHubTraceProvider({ children }: { children: ReactNode }) {
  return (
    <TraceReactAdapterProvider value={KEEPERHUB_TRACE_ADAPTER}>
      {children}
    </TraceReactAdapterProvider>
  );
}
