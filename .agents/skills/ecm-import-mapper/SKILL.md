---
name: ecm-import-mapper
description: Convert external CSV capability exports into ECM Studio import-ready CSV, JSONL, or bundled JSON for ECM model repositories. Use when Codex needs to map source columns to capability fields, generate stable import files, validate import shape, or prepare data for ECM Studio import without editing the live ecm/capabilities.jsonl file.
---

Use this skill for **import preparation in ECM model repositories**, not for editing the ECM Studio app.

## Workflow

1. Confirm the target repo has `ecm-studio.json` and `ecm\`.
2. If the source is XLSX, convert the worksheet to CSV first; the helper consumes CSV.
3. Create a mapping JSON with:

   ```json
   {
     "fields": {
       "id": "Stable ID",
       "name": "Capability Name",
       "parent_id": "Parent ID",
       "description": "Description",
       "domain": "Domain",
       "tags": "Tags",
       "steward_id": "Owner"
     },
     "defaults": {
       "lifecycle_status": "Draft"
     },
     "split_fields": {
       "tags": ";",
       "aliases": ";",
       "source_references": ";"
     },
     "id_prefix": "cap-"
   }
   ```

4. Run the mapper:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py --workspace "<workspace>" import-map `
     --source "<source.csv>" `
     --mapping "<mapping.json>" `
     --output "<output.jsonl>" `
     --format jsonl
   ```

5. Report the output path, capability count, diagnostics, and any source rows that need correction.

## Guardrails

- Do not overwrite `ecm\capabilities.jsonl`; produce an import artifact for ECM Studio preview/apply.
- Prefer stable source IDs. If no ID column exists, the helper generates deterministic slug IDs from names.
- Validate duplicate names, missing parents, and hierarchy cycles before recommending import.
- Use `json_bundle` when the user wants a portable single JSON file.
