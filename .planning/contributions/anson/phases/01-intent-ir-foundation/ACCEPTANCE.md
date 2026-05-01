# Phase 1 Acceptance

## Done Means

- `lib/agentic-builder` contains new Intent IR contracts and schemas.
- Intent status, kind, connector vocabularies, and schema shape live under `lib/agentic-builder/intent/spec/`.
- Derived enum sources, such as unresolved requirement statuses, are declared in JSON rather than hardcoded in the generator.
- Prompt vocabulary guidance is generated from spec files instead of repeated inline in `SKILL.md`.
- Prompt rules are generated from spec files instead of repeated inline in `SKILL.md`.
- Generated files live under `lib/agentic-builder/intent/generated/`.
- Runtime code consumes generated artifacts and does not duplicate source vocabulary or resolved-status rules.
- The first decomposer contract outputs Intent IR, not workflow graph nodes and not JSONL editor operations.
- Every extracted requirement has a status:
  - `satisfied`
  - `missing`
  - `ambiguous`
  - `conflicting`
  - `unsupported`
- Requirement kinds are dynamic enough to represent notification, schedule, temporal window, state/baseline, comparison, condition, branch, read, write, and custom capability intents.
- Prompt templates use the `templates/skills/<key>/SKILL.md` plus `spec.json` convention.
- Template loading validates frontmatter name, required placeholders, unknown placeholders, and missing render values.
- Intent IR generated artifacts are generated before `pnpm dev` and `pnpm build`.
- Tests cover Intent IR schema validation, template contract validation, and generated artifact/spec alignment.

## Non-Regressions

- Phase 1 does not change the existing production workflow generation route.
- Phase 1 does not introduce a new editor mutation path.
- Phase 1 does not create preview nodes, committed nodes, or graph edges.
- Phase 1 does not keep JSONL operation generation as the foundation for the new builder.

## Verification

- `pnpm type-check`
- Focused unit tests for Intent IR contracts and template loading
- `pnpm fix` when repo-wide lint cleanup is in scope
