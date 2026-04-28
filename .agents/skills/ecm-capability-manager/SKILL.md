---
name: ecm-capability-manager
description: Safely create, update, move, retire, merge, and delete capabilities in ECM Studio repositories that store authoritative data in ecm/capabilities.jsonl and ecm-studio.json. Use this whenever the user asks to add capabilities, rename or reparent capabilities, change lifecycle state, merge duplicates, delete mistaken draft leaves, or otherwise modify capability data in an ECM repo, even if they do not mention JSONL files or ECM Studio by name.
---

Use this skill for **file-based ECM model maintenance outside the ECM Studio desktop app**.

It targets ECM workspace repositories with `ecm-studio.json` and `ecm/*.jsonl`.
Prefer the bundled Python helper when Python is available. The helper mirrors the
current ECM Studio domain rules for capability JSONL writes, audit events, depth-first
ordering, and computed capability `type`.

## Start with the repository contract

Before making changes, read `references/repo-contract.md`.

The important idea is that this repo's source of truth is the JSONL model under `ecm\`. Do not edit `.ecm-studio\` or SQLite cache files. Capability `type` is computed from the hierarchy, not chosen manually.

## Preferred workflow

1. Confirm the target directory is an ECM workspace by checking for `ecm-studio.json` and `ecm\capabilities.jsonl`. If the current directory is not the target workspace, pass `--workspace "<path-to-workspace>"` to the helper commands.
2. Run the bundled validator first:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py validate
   ```

3. If you need IDs or paths, list capabilities first:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py list
   ```

   Or narrow it down:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py list --name Payments
   ```

4. Use the helper script for mutations whenever possible. It preserves the ECM invariants and appends capability audit events.
5. Re-run validation after the change and report the capability IDs and files that changed.

## Mutation commands

### Create a capability

Use this to add a new top-level capability or a child under an existing parent.

```powershell
python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py create `
  --name "Payments" `
  --domain "Banking" `
  --tag finance `
  --steward-id "payments-steward"
```

Child example:

```powershell
python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py create `
  --name "Domestic Payments" `
  --parent-id "<parent-capability-id>" `
  --domain "Banking"
```

Notes:

- The script appends the new capability at the end of its sibling list.
- A newly created parent with no children is still a `leaf` until children exist.

### Update capability metadata

Use this for non-structural edits such as names, descriptions, domains, lifecycle status, aliases, tags, steward data, or replacement links.

```powershell
python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py update `
  --id "<capability-id>" `
  --name "Customer Activation" `
  --domain "Customer Experience" `
  --tag customer `
  --tag activation
```

List fields replace the full stored list when supplied:

- `--alias`
- `--tag`
- `--source-reference`

Use the matching `--clear-*` flag when the user wants to empty one of those lists.

### Move or reorder a capability

Use this when the user wants to reparent a capability or change sibling order.

```powershell
python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py move `
  --id "<capability-id>" `
  --parent-id "<new-parent-id>" `
  --order 0
```

If the user wants a capability moved to the top level, omit `--parent-id`.

### Retire a capability

Use retirement when the capability should remain in history but no longer be used.

```powershell
python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py retire `
  --id "<capability-id>" `
  --rationale "Replaced by the unified payments capability." `
  --replacement-capability-id "<replacement-id>"
```

Capture `downstream_handling` when the user supplies it so the audit event records the migration note.

### Delete a mistaken draft leaf

Use delete only when the capability is both `Draft` and a leaf.

```powershell
python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py delete `
  --id "<capability-id>" `
  --rationale "Created by mistake."
```

If the capability is not a draft leaf, stop and use retire or merge instead.

### Merge duplicate capabilities

Use merge when one capability should survive and absorb another.

```powershell
python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py merge `
  --source-id "<duplicate-id>" `
  --survivor-id "<canonical-id>" `
  --rationale "Duplicate model entry."
```

The helper:

- moves source children to the survivor,
- folds the source name and aliases into survivor aliases,
- removes the source if it was `Draft`,
- otherwise retires it and points `replacement_capability_id` at the survivor.

## When to avoid the helper

Fall back to direct file editing only when:

- Python is unavailable, or
- the user wants a change the helper does not support yet.

If you fall back to manual editing:

1. preserve the field names and record shape used in `ecm\capabilities.jsonl`,
2. recompute `type` from the hierarchy,
3. normalize sibling `order`,
4. keep capability names unique after trim/lower/whitespace normalization,
5. keep `ecm\capability_versions.jsonl` append-only if you record audit events,
6. validate again before finishing.

## ECM Studio app coordination

- Do not edit `.ecm-studio\` or SQLite projection files. The desktop app treats those as rebuildable runtime state.
- After helper-based file mutations, the app may show the SQLite index as stale until the workspace is opened, refreshed, or the index is rebuilt from the app diagnostics/workspace action.
- If ECM Studio is already open on the workspace, refresh or reopen the workspace before trusting search results or tree views.
- Keep Git changes limited to `ecm-studio.json`, `.gitignore`, and `ecm\` unless the user explicitly asks for other files.

## Output expectations

When you finish, report:

- the operation you performed,
- the affected capability IDs and names,
- whether audit history was updated,
- whether validation passed cleanly.

