# ECM repository contract

Use this reference when you need to reason about ECM model repositories outside the ECM Studio UI.

## Authoritative files

- `ecm-studio.json`
- `ecm\capabilities.jsonl`
- append-only audit/history files under `ecm\`

## Derived files

- `.ecm-studio\`
- `*.sqlite`
- `*.sqlite-wal`
- `*.sqlite-shm`

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

## Mutation expectations

- Prefer deterministic rewrites of `ecm\capabilities.jsonl` over ad hoc line edits.
- Keep audit files append-only when recording events.
- Revalidate after capability mutations.
- Never set `replacement_capability_id` to the same capability ID.

