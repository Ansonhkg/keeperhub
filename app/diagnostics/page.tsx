import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DiagnosticsPageClient } from "@/components/diagnostics/diagnostics-page-client";
import { isTraceEnabled } from "@/lib/trace/feature-flag";

export default function DiagnosticsRoute() {
  if (!isTraceEnabled()) {
    notFound();
  }

  return (
    <Suspense
      fallback={
        <main className="pointer-events-auto h-dvh overflow-y-auto bg-background px-4 py-6 md:px-8">
          <div className="mx-auto max-w-7xl rounded-lg border border-dashed p-8 text-muted-foreground text-sm">
            Loading diagnostics.
          </div>
        </main>
      }
    >
      <DiagnosticsPageClient />
    </Suspense>
  );
}
