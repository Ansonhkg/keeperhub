# Phase 2 Plan: Requirement Evaluation and Capability Matching

## Implementation Steps

1. Consume the Phase 1 `BuilderIntentDraft` contract as the input boundary.
2. Add Phase 2 spec files for connector semantics, task derivation, capability matching, and custom fallback policy.
3. Generate any Phase 2 app-facing constants or prompt guidance from spec files rather than hardcoding domain vocabulary in runtime code.
4. Implement deterministic connector semantics over intent clauses:
   - conjunction creates multiple required tasks or outputs
   - alternative creates candidate options
   - sequence preserves ordered task dependencies
   - provider/channel connectors bind capability/provider slots
   - subject connectors bind message/content subject slots
   - trigger/condition connectors bind trigger or condition requirements
5. Implement requirement evaluation using the generated requirement status vocabulary from Phase 1.
6. Tighten semantic requirement models where Phase 1 only defines the contract:
   - conditions
   - temporal windows and loops
   - state/baselines
   - branch requirements
7. Build a dynamic capability catalog from:
   - system actions
   - plugin actions
   - protocol actions
   - custom-node fallback policy
8. Derive builder task candidates from requirements.
9. Match `capabilityIntent` to available actions.
10. Produce Custom Node matches when no native action exists.
11. Detect unresolved requirements and whether they block materialization.
12. Add tests for the role-play prompt fixture set and prompt-family matrix.

## Source of Truth Rule

Phase 2 should preserve the Phase 1 source-of-truth model:

```text
intent/spec/* -> generated artifacts -> runtime evaluator/matcher
```

Connector semantics, fallback policy, candidate decision labels, and matching constants should live in spec files when they are domain/product vocabulary. Runtime code should consume generated artifacts and should not repeat source vocabulary.

## Prepared Implementation Shape

Phase 2 now follows this app-facing flow:

```text
evaluation/spec/*.json
  -> scripts/agentic-builder/generate-artifacts.ts
  -> evaluation/generated/policy.json
  -> evaluation/policy.ts
  -> evaluation/catalog.ts + evaluation/runtime-catalog.ts
  -> evaluation/evaluator.ts + evaluation/capability-matcher.ts
```

The source JSON files are:

```text
connector-semantics.json
capability-policy.json
capability-bindings.json
system-capabilities.json
```

The runtime modules should only consume the generated policy object. They may refer to policy field names, but they should not restate connector words, source-priority values, custom fallback labels, or channel/provider binding vocabulary.

The current capability catalog adapter consumes:

```text
systemCapabilities from generated policy
plugin actions from plugins/registry
protocol actions registered through protocols/index.ts
```

Custom fallback remains a matcher result, not a catalog entry.

## Prompt Fixtures

```text
Slack me when ETH moves
Notify me via Slack or Email
Notify me via Slack and Email
Send a Slack message; email the team
Send an email via SendGrid to the team
Send a Slack message about a SendGrid outage
Notify me via webhook or Slack
Track ETH price every 15 minutes and send a Slack message
Track ETH price with Chronicle, track BTC price with Chainlink
Track ETH price and AVAX price with Chronicle
Create a v0 landing page site
Generate an image via AI Gateway
Create a Clerk user, publish the Webflow site
```

## Prompt Families

The fixture suite should cover prompt families, not only individual prompts:

```text
simple resolved intent
missing requirement
ambiguous requirement
multi-branch intent
time/window intent
baseline/comparison intent
multi-channel notification
native-first selection
missing native capability
unsafe/destructive operation
contradictions
stateful follow-up
```

Each test should assert:

```text
prompt
  -> extracted requirements
  -> requirement statuses
  -> questions shown
  -> native/custom candidate decisions
```

Phase 2 tests should assert evaluation and matching behavior from the Phase 1 Intent IR. They should not assert legacy JSONL editor operations.

## Custom Node Rule

A missing native capability should not stop the builder. It should produce:

```text
Custom Node proposal + optional Request native feature action
```

Generic HTTP fallback must require explicit user selection.
