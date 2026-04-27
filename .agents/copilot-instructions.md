# ECM Studio Copilot Instructions

## Build, test, and lint commands

```powershell
pip install -e .[dev]
Set-Location ui; npm install
```

```powershell
# Run the desktop app against a Vite dev server
python -m ecm_studio --dev-ui http://localhost:5173

# Build the UI bundle consumed by pywebview and the PyInstaller package
Set-Location ui; npm run build

# Build the Windows desktop package after ui\dist exists
pyinstaller packaging\ecms.spec
```

```powershell
# Python
python -m pytest
python -m pytest tests\test_vertical_slice.py::test_capability_type_is_computed_from_hierarchy
python -m ruff check .

# UI
Set-Location ui; npm test
Set-Location ui; npm test -- src/api/bridge.test.ts
Set-Location ui; npm run typecheck
```

## High-level architecture

- `src\ecm_studio\cli.py` is the desktop entrypoint. It forwards to `src\ecm_studio\desktop\app.py`, which creates the pywebview window and loads either `ui\dist\index.html` or a `--dev-ui` URL.
- `src\ecm_studio\desktop\bridge.py` is the only backend surface the React app talks to. Every bridge method is wrapped with `application.results.envelope`, so TypeScript always receives `{ ok: true, data }` or `{ ok: false, error }`.
- `src\ecm_studio\application\services.py` is the orchestration layer. `AppServices` wires workspace lifecycle, capability CRUD/save/move, search, model import/export, Git workflows, diagnostics, and audit streams around a shared `AppContext`.
- Durable workspace data lives inside the selected Git repository, not in app-global storage: `ecm-studio.json` plus JSONL files under `ecm\`. Local runtime state lives under `.ecm-studio\` and includes the rebuildable SQLite projection at `.ecm-studio\cache\ecm.sqlite`.
- The domain layer (`src\ecm_studio\domain\*.py`) owns hierarchy invariants and capability transformations. The infrastructure layer handles file I/O, Git, settings, import/export parsing, and SQLite projection/search.
- The React UI is panel-driven. `ui\src\components\StudioLayout.tsx` configures Dockview, `ui\src\store\app-store.ts` and `ui\src\store\settings-store.ts` hold client state, and the main workflows live in `CapabilityPanels.tsx` and `WorkspacePanels.tsx`.
- `ui\src\api\bridge.ts` mirrors the pywebview API and also provides an in-memory mock fallback when `window.pywebview` is absent. That fallback is what the Vitest UI tests exercise.

## Key conventions

- Persisted records come from the Pydantic models in `src\ecm_studio\domain\models.py`. Use model validation and `durable_dict()`/DTO helpers instead of hand-assembling records so `_t` aliases and `schema_version` stay correct.
- `Capability.type` is computed from hierarchy, not user-owned state. The services/domain layer recomputes it with `with_computed_types()` before saving, rebuilding the tree, importing, exporting, and projecting to SQLite.
- Capability writes should go through `CapabilityService` or `ModelService`, not direct JSONL edits. The expected mutation flow is: validate/domain transform -> save JSONL -> append capability/model events -> rebuild the SQLite projection.
- `CapabilityRepository.save()` writes capabilities in depth-first order, so JSONL ordering follows tree order rather than insertion order.
- UI capability DTOs include `children`, but durable JSONL records and patch payloads do not. `_sanitize_capability_patch()` explicitly strips `children`, ids, ordering, timestamps, and other non-patch fields from inspector/tree payloads.
- Capability names are globally unique after whitespace/case normalization. Reordering and moves also renormalize sibling `order` values, so use the domain helpers for parent/order changes instead of editing those fields ad hoc.
- Search is projection-backed. `SearchService` queries SQLite, and both search and workspace open will rebuild the projection when it is stale or missing.
- Bridge-visible failures should be `AppError` subclasses from `src\ecm_studio\domain\errors.py` so the UI gets stable error codes like `VALIDATION_FAILED`, `CYCLE_DETECTED`, or `JSONL_PARSE_FAILED`.
- Git checkpoints intentionally stage only managed workspace paths: `ecm-studio.json`, `.gitignore`, and `ecm\`. Branch/switch/merge/pull operations require a clean workspace repo, and branch-changing operations rebuild the SQLite projection afterward.
- `replace` and `merge_by_id` imports create a pre-import Git checkpoint when the workspace is already a Git repo; `append` does not.
- User preferences such as theme mode and recent workspaces are stored by `SettingsRepository` in the user config directory, not in the workspace repository.
