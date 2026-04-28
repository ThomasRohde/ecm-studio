# ECM repository contract

Use this reference when you need to reason about ECM model repositories outside the ECM Studio UI.

## Authoritative files

- `ecm-studio.json`
- `ecm\capabilities.jsonl`
- append-only audit/history files under `ecm\`, especially:
  - `ecm\capability_versions.jsonl`
  - `ecm\model_versions.jsonl`
  - `ecm\publish_events.jsonl`

## Derived files

- `.ecm-studio\`
- `.ecm-studio\cache\ecm.sqlite`
- `*.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`

Do not edit derived files. They are local runtime state and can be rebuilt.

## Capability invariants

1. Capability names must be unique after trimming, lowercasing, and collapsing internal whitespace.
2. `parent_id` must be empty for top-level capabilities or point at an existing capability.
3. The hierarchy must remain acyclic.
4. Sibling `order` values must be normalized to `0..N-1` after structural changes.
5. `type` is computed from the hierarchy:
   - `abstract` when the capability has children
   - `leaf` when it does not
6. Retirement, merge, and delete are governed structural operations:
   - retire requires rationale,
   - merge requires rationale and may create a replacement link,
   - delete is only valid for Draft leaves.
7. Durable records in `ecm\capabilities.jsonl` must use `_t: "capability"` and `schema_version: "1.0"` so ECM Studio can load them without import-mode defaults.

## Mutation expectations

- Prefer deterministic rewrites of `ecm\capabilities.jsonl` over ad hoc line edits.
- Save capability records in depth-first tree order, matching ECM Studio's repository writer.
- Keep audit files append-only when recording events.
- Revalidate after capability mutations.
- Never set `replacement_capability_id` to the same capability ID.
- Expect ECM Studio to rebuild the SQLite projection on workspace open or explicit rebuild after file-based mutations.

