# Phase 2 Acceptance

## Done Means

- Phase 2 consumes typed `BuilderIntentDraft` data from Phase 1.
- The input draft includes typed `IntentRequirement` records.
- Requirement evaluation uses the generated requirement status vocabulary from Phase 1.
- Phase 2 domain vocabulary, connector semantics, and fallback policy are not duplicated inline in runtime code.
- Connector semantics are deterministic and covered by tests.
- `or` creates alternatives, not multiple committed steps.
- `and` creates multiple tasks or outputs.
- `about` treats the object as message/content subject unless another clause explicitly requires querying or using that provider.
- Semantic conditions are represented as structured requirements, not only labels.
- Temporal windows and loop boundaries are represented as structured requirements.
- State/baseline requirements are represented explicitly.
- True/false branch requirements are represented when present.
- Capability matching is dynamic and uses current system/plugin/protocol action catalogs.
- Missing native capabilities become Custom Node proposals.
- Unresolved requirements include clear questions and `blocksMaterialization`.

## Prepared Files

- `lib/agentic-builder/evaluation/spec/connector-semantics.json`
- `lib/agentic-builder/evaluation/spec/capability-policy.json`
- `lib/agentic-builder/evaluation/spec/capability-bindings.json`
- `lib/agentic-builder/evaluation/spec/system-capabilities.json`
- `lib/agentic-builder/evaluation/generated/policy.json`
- `lib/agentic-builder/evaluation/catalog.ts`
- `lib/agentic-builder/evaluation/runtime-catalog.ts`
- `lib/agentic-builder/evaluation/evaluator.ts`
- `lib/agentic-builder/evaluation/capability-matcher.ts`

## Required Fixture Outcomes

- `Notify me via Slack or Email` produces Slack and Email alternatives.
- `Notify me via Slack and Email` produces both Slack and Email tasks.
- `Send a Slack message about a SendGrid outage` treats SendGrid outage as subject, not SendGrid provider selection.
- `Slack me when ETH moves` produces unresolved threshold and schedule slots.
- `Create a v0 landing page site` produces a Custom Node proposal if no native v0 action exists.
- Stateful baseline prompts produce separate read/store/compare requirements.
- True/false branch prompts include both branch requirements.

## Prompt-Family Coverage

- Simple resolved intent.
- Missing requirement.
- Ambiguous requirement.
- Multi-branch intent.
- Time/window intent.
- Baseline/comparison intent.
- Multi-channel notification.
- Native-first selection.
- Missing native capability.
- Unsafe/destructive operation.
- Contradictions.
- Stateful follow-up.

## Verification

- `pnpm type-check`
- Requirement evaluation unit tests.
- Capability catalog unit tests.
- Capability matching unit tests.
- `pnpm fix` when repo-wide lint cleanup is in scope.
