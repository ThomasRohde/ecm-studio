# ECM Workbench

ECM Workbench is a Windows-first desktop application for managing an Enterprise Capability Model as local, Git-managed JSONL files. SQLite is used only as a rebuildable local projection for fast navigation and search.

## Development

```powershell
pip install -e .[dev]
cd ui; npm install; npm run build; cd ..
python -m ecm_workbench --dev-ui http://localhost:5173
```

## Architecture

- Python owns domain logic, JSONL storage, SQLite projection, Git integration, and the pywebview bridge.
- React/TypeScript/Vite/Dockview owns the desktop UI.
- Durable data lives under `ecm/` in a selected Git repository.
- `.ecm-workbench/` is local runtime state and is ignored by Git.
