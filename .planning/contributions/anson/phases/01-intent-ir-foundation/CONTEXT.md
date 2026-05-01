# Phase 1 Context: Intent IR Foundation

## Why This Phase Exists

The current AI generation path is a one-shot prompt that asks the model to emit editor mutations directly. Building the new agentic builder on top of that path would preserve the wrong abstraction.

Phase 1 starts from the new foundation instead: spec JSON/template files generate the app-facing builder artifacts, and raw user language becomes a typed Intent IR with explicit requirements and statuses. Graph creation, preview state, and editor mutation happen only in later phases.

## Current Pain

- The current route asks the model to guess final graph operations too early.
- Required values, ambiguity, unsupported capability, branch semantics, temporal semantics, and state/baseline semantics are not represented as first-class data.
- Prompt instructions currently mix product intent, graph shape, operation syntax, layout, and examples.
- Without an Intent IR contract, later UX can look interactive while still behaving like direct prompt-to-canvas generation.
- Inline code-owned prompt/schema/vocabulary values create duplicate sources of truth and make it unclear which file should be edited.

## Scope Boundary

This phase does not refactor the existing production route and does not preserve JSONL as a foundation.

This phase is responsible for the new builder contract only:

```text
intent/spec/* -> generated artifacts -> prompt -> Intent IR -> requirement statuses
```

Preview graph state, decision tray UI, graph materialization, validation repair, and prompt-family evaluation belong to later phases.
