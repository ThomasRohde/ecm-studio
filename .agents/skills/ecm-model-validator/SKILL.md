---
name: ecm-model-validator
description: Validate, inspect, and diagnose ECM Studio repositories that store capability data in ecm/capabilities.jsonl. Use this whenever the user asks whether an ECM repo is valid, wants to inspect capability IDs and paths, needs help understanding capability hierarchy issues, or before and after capability edits in an ECM repo, even if they only say the model seems broken or inconsistent.
---

Use this skill when the task is **diagnosis first, mutation second**.

It targets ECM workspace repositories with `ecm-studio.json` and `ecm/*.jsonl`.
Reuse the shared helper from `ecm-capability-manager` because it mirrors the
current ECM Studio capability JSONL and audit-file diagnostics.

## What this skill is for

- verify whether the ECM workspace is structurally valid,
- surface duplicate IDs or names,
- find missing parents,
- detect hierarchy cycles,
- list capability IDs and full paths before another skill makes a change.

## Preferred workflow

1. Confirm the target directory looks like an ECM workspace. If the current directory is not the target workspace, pass `--workspace "<path-to-workspace>"` to the helper commands.
2. Run:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py validate
   ```

3. If validation passes, use `list` to inspect IDs and paths:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py list
   ```

   Filter when needed:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py list --name Customer
   ```

4. If validation fails, summarize the exact diagnostics and point at the offending IDs, parents, or lines before suggesting a fix.
5. If the user also wants the problem repaired, use `ecm-capability-manager` or follow its workflow yourself.

## Important guidance

- Never edit `.ecm-studio\` or SQLite files while diagnosing the repo.
- Do not guess IDs when the helper can list them.
- If the model is invalid, prefer explaining the root cause in terms of ECM invariants: duplicate normalized name, missing parent, or cycle.
- Treat malformed `ecm/capability_versions.jsonl`, `ecm/model_versions.jsonl`, or `ecm/publish_events.jsonl` as app-facing diagnostics because ECM Studio surfaces those files in diagnostics and audit views.
- If validation passes but the app shows stale search/tree data, rebuild or refresh the SQLite projection from ECM Studio instead of editing `.ecm-studio\cache\ecm.sqlite`.
- After any repair, run validation again and state whether the diagnostics are now clean.

## Output expectations

Return a short, concrete diagnosis:

- whether validation passed,
- how many diagnostics were found,
- which capability IDs and names are involved,
- the next safe action if the user wants it fixed.

