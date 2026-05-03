"use client";

import type {
  BuilderOption,
  BuilderProjection,
  IntentStep,
  OpenQuestion,
} from "@keeperhub/agentic-builder/schemas";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type DecisionTrayProps = {
  readonly isPlanning: boolean;
  readonly pendingActionId?: string | null;
  readonly planningStatusItems?: readonly PlanningStatusItem[];
  readonly projection: BuilderProjection | null;
  readonly onAnswerQuestion: (questionId: string, answer: string) => void;
  readonly onPreviewFocus: (optionId: string | null) => void;
  readonly onPreviewPin: (optionId: string) => void;
  readonly onReject: (optionId: string) => void;
  readonly onRequestNativeCapability: () => void;
  readonly onSelect: (optionId: string) => void;
};

export type PlanningStatusItem = {
  readonly detail?: string;
  readonly id: string;
  readonly label: string;
  readonly status: "running" | "completed";
};

type VisibleOptionGroup = {
  readonly id: string;
  readonly label: string;
  readonly options: BuilderOption[];
  readonly subtitle?: string;
  readonly step?: IntentStep;
};

function optionText(option: BuilderOption): string {
  return `${option.title} ${option.rationale}`.toLowerCase();
}

function semanticGroupId(
  option: BuilderOption,
  step: IntentStep | undefined
): string | undefined {
  const text = optionText(option);
  const title = option.title.toLowerCase();
  const isKeepExisting =
    text.includes("keep existing") ||
    text.includes("preserve") ||
    text.includes("finalize") ||
    text.includes("branch only");
  const mentionsPrice =
    text.includes("price") ||
    text.includes("chronicle") ||
    text.includes("chainlink") ||
    text.includes("oracle") ||
    text.includes("feed");
  const mentionsNotification =
    text.includes("telegram") ||
    text.includes("slack") ||
    text.includes("email") ||
    text.includes("discord") ||
    text.includes("webhook") ||
    text.includes("notification") ||
    text.includes("alert");
  const mentionsNormalization =
    text.includes("decimal") ||
    text.includes("normalize") ||
    text.includes("format");

  if (isKeepExisting) {
    return "semantic-keep";
  }
  const isNotificationActionTitle =
    /^(?:send|notify|post|deliver)\b/.test(title) ||
    /\b(?:telegram|slack|email|discord|webhook)\s+(?:message|notification|alert)\b/.test(
      title
    ) ||
    /\b(?:message|notification|alert)\s+(?:via|on|to)\s+(?:telegram|slack|email|discord|webhook)\b/.test(
      title
    );
  if (isNotificationActionTitle) {
    return "semantic-notification";
  }
  if (text.includes("log") || text.includes("not-exceeded")) {
    return "semantic-log";
  }
  if (mentionsNormalization) {
    return "semantic-price-normalization";
  }
  if (step?.kind === "read" || mentionsPrice) {
    return "semantic-price";
  }
  if (
    text.includes("loop") ||
    text.includes("repeat") ||
    text.includes("5-second") ||
    text.includes("5 second") ||
    text.includes("30-second") ||
    text.includes("30 second")
  ) {
    return "semantic-loop";
  }
  if (step?.kind === "notify" || mentionsNotification) {
    return "semantic-notification";
  }
  if (step?.kind === "condition") {
    return "semantic-condition";
  }
  return undefined;
}

function optionGroupLabel(
  groupId: string,
  step: IntentStep | undefined,
  options: readonly BuilderOption[]
): string {
  const hasAlternatives = options.length > 1;
  const combinedTitle = options
    .map((option) => option.title)
    .join(" ")
    .toLowerCase();

  if (groupId === "semantic-price") {
    return hasAlternatives ? "Choose price source" : "Add price read";
  }
  if (groupId === "semantic-price-normalization") {
    return "Add price normalization";
  }
  if (groupId === "semantic-notification") {
    return hasAlternatives
      ? "Choose notification action"
      : "Add notification step";
  }
  if (groupId === "semantic-keep") {
    return "Keep existing branch";
  }
  if (groupId === "semantic-log") {
    return "Add logging step";
  }
  if (groupId === "semantic-loop") {
    return "Add polling loop";
  }
  if (groupId === "semantic-condition") {
    return "Configure condition";
  }

  if (hasAlternatives) {
    if (step?.kind === "read" || combinedTitle.includes("price")) {
      return "Choose price source";
    }
    if (step?.kind === "notify") {
      return "Choose notification action";
    }
    if (step?.kind === "write") {
      return "Choose transaction action";
    }
    return "Choose implementation";
  }

  if (step?.kind === "notify" || combinedTitle.includes("telegram")) {
    return "Add notification step";
  }
  if (step?.kind === "read" || combinedTitle.includes("price")) {
    return "Add price read";
  }
  if (step?.kind === "condition") {
    return "Configure condition";
  }
  if (step?.kind === "write") {
    return "Add transaction step";
  }
  return "Add next step";
}

function optionGroupSubtitle(
  groupId: string,
  step: IntentStep | undefined
): string | undefined {
  if (groupId === "semantic-price") {
    return "Select the feed or read action for the requested market price.";
  }
  if (groupId === "semantic-price-normalization") {
    return "Add oracle output formatting only when the workflow needs it.";
  }
  if (groupId === "semantic-notification") {
    return "Choose how the threshold branch should notify the user.";
  }
  if (groupId === "semantic-keep") {
    return "Leave an already materialized branch unchanged.";
  }
  if (groupId === "semantic-log") {
    return "Handle the false branch when the threshold is not met.";
  }
  if (groupId === "semantic-loop") {
    return "Run repeated checks for the requested time window.";
  }
  if (groupId === "semantic-condition") {
    return "Configure the comparison the workflow should evaluate.";
  }
  return step?.label;
}

function displayOptionTitle(groupId: string, option: BuilderOption): string {
  if (groupId !== "semantic-price") {
    return option.title;
  }

  const title = option.title
    .replace(
      /\s+(?:with|and)\s+(?:telegram|slack|email|discord|webhook)\s+(?:alerts?|alerting|notifications?).*$/i,
      ""
    )
    .replace(/\s*,?\s*then\s+notify.*$/i, "")
    .trim();

  if (title === option.title || /price source/i.test(title)) {
    return title;
  }
  return `${title} as the price source`;
}

function optionCountLabel(count: number): string {
  return `${count} ${count === 1 ? "option" : "options"}`;
}

function normalizedTextKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function optionDeduplicationKey(
  groupId: string,
  option: BuilderOption
): string {
  const text = normalizedTextKey(
    `${option.title} ${option.rationale} ${option.candidateIds.join(" ")}`
  );

  if (groupId === "semantic-price") {
    if (
      text.includes("chronicle") &&
      /\b(age|freshness|timestamp)\b/.test(text)
    ) {
      return "price:chronicle-with-age";
    }
    if (text.includes("chronicle")) {
      return "price:chronicle-read";
    }
    if (text.includes("chainlink") && text.includes("decimal")) {
      return "price:chainlink-decimals";
    }
    if (text.includes("chainlink") && text.includes("description")) {
      return "price:chainlink-description";
    }
    if (
      text.includes("chainlink") &&
      /\b(latest|round|answer|timestamp)\b/.test(text)
    ) {
      return "price:chainlink-latest-round";
    }
    if (text.includes("chainlink")) {
      return "price:chainlink";
    }
  }

  if (groupId === "semantic-notification") {
    for (const channel of [
      "webhook",
      "telegram",
      "slack",
      "email",
      "discord",
      "sendgrid",
    ]) {
      if (text.includes(channel)) {
        return `notification:${channel}`;
      }
    }
  }

  if (option.candidateIds.length > 0) {
    return `candidates:${option.candidateIds
      .map((candidateId) =>
        candidateId.replace(/^(native|protocol|system|generated)-/, "")
      )
      .sort()
      .join("|")}`;
  }

  return `title:${normalizedTextKey(displayOptionTitle(groupId, option))}`;
}

function dedupeOptionsForGroup(
  groupId: string,
  options: readonly BuilderOption[]
): BuilderOption[] {
  const optionsByKey = new Map<string, BuilderOption>();
  const order: string[] = [];

  for (const option of options) {
    const key = optionDeduplicationKey(groupId, option);
    const existing = optionsByKey.get(key);
    if (!existing) {
      optionsByKey.set(key, option);
      order.push(key);
      continue;
    }
    if (option.confidence > existing.confidence) {
      optionsByKey.set(key, option);
    }
  }

  return order.flatMap((key) => {
    const option = optionsByKey.get(key);
    return option ? [option] : [];
  });
}

function groupVisibleOptions(
  projection: BuilderProjection | null,
  visibleOptions: readonly BuilderOption[]
): VisibleOptionGroup[] {
  if (!projection) {
    return [];
  }
  const stepById = new Map(
    projection.committed.nodes.map((step) => [step.id, step])
  );
  const groupById = new Map<string, BuilderOption[]>();
  const orderById = new Map<string, number>();
  visibleOptions.forEach((option, index) => {
    const step = stepById.get(option.stepId);
    const id =
      semanticGroupId(option, step) ?? option.decisionGroupId ?? option.stepId;
    groupById.set(id, [...(groupById.get(id) ?? []), option]);
    if (!orderById.has(id)) {
      orderById.set(id, index);
    }
  });

  return [...groupById.entries()]
    .sort(
      ([leftId], [rightId]) =>
        (orderById.get(leftId) ?? 0) - (orderById.get(rightId) ?? 0)
    )
    .map(([id, options]) => {
      const dedupedOptions = dedupeOptionsForGroup(id, options);
      const step = stepById.get(options[0]?.stepId ?? "");
      return {
        id,
        label: optionGroupLabel(id, step, dedupedOptions),
        options: dedupedOptions,
        subtitle: optionGroupSubtitle(id, step),
        step,
      };
    });
}

function QuestionControl({
  onAnswerQuestion,
  pendingActionId,
  question,
}: {
  readonly question: OpenQuestion;
  readonly onAnswerQuestion: (questionId: string, answer: string) => void;
  readonly pendingActionId?: string | null;
}) {
  const [answer, setAnswer] = useState("");
  const isAnyPending = Boolean(pendingActionId);

  if (question.status !== "open") {
    return null;
  }

  if (question.answerType === "single_choice" && question.choices) {
    return (
      <div className="flex min-w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5">
        <span className="max-w-72 truncate text-sm">{question.prompt}</span>
        {question.choices.map((choice) => (
          <Button
            className="h-7 px-2"
            disabled={isAnyPending}
            key={choice}
            onClick={() => onAnswerQuestion(question.id, choice)}
            size="sm"
            type="button"
            variant="outline"
          >
            {pendingActionId === `answer:${question.id}:${choice}` ? (
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            ) : null}
            {choice}
          </Button>
        ))}
      </div>
    );
  }

  const submitAnswer = () => {
    const trimmed = answer.trim();
    if (!trimmed) {
      return;
    }
    onAnswerQuestion(question.id, trimmed);
    setAnswer("");
  };

  return (
    <div className="flex min-w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5">
      <span className="max-w-72 truncate text-sm">{question.prompt}</span>
      <Input
        aria-label={`Answer: ${question.prompt}`}
        className="h-7 w-36"
        disabled={isAnyPending}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") {
            return;
          }
          event.preventDefault();
          submitAnswer();
        }}
        value={answer}
      />
      <Button
        className="h-7 px-2"
        disabled={isAnyPending}
        onClick={submitAnswer}
        size="sm"
        type="button"
      >
        {pendingActionId === `answer:${question.id}:${answer.trim()}` ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <Check aria-hidden="true" className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

export function DecisionTray({
  isPlanning,
  pendingActionId,
  planningStatusItems = [],
  projection,
  onAnswerQuestion,
  onPreviewFocus,
  onPreviewPin,
  onReject,
  onRequestNativeCapability,
  onSelect,
}: DecisionTrayProps) {
  const [pinnedPreviewOptionId, setPinnedPreviewOptionId] = useState<
    string | null
  >(null);
  const openQuestions =
    projection?.questions.filter((question) => question.status === "open") ??
    [];
  const validationIssues = projection?.validation.issues ?? [];
  const isAnyPending = Boolean(pendingActionId);
  const openOptionIds = new Set(
    projection?.candidateBranches
      .filter((branch) => branch.status === "open")
      .map((branch) => branch.optionId) ?? []
  );
  const visibleOptions =
    projection?.options.filter((option) => openOptionIds.has(option.id)) ?? [];
  const visibleOptionGroups = groupVisibleOptions(projection, visibleOptions);
  const [activeGroupId, setActiveGroupId] = useState<string | undefined>(
    visibleOptionGroups[0]?.id
  );
  const hasMissingCapability =
    Boolean(
      projection?.committed.nodes.some(
        (node) => node.kind === "missing_capability"
      ) ||
        projection?.candidateBranches.some((branch) =>
          branch.greyNodes.some((node) => node.kind === "missing_capability")
        )
    ) &&
    visibleOptions.length === 0 &&
    openQuestions.length === 0;
  const recommendedOptionIds = new Set(
    visibleOptionGroups.flatMap((group) => {
      if (group.options.length < 2) {
        return [];
      }
      const recommended = group.options.reduce<BuilderOption | null>(
        (current, option) =>
          !current || option.confidence > current.confidence ? option : current,
        null
      );
      return recommended ? [recommended.id] : [];
    })
  );
  const shouldRender =
    isPlanning ||
    visibleOptions.length > 0 ||
    openQuestions.length > 0 ||
    hasMissingCapability ||
    validationIssues.length > 0;

  const clearPinnedPreview = () => {
    setPinnedPreviewOptionId(null);
    onPreviewFocus(null);
  };

  const pinPreview = (optionId: string) => {
    setPinnedPreviewOptionId(optionId);
    onPreviewPin(optionId);
  };
  const defaultOptionForGroup = (
    groupId: string
  ): BuilderOption | undefined => {
    const group = visibleOptionGroups.find((item) => item.id === groupId);
    return group?.options.reduce<BuilderOption | undefined>(
      (current, option) =>
        !current || option.confidence > current.confidence ? option : current,
      undefined
    );
  };
  const focusGroupPreview = (groupId: string) => {
    setActiveGroupId(groupId);
    const option = defaultOptionForGroup(groupId);
    if (option) {
      setPinnedPreviewOptionId(option.id);
      onPreviewPin(option.id);
    }
  };

  useEffect(() => {
    if (
      visibleOptionGroups.length === 0 ||
      visibleOptionGroups.some((group) => group.id === activeGroupId)
    ) {
      return;
    }
    setActiveGroupId(visibleOptionGroups[0]?.id);
  }, [activeGroupId, visibleOptionGroups]);

  if (!shouldRender) {
    return null;
  }

  return (
    <section
      aria-label="Builder decisions"
      className="pointer-events-auto mb-2 flex max-h-[min(72vh,36rem)] w-full flex-col overflow-hidden rounded-lg border bg-background/95 shadow-lg backdrop-blur"
      data-testid="builder-decision-tray"
    >
      <div className="flex min-h-9 items-center justify-between border-b px-3">
        <span className="font-medium text-muted-foreground text-xs">
          Builder decisions
        </span>
        {isPlanning ? (
          <Badge className="h-6 gap-1.5" variant="secondary">
            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            Planning
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-col gap-0 overflow-y-auto p-3">
        {isPlanning ? (
          <div className="flex flex-col gap-2 pb-3">
            {(planningStatusItems.length > 0
              ? planningStatusItems
              : [
                  {
                    id: "planning",
                    label: "Starting builder planning",
                    status: "running" as const,
                  },
                ]
            ).map((item) => (
              <div
                className={cn(
                  "flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs",
                  item.status === "running"
                    ? "border-primary/40 bg-primary/5 text-foreground"
                    : "border-border/70 bg-muted/30 text-muted-foreground"
                )}
                data-testid={`builder-planning-status-${item.id}`}
                key={item.id}
              >
                {item.status === "running" ? (
                  <Loader2
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary"
                  />
                ) : (
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-primary"
                  />
                )}
                <div className="min-w-0">
                  <div className="truncate font-medium">{item.label}</div>
                  {item.detail ? (
                    <div className="truncate text-muted-foreground">
                      {item.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {visibleOptionGroups.length > 0 ? (
          <Tabs
            className="gap-3"
            onValueChange={focusGroupPreview}
            value={activeGroupId ?? visibleOptionGroups[0]?.id}
          >
            <TabsList className="h-9 w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0">
              {visibleOptionGroups.map((group) => (
                <TabsTrigger
                  className="h-9 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  data-testid={`builder-option-tab-${group.id}`}
                  key={group.id}
                  onClick={() => focusGroupPreview(group.id)}
                  onFocus={() => focusGroupPreview(group.id)}
                  value={group.id}
                >
                  {group.label}
                  <Badge className="h-5 px-1.5 text-[10px]" variant="outline">
                    {optionCountLabel(group.options.length)}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
            {visibleOptionGroups.map((group) => (
              <TabsContent
                className="m-0 flex min-w-full flex-col gap-2"
                data-testid={`builder-option-group-${group.id}`}
                key={group.id}
                value={group.id}
              >
                <div className="px-1">
                  <div className="font-medium text-foreground text-xs">
                    {group.label}
                  </div>
                  {group.subtitle ? (
                    <div className="truncate text-muted-foreground text-xs">
                      {group.subtitle}
                    </div>
                  ) : null}
                </div>
                {group.options.map((option, index) => {
                  const title = displayOptionTitle(group.id, option);
                  const isPinnedPreview = pinnedPreviewOptionId === option.id;
                  return (
                    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: the whole option row previews its matching canvas lane on hover/focus.
                    <fieldset
                      aria-label={`${group.label} option ${index + 1}: ${title}`}
                      className={cn(
                        "grid min-h-12 min-w-0 grid-cols-[1fr_auto] items-center gap-3 rounded-md border bg-background px-2 py-1.5 text-sm transition-colors",
                        "hover:border-primary/60 hover:bg-primary/5 focus-within:border-primary/60 focus-within:bg-primary/5 focus-visible:border-primary focus-visible:bg-primary/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                        isPinnedPreview &&
                          "border-primary/70 bg-primary/10 ring-1 ring-primary/40"
                      )}
                      data-testid={`builder-option-${option.id}`}
                      key={option.id}
                      onBlur={(event) => {
                        if (
                          !event.currentTarget.contains(
                            event.relatedTarget as Node | null
                          )
                        ) {
                          onPreviewFocus(pinnedPreviewOptionId);
                        }
                      }}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("button")) {
                          return;
                        }
                        pinPreview(option.id);
                      }}
                      onFocus={() => onPreviewFocus(option.id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) {
                          return;
                        }
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          pinPreview(option.id);
                        }
                      }}
                      onMouseEnter={() => onPreviewFocus(option.id)}
                      onMouseLeave={() => onPreviewFocus(pinnedPreviewOptionId)}
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard focus on the row previews the matching canvas lane before selecting a nested action.
                      tabIndex={0}
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5 font-medium">
                          <span className="shrink-0 text-muted-foreground">
                            {index + 1}.
                          </span>
                          <span className="truncate">{title}</span>
                        </div>
                        <div className="truncate text-muted-foreground text-xs">
                          {option.rationale}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {recommendedOptionIds.has(option.id) ? (
                          <Badge variant="secondary">Recommended</Badge>
                        ) : null}
                        <Badge
                          variant={
                            option.risk === "high" ? "destructive" : "outline"
                          }
                        >
                          {option.risk}
                        </Badge>
                        <Button
                          className="h-8 px-3"
                          disabled={isAnyPending}
                          onClick={() => {
                            clearPinnedPreview();
                            onSelect(option.id);
                          }}
                          size="sm"
                          type="button"
                        >
                          {pendingActionId === `select:${option.id}` ? (
                            <Loader2
                              aria-hidden="true"
                              className="size-3.5 animate-spin"
                            />
                          ) : null}
                          Select
                        </Button>
                        <Button
                          aria-label={`Reject ${title}`}
                          className="h-8 px-2"
                          disabled={isAnyPending}
                          onClick={() => {
                            clearPinnedPreview();
                            onReject(option.id);
                          }}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {pendingActionId === `reject:${option.id}` ? (
                            <Loader2
                              aria-hidden="true"
                              className="size-3.5 animate-spin"
                            />
                          ) : (
                            <X aria-hidden="true" className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    </fieldset>
                  );
                })}
              </TabsContent>
            ))}
          </Tabs>
        ) : null}
        {openQuestions.map((question) => (
          <QuestionControl
            key={question.id}
            onAnswerQuestion={onAnswerQuestion}
            pendingActionId={pendingActionId}
            question={question}
          />
        ))}
        {hasMissingCapability && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
            <AlertTriangle
              aria-hidden="true"
              className="size-4 text-amber-600"
            />
            <span className="text-sm">Missing native capability</span>
            <Button
              className="h-7 px-2"
              disabled={isAnyPending}
              onClick={onRequestNativeCapability}
              size="sm"
              type="button"
              variant="outline"
            >
              Request native node
            </Button>
          </div>
        )}
        {validationIssues.map((issue) => (
          <Badge
            key={`${issue.code}-${issue.targetId ?? "global"}`}
            variant={issue.severity === "error" ? "destructive" : "outline"}
          >
            {issue.message}
          </Badge>
        ))}
      </div>
    </section>
  );
}
