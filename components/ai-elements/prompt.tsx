"use client";

import { ArrowUp, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { DecisionTray } from "@/components/agentic-builder/decision-tray";
import { useAgenticBuilder } from "@/components/agentic-builder/use-agentic-builder";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const PROMPT_HISTORY_STORAGE_KEY = "keeperhub.workflowPromptHistory";
const MAX_PROMPT_HISTORY_ITEMS = 50;

type AIPromptProps = {
  workflowId?: string;
};

export function AIPrompt({ workflowId }: AIPromptProps) {
  const {
    answerBuilderQuestion,
    builderProjection,
    isGenerating,
    pendingBuilderActionId,
    pinBuilderPreview,
    planningStatusItems,
    rejectBuilderOption,
    requestNativeCapability,
    selectBuilderOption,
    setHighlightedOptionId,
    startBuilderPlanning,
  } = useAgenticBuilder({ workflowId });
  const [prompt, setPrompt] = useState("");
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const historyDraftRef = useRef("");

  const resizePromptInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      if (!inputRef.current) {
        return;
      }
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    });
  }, []);

  const savePromptHistory = useCallback((history: string[]) => {
    setPromptHistory(history);
    try {
      localStorage.setItem(PROMPT_HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      toast.error("Failed to save prompt history");
    }
  }, []);

  useEffect(() => {
    setPrompt("");
    setHistoryIndex(null);
    historyDraftRef.current = "";
  }, [workflowId]);

  // Focus input when Cmd/Ctrl + K is pressed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem(PROMPT_HISTORY_STORAGE_KEY);
      if (!storedHistory) {
        return;
      }
      const parsedHistory: unknown = JSON.parse(storedHistory);
      if (Array.isArray(parsedHistory)) {
        setPromptHistory(
          parsedHistory
            .filter((item): item is string => typeof item === "string")
            .slice(-MAX_PROMPT_HISTORY_ITEMS)
        );
      }
    } catch {
      setPromptHistory([]);
    }
  }, []);

  const addPromptToHistory = useCallback(
    (submittedPrompt: string) => {
      savePromptHistory(
        promptHistory.at(-1) === submittedPrompt
          ? promptHistory
          : [...promptHistory, submittedPrompt].slice(-MAX_PROMPT_HISTORY_ITEMS)
      );
      setHistoryIndex(null);
      historyDraftRef.current = "";
    },
    [promptHistory, savePromptHistory]
  );

  const handlePromptHistoryKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (promptHistory.length === 0 || e.altKey || e.ctrlKey || e.metaKey) {
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        const nextIndex =
          historyIndex === null
            ? promptHistory.length - 1
            : Math.max(0, historyIndex - 1);
        if (historyIndex === null) {
          historyDraftRef.current = prompt;
        }
        setHistoryIndex(nextIndex);
        setPrompt(promptHistory[nextIndex]);
        resizePromptInput();
        return;
      }

      if (e.key === "ArrowDown" && historyIndex !== null) {
        e.preventDefault();
        if (historyIndex < promptHistory.length - 1) {
          const nextIndex = historyIndex + 1;
          setHistoryIndex(nextIndex);
          setPrompt(promptHistory[nextIndex]);
        } else {
          setHistoryIndex(null);
          setPrompt(historyDraftRef.current);
          historyDraftRef.current = "";
        }
        resizePromptInput();
      }
    },
    [historyIndex, prompt, promptHistory, resizePromptInput]
  );

  const clearPromptHistory = useCallback(() => {
    savePromptHistory([]);
    setHistoryIndex(null);
    historyDraftRef.current = "";
    toast.success("History cleared");
    inputRef.current?.focus();
  }, [savePromptHistory]);

  const handleFocus = () => {
    setIsExpanded(true);
    setIsFocused(true);
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Don't collapse if focus is moving to another element within the container
    if (containerRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    setIsFocused(false);
    if (!prompt.trim()) {
      setIsExpanded(false);
    }
  };

  const handleGenerate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!prompt.trim() || isGenerating) {
        return;
      }

      const submittedPrompt = prompt.trim();
      addPromptToHistory(submittedPrompt);

      try {
        await startBuilderPlanning(submittedPrompt);
        setPrompt("");
        setIsExpanded(false);
        setIsFocused(false);
        inputRef.current?.blur();
      } catch (error) {
        console.error("Failed to generate workflow:", error);
        window.dispatchEvent(
          new CustomEvent("keeperhub:trace-error", {
            detail: {
              attributes: {
                prompt,
                workflowId,
              },
              errorName: error instanceof Error ? error.name : "WorkflowPromptError",
              label: "AI workflow generation failed",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to generate workflow",
              step: "ai.workflow-prompt.generate",
            },
          })
        );
        toast.error("Failed to generate workflow");
      }
    },
    [addPromptToHistory, isGenerating, prompt, startBuilderPlanning, workflowId]
  );

  return (
    <>
      {/* Always visible prompt input */}
      <div
        ref={containerRef}
        className="pointer-events-none absolute bottom-[calc(1rem+var(--trace-widget-docked-offset,0px))] left-1/2 z-10 -translate-x-1/2 px-4"
        style={{
          width:
            isExpanded || builderProjection ? "min(100%, 48rem)" : "20rem",
          transition: "width 150ms ease-out",
        }}
      >
        <DecisionTray
          isPlanning={isGenerating}
          onAnswerQuestion={answerBuilderQuestion}
          onPreviewFocus={setHighlightedOptionId}
          onPreviewPin={pinBuilderPreview}
          onReject={rejectBuilderOption}
          onRequestNativeCapability={requestNativeCapability}
          onSelect={selectBuilderOption}
          pendingActionId={pendingBuilderActionId}
          planningStatusItems={planningStatusItems}
          projection={builderProjection}
        />
        <form
          aria-busy={isGenerating}
          aria-label="KeeperHub workflow prompt"
          className="pointer-events-auto relative flex cursor-text items-center gap-2 rounded-lg border bg-background py-2 pr-2 pl-3 shadow-lg"
          onClick={(e) => {
            // Focus textarea when clicking anywhere in the form (including padding)
            if (e.target === e.currentTarget || (e.target as HTMLElement).tagName !== 'BUTTON') {
              inputRef.current?.focus();
            }
          }}
          onMouseDown={(e) => {
            // Prevent textarea from losing focus when clicking form padding
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
          onSubmit={handleGenerate}
          role="search"
        >
          {isGenerating && prompt ? (
            <Shimmer className="flex-1 text-sm whitespace-pre-wrap" duration={2}>
              {prompt}
            </Shimmer>
          ) : (
            <textarea
              aria-label="Describe your workflow"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground resize-none h-[22px] min-h-[22px] max-h-[200px] py-0 leading-[22px]"
              disabled={isGenerating}
              onBlur={handleBlur}
              onChange={(e) => {
                setPrompt(e.target.value);
                setHistoryIndex(null);
                historyDraftRef.current = e.target.value;
                e.target.style.height = 'auto';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onFocus={handleFocus}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setPrompt("");
                  setIsExpanded(false);
                  setIsFocused(false);
                  inputRef.current?.blur();
                } else {
                  handlePromptHistoryKeyDown(e);
                }
              }}
              placeholder={isFocused ? "Describe the workflow plan..." : "Start planning..."}
              ref={inputRef}
              rows={1}
              value={prompt}
            />
          )}
          <div className="sr-only">
            {isGenerating ? "Generating workflow, please wait..." : ""}
          </div>
          <div className="flex shrink-0 items-end gap-1 self-end">
            <div className="relative size-8 shrink-0">
              <Button
                aria-label="Focus prompt input (⌘K)"
                className="absolute inset-0 h-8 px-0 text-xs text-muted-foreground hover:bg-transparent transition-[opacity,filter] ease-out"
                onClick={() => inputRef.current?.focus()}
                style={
                  !prompt.trim() && !isGenerating && !isFocused
                    ? { opacity: 1, filter: "blur(0px)", pointerEvents: "auto", visibility: "visible" }
                    : { opacity: 0, filter: "blur(2px)", pointerEvents: "none", visibility: "hidden" }
                }
                type="button"
                variant="ghost"
              >
                <kbd aria-hidden="true" className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </Button>
              <Button
                aria-label={isGenerating ? "Planning workflow..." : "Start planning"}
                className="size-8 transition-[opacity,filter] ease-out shrink-0"
                disabled={!prompt.trim() || isGenerating}
                size="sm"
                style={
                  !prompt.trim() && !isGenerating && !isFocused
                    ? { opacity: 0, filter: "blur(2px)", pointerEvents: "none", visibility: "hidden" }
                    : { opacity: 1, filter: "blur(0px)", pointerEvents: "auto", visibility: "visible" }
                }
                type="submit"
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </Button>
            </div>
            {promptHistory.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Clear prompt history"
                    className="size-8 text-muted-foreground transition-[opacity,filter] ease-out shrink-0"
                    onClick={clearPromptHistory}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear prompt history</TooltipContent>
              </Tooltip>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
