"use client";

import { Check, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  BuilderPreviewBranch,
  BuilderProjection,
  BuilderProjectionIssue,
} from "@/lib/agentic-builder/projection/contracts";

export type DecisionTrayProps = {
  projection: BuilderProjection | null;
  isPlanning?: boolean;
  onHighlightBranch?: (input: { branchId: string; optionId?: string }) => void;
  onClearHighlight?: () => void;
  onSelectOption?: (optionId: string) => void;
  onRejectOption?: (optionId: string) => void;
  onAnswerQuestion?: (input: { questionId: string; answer: string }) => void;
  onRequestNativeFeature?: (customProposalId: string) => void;
};

export function DecisionTray({
  projection,
  isPlanning = false,
  onHighlightBranch,
  onClearHighlight,
  onSelectOption,
  onRejectOption,
  onAnswerQuestion,
  onRequestNativeFeature,
}: DecisionTrayProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const shouldRender =
    isPlanning ||
    Boolean(
      projection &&
        (projection.branches.length > 0 ||
          projection.questions.length > 0 ||
          projection.validationIssues.length > 0 ||
          projection.evaluation.customNodeProposals.length > 0)
    );

  if (!shouldRender) {
    return null;
  }

  const recommendedOptionId = projection?.branches[0]?.optionId;

  return (
    <section
      aria-label="Builder decisions"
      className="mb-2 w-full rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur"
      data-testid="builder-decision-tray"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Sparkles className="size-4 text-muted-foreground" />
          <span>Suggested next step</span>
        </div>
        {isPlanning && (
          <span
            className="rounded border px-2 py-0.5 text-muted-foreground text-xs"
            data-testid="builder-planning-badge"
          >
            Planning
          </span>
        )}
      </div>

      {projection?.branches.map((branch, index) => (
        <OptionRow
          branch={branch}
          index={index}
          isRecommended={branch.optionId === recommendedOptionId}
          key={branch.id}
          onClearHighlight={onClearHighlight}
          onHighlightBranch={onHighlightBranch}
          onRejectOption={onRejectOption}
          onSelectOption={onSelectOption}
        />
      ))}

      {projection?.questions.map((question) => {
        const value = answers[question.id] ?? question.answer ?? "";
        return (
          <form
            className="mt-2 grid gap-2 rounded-md border border-dashed p-2"
            data-testid={`builder-question-${question.id}`}
            key={question.id}
            onSubmit={(event) => {
              event.preventDefault();
              onAnswerQuestion?.({ questionId: question.id, answer: value });
            }}
          >
            <label className="font-medium text-sm" htmlFor={`answer-${question.id}`}>
              {question.question}
            </label>
            <div className="flex gap-2">
              <Input
                id={`answer-${question.id}`}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                  }))
                }
                value={value}
              />
              <Button disabled={!value.trim()} size="sm" type="submit">
                Answer
              </Button>
            </div>
          </form>
        );
      })}

      {projection?.evaluation.customNodeProposals.map((proposal) => (
        <div
          className="mt-2 rounded-md border border-dashed p-2 text-sm"
          data-testid={`builder-custom-proposal-${proposal.id}`}
          key={proposal.id}
        >
          <div className="font-medium">{proposal.title}</div>
          <div className="text-muted-foreground text-xs">{proposal.summary}</div>
          {proposal.requestNativeFeatureAction && (
            <Button
              className="mt-2"
              onClick={() => onRequestNativeFeature?.(proposal.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              Request native feature
            </Button>
          )}
        </div>
      ))}

      {projection?.validationIssues.map((issue) => (
        <IssueRow issue={issue} key={issue.id} />
      ))}
    </section>
  );
}

function OptionRow({
  branch,
  index,
  isRecommended,
  onHighlightBranch,
  onClearHighlight,
  onSelectOption,
  onRejectOption,
}: {
  branch: BuilderPreviewBranch;
  index: number;
  isRecommended: boolean;
  onHighlightBranch?: (input: { branchId: string; optionId?: string }) => void;
  onClearHighlight?: () => void;
  onSelectOption?: (optionId: string) => void;
  onRejectOption?: (optionId: string) => void;
}) {
  const optionId = branch.optionId ?? branch.id;
  const highlightInput = { branchId: branch.id, optionId: branch.optionId };

  return (
    <div
      className="mt-2 rounded-md border p-2 outline-none transition-colors focus-within:border-primary hover:border-primary"
      data-builder-branch-id={branch.id}
      data-builder-option-id={branch.optionId}
      data-testid={`builder-option-${optionId}`}
      onBlur={onClearHighlight}
      onFocus={() => onHighlightBranch?.(highlightInput)}
      onMouseEnter={() => onHighlightBranch?.(highlightInput)}
      onMouseLeave={onClearHighlight}
      tabIndex={0}
    >
      <div className="flex items-start gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded border text-xs">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{branch.title}</span>
            {isRecommended && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary text-xs">
                Recommended
              </span>
            )}
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-xs",
                branch.risk === "high" && "border-destructive text-destructive"
              )}
            >
              {branch.risk} risk
            </span>
          </div>
          {branch.rationale && (
            <p className="mt-1 text-muted-foreground text-xs">{branch.rationale}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            aria-label={`Select ${branch.title}`}
            onClick={() => onSelectOption?.(optionId)}
            size="icon-sm"
            type="button"
          >
            <Check className="size-4" />
          </Button>
          <Button
            aria-label={`Reject ${branch.title}`}
            onClick={() => onRejectOption?.(optionId)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: BuilderProjectionIssue }) {
  return (
    <div
      className={cn(
        "mt-2 rounded-md border p-2 text-sm",
        issue.severity === "error" && "border-destructive text-destructive"
      )}
      data-testid={`builder-issue-${issue.id}`}
    >
      <div className="font-medium capitalize">{issue.severity}</div>
      <div className="text-xs">{issue.message}</div>
    </div>
  );
}
