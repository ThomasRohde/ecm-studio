---
name: ecm-governance-auditor
description: Audit governance and traceability evidence in ECM Studio model repositories, including structural-operation rationale, downstream handling, retired capability traceability, ownership metadata, audit file health, release records, and publish evidence. Use before governance reviews and releases.
---

Use this skill for **read-only governance review**.

## Workflow

1. Run:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py --workspace "<workspace>" governance-audit
   ```

2. Group findings into model validity, ownership metadata, lifecycle traceability, structural audit evidence, and release/publish evidence.
3. Recommend corrective actions. Use `ecm-capability-manager` for accepted capability edits.

## Review Focus

- Structural events `retire`, `delete`, and `merge` should have rationale and downstream handling in audit patches.
- Retired capabilities should have rationale and, when applicable, replacement links.
- Capability ownership should be visible through steward fields.
- Release history should exist when the model is being prepared for controlled publication.
