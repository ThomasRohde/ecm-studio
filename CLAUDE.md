# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Canonical references

@AGENTS.md
@.github/copilot-instructions.md

The two files above carry the authoritative build/test/lint commands, architecture overview, and project conventions. Read them before assuming defaults.

## Critical rules not to miss

- **Rebuild packaged UI after any change under `ui/`.** The installed `ecms` launcher serves `src/ecm_studio/assets/ui`, not `ui/dist`. Run `powershell -ExecutionPolicy Bypass -File scripts/rebuild-packaged-ui.ps1` from the repo root before handing back. Testing only the dev server hides stale packaged UI.
- **Build the UI before packaging Python.** `pyinstaller packaging\ecms.spec` and the wheel build both require `ui/dist` to already exist.
- **Workspace files are the source of truth.** Durable data lives in the workspace Git repo (`ecm-studio.json` + `ecm/*.jsonl`). `.ecm-studio/cache/ecm.sqlite` is a rebuildable projection — never edit it as if it were authoritative, and never edit JSONL directly when a service method exists.
- **Mutate capabilities through services.** Use `CapabilityService` / `ModelService`. Flow is: validate/transform → save JSONL → append events → rebuild SQLite projection. Direct JSONL edits skip event logging and projection rebuild.
- **Bridge methods must return `AppError` subclasses on failure** (from `src/ecm_studio/domain/errors.py`) so the UI gets stable error codes. Don't let raw exceptions cross the bridge.

## Code style (non-defaults)

- Python: ruff line-length **100**, target **py313**. Config lives in `pyproject.toml` — there is no `.ruff.toml`.
- TypeScript: strict mode, ES2022, `jsx: react-jsx`. No ESLint/Prettier/Biome — don't add one without asking.
- Vite output is intentionally non-hashed (`assets/index.js`, `assets/index.css`) for WebView caching. Don't "fix" the rollup config to re-enable hashing.

## Entry points

- Python CLI: `[project.gui-scripts] ecms = "ecm_studio.cli:main"` (gui-scripts, not console_scripts).
- Dev workflow: `python -m ecm_studio --dev-ui http://localhost:5173` against `npm run dev` in `ui/`.
