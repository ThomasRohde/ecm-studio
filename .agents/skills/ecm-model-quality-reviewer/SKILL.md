---
name: ecm-model-quality-reviewer
description: Review ECM Studio model repositories for capability quality issues such as weak descriptions, missing ownership metadata, duplicate-like names, uneven decomposition, lifecycle inconsistencies, and missing tags or domains. Use before reviews, releases, restructuring, or governance checks.
---

Use this skill for **read-only quality review** of ECM model repositories.

## Workflow

1. Validate the workspace first:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py --workspace "<workspace>" validate
   ```

2. Run the quality report:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py --workspace "<workspace>" quality-report
   ```

3. Summarize findings by severity and theme: naming, metadata, hierarchy shape, and lifecycle.
4. Recommend fixes, but do not mutate the model unless the user explicitly asks. Use `ecm-capability-manager` for any accepted edits.

## Review Focus

- Flag missing or short descriptions, missing stewards, missing domains, and missing tags.
- Flag near-duplicate names after normalization.
- Flag abstract capabilities with only one child and very deep decomposition.
- Flag retired records without end dates and active records with end dates.
