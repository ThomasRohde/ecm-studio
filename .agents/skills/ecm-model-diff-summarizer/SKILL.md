---
name: ecm-model-diff-summarizer
description: Summarize ECM Studio capability model differences between two Git refs in an ECM model repository, including added, removed, renamed, moved, retired, lifecycle-changed, metadata-changed, and type-transitioned capabilities. Use for branch reviews, release notes, and scenario comparison.
---

Use this skill for **business-readable model diffs** between Git refs.

## Workflow

1. Confirm both refs exist in the ECM model repo.
2. Run:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py --workspace "<workspace>" diff --from "<base-ref>" --to "<target-ref>"
   ```

3. Summarize counts first, then list material changes by category.
4. Highlight potentially risky changes: removed capabilities, retirements, parent moves, and replacement-link changes.

## Guardrails

- Compare by stable capability ID, not by line order.
- Treat `type` as derived from hierarchy.
- Do not resolve Git conflicts or switch branches from this skill.
