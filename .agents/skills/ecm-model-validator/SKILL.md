---
name: ecm-model-validator
description: Validate, inspect, and diagnose ECM Studio repositories that store capability data in ecm/capabilities.jsonl. Use this whenever the user asks whether an ECM repo is valid, wants to inspect capability IDs and paths, needs help understanding capability hierarchy issues, or before and after capability edits in an ECM repo, even if they only say the model seems broken or inconsistent.
compatibility: Works in ECM workspace repositories with ecm-studio.json and ecm/*.jsonl. Reuses the shared ECM helper script from the capability manager skill.
---

Use this skill when the task is **diagnosis first, mutation second**.

## What this skill is for

- verify whether the ECM workspace is structurally valid,
- surface duplicate IDs or names,
- find missing parents,
- detect hierarchy cycles,
- list capability IDs and full paths before another skill makes a change.

## Preferred workflow

1. Confirm the repo looks like an ECM workspace.
2. Run:

   ```powershell
   python .github\skills\ecm-capability-manager\scripts\ecm_repo.py validate
   ```

3. If validation passes, use `list` to inspect IDs and paths:

   ```powershell
   python .github\skills\ecm-capability-manager\scripts\ecm_repo.py list
   ```

   Filter when needed:

   ```powershell
   python .github\skills\ecm-capability-manager\scripts\ecm_repo.py list --name Customer
   ```

4. If validation fails, summarize the exact diagnostics and point at the offending IDs, parents, or lines before suggesting a fix.
5. If the user also wants the problem repaired, hand off to `/ecm-capability-manager` or follow its workflow yourself.

## Important guidance

- Never edit `.ecm-studio\` or SQLite files while diagnosing the repo.
- Do not guess IDs when the helper can list them.
- If the model is invalid, prefer explaining the root cause in terms of ECM invariants: duplicate normalized name, missing parent, or cycle.
- After any repair, run validation again and state whether the diagnostics are now clean.

## Output expectations

Return a short, concrete diagnosis:

- whether validation passed,
- how many diagnostics were found,
- which capability IDs and names are involved,
- the next safe action if the user wants it fixed.

