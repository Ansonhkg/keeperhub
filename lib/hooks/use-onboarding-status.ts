"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient, useSession } from "@/lib/auth-client";

type GuideState = "expanded" | "collapsed" | "dismissed";

const GUIDE_KEY = "keeperhub-onboarding-guide";
const OLD_DISMISSED_KEY = "keeperhub-onboarding-dismissed";

function readGuideState(): GuideState {
  if (typeof window === "undefined") {
    return "expanded";
  }
  try {
    // Migrate old key if present
    const oldValue = localStorage.getItem(OLD_DISMISSED_KEY);
    if (oldValue === "true") {
      localStorage.removeItem(OLD_DISMISSED_KEY);
      localStorage.setItem(GUIDE_KEY, "collapsed");
      return "collapsed";
    }

    const value = localStorage.getItem(GUIDE_KEY);
    if (value === "collapsed" || value === "dismissed") {
      return value;
    }
    return "expanded";
  } catch {
    return "expanded";
  }
}

function persistGuideState(state: GuideState): void {
  try {
    if (state === "expanded") {
      localStorage.removeItem(GUIDE_KEY);
    } else {
      localStorage.setItem(GUIDE_KEY, state);
    }
  } catch {
    // localStorage unavailable
  }
}

export type OnboardingStep = {
  id: string;
  complete: boolean;
};

type OnboardingStatus = {
  steps: OnboardingStep[];
  isLoading: boolean;
  allComplete: boolean;
  completedCount: number;
  refetch: () => void;
  guideState: GuideState;
  collapse: () => void;
  expand: () => void;
  dismiss: () => void;
};

function isFulfilledArray(result: PromiseSettledResult<unknown>): boolean {
  return (
    result.status === "fulfilled" &&
    Array.isArray(result.value) &&
    (result.value as unknown[]).length > 0
  );
}

export function useOnboardingStatus(): OnboardingStatus {
  const { data: session } = useSession();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const activeOrgId = activeOrg?.id ?? null;
  const [steps, setSteps] = useState<OnboardingStep[]>([
    { id: "create-workflow", complete: false },
    { id: "generate-api-key", complete: false },
    { id: "create-wallet", complete: false },
  ]);
  const [isLoading, setIsLoading] = useState(true);
  const [guideState, setGuideState] = useState<GuideState>(readGuideState);
  const [refetchKey, setRefetchKey] = useState(0);

  const refetch = useCallback(() => {
    setRefetchKey((k) => k + 1);
  }, []);

  const isAuthenticated = Boolean(session?.user);

  const collapse = useCallback(() => {
    setGuideState("collapsed");
    persistGuideState("collapsed");
  }, []);

  const expand = useCallback(() => {
    setGuideState("expanded");
    persistGuideState("expanded");
  }, []);

  const dismiss = useCallback(() => {
    setGuideState("dismissed");
    persistGuideState("dismissed");
  }, []);

  useEffect(() => {
    if (!isAuthenticated || guideState === "dismissed") {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    setSteps([
      { id: "create-workflow", complete: false },
      { id: "generate-api-key", complete: false },
      { id: "create-wallet", complete: false },
    ]);

    async function fetchStatus(): Promise<void> {
      setIsLoading(true);

      const results = await Promise.allSettled([
        fetch("/api/workflows").then((r) => r.json()),
        fetch("/api/keys").then((r) => r.json()),
        fetch("/api/user/wallet").then((r) => r.json()),
      ]);

      if (cancelled) {
        return;
      }

      const [workflowsResult, keysResult, walletResult] = results;

      const hasWallet =
        walletResult.status === "fulfilled" &&
        (walletResult.value as { hasWallet?: boolean } | null)?.hasWallet ===
          true;

      setSteps([
        { id: "create-workflow", complete: isFulfilledArray(workflowsResult) },
        { id: "generate-api-key", complete: isFulfilledArray(keysResult) },
        { id: "create-wallet", complete: hasWallet },
      ]);
      setIsLoading(false);
    }

    fetchStatus();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, activeOrgId, refetchKey, guideState]);

  const completedCount = steps.filter((s) => s.complete).length;
  const allComplete = completedCount === steps.length;

  return {
    steps,
    isLoading,
    allComplete,
    completedCount,
    guideState,
    collapse,
    expand,
    dismiss,
    refetch,
  };
}
