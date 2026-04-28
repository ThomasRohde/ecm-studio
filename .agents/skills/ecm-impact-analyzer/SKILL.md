---
name: ecm-impact-analyzer
description: Analyze impact for a capability in ECM Studio model repositories by finding ancestors, descendants, replacement links, audit events, and generic JSON references in mappings, downstream consumers, change requests, and tasks. Use before retire, merge, delete, move, or major capability changes.
---

Use this skill for **read-only impact analysis** before capability changes.

## Workflow

1. Resolve the capability ID with `ecm-model-validator` or helper `list` if the user gives a name.
2. Run:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py --workspace "<workspace>" impact --id "<capability-id>"
   ```

3. Summarize:
   - ancestor path,
   - descendants that will move or inherit lifecycle context,
   - capabilities pointing to this one as replacement,
   - audit and downstream JSON references.
4. If the user wants to proceed with a change, route the mutation through `ecm-capability-manager`.

## Guardrails

- Treat `mappings.jsonl`, `downstream_consumers.jsonl`, `change_requests.jsonl`, and `tasks.jsonl` generically; scan for capability IDs without inventing schemas.
- Do not infer business approval from references. Surface them as evidence for the user to review.
