# Phase 2 Context: Requirement Evaluation and Capability Matching

## Why This Phase Exists

The builder must stop relying on implied model understanding. Phase 1 creates the spec-driven Intent IR foundation. Phase 2 turns that IR into evaluated requirements, derived task candidates, unresolved questions, and capability matches without reintroducing inline product vocabulary.

This phase creates the behavior contract for prompts like:

```text
Slack me when ETH moves
Notify me via Slack or Email
Send a Slack message about a SendGrid outage
Create a v0 landing page site
```

## Core Risk

If this phase is vague, the rest of the builder will still behave like a one-shot prompt with nicer packaging. Requirement evaluation and capability matching must be deterministic, typed, testable, and sourced from explicit specs where product vocabulary is involved.

## Required Shift

```text
Old risk:
Prompt -> LLM step labels -> canvas

Required:
Prompt -> Intent IR from Phase 1 -> requirement evaluation -> candidate matching -> graph materialization
```

Tasks are derived from requirements. Requirements are the source of truth.

Phase 2 must not undo Phase 1's source-of-truth cleanup. Any product-level vocabulary introduced here should be represented in spec files and generated into app-facing artifacts.

## Scope Boundary

This phase does not render preview nodes or commit workflow changes. It consumes Intent IR and generated specs, then produces requirement evaluation results, derived builder task candidates, unresolved questions, and capability matches that later phases can project and materialize.
