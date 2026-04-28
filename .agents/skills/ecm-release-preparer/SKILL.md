---
name: ecm-release-preparer
description: Prepare ECM Studio model repositories for release by validating repository state, checking Git readiness, inspecting model and publish history, drafting release notes, and identifying blockers before an ECM release is cut or published. Use for release readiness checks, not for publishing.
---

Use this skill for **release preparation only**. Do not cut tags or publish releases.

## Workflow

1. Choose the intended semantic version in `X.Y.Z` form.
2. Run:

   ```powershell
   python .agents\skills\ecm-capability-manager\scripts\ecm_repo.py --workspace "<workspace>" release-readiness --version 1.2.3
   ```

3. Report blockers first, then warnings, Git status, audit action counts, and draft release notes.
4. If blockers exist, recommend the next safe action: validate/fix model, checkpoint dirty work, pull incoming changes, configure remote, or choose a new version.

## Guardrails

- Do not create tags, commits, GitHub releases, or export files from this skill.
- Treat `ecm-vX.Y.Z` as the model release tag convention.
- Check `ecm\model_versions.jsonl`, `ecm\publish_events.jsonl`, and `ecm\capability_versions.jsonl` for release context.
