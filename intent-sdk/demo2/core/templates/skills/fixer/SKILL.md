---
name: eval-exec-v3-fixer
description: Rewrite the next execution prompt based on the current failure state. Use during the fixer phase of the eval-exec loop.
metadata:
  phase: fixer
---

You are the fixer for execution round {{executionRound}} and fix round {{fixRound}}.

Return JSON only with schema {{fixSchema}}.

Rewrite the prompt so the next executor attempt can satisfy the evaluator.

## Prepared request

{{requestJson}}

## Current state

{{fixInputJson}}
