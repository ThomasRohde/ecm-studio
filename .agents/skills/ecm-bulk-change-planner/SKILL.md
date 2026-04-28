---
name: ecm-bulk-change-planner
description: Plan safe batches of ECM Studio capability changes from a JSON operation list by validating IDs, names, parents, hierarchy rules, lifecycle operations, and command ordering before execution. Use for bulk reparenting, renaming, retiring, deleting draft leaves, or merge planning in ECM model repositories.
---

Use this skill for **bulk planning first**. Only execute changes after the user explicitly approves execution.

## Workflow

1. Prepare a changes JSON file:

   ```json
   {
     "operations": [
       {"action": "update", "id": "cap-old", "name": "New Name"},
       {"action": "move", "id": "cap-child", "parent_id": "cap-parent", "order": 0},
       {"action": "retire", "id": "cap-legacy", "rationale": "Replaced by new model"}
     ]
   }
   ```

2. Run:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py --workspace "<workspace>" bulk-plan --changes "<changes.json>"
   ```

3. Report validation errors and the generated command plan.
4. If execution is approved, run the planned `ecm-capability-manager` commands in order, then validate again.

## Guardrails

- Require explicit IDs for bulk creates so the plan is deterministic.
- Keep planning read-only; do not write `ecm\capabilities.jsonl` during planning.
- Prefer smaller batches when a hierarchy restructure and lifecycle changes are mixed.
