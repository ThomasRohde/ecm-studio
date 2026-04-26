# Codex Notes

- After any UI change under `ui/`, always rebuild the Vite bundle and refresh the packaged WebView assets before handing back to the user.
- Use `powershell -ExecutionPolicy Bypass -File scripts/rebuild-packaged-ui.ps1` from the repo root for that step.
- The installed `ecms` launcher serves `src/ecm_studio/assets/ui`, not `ui/dist`, so testing only the dev build can leave the command-line app running stale UI code.
- If old hashed bundle files exist in `src/ecm_studio/assets/ui/assets`, keep them refreshed from the current stable `index.js` / `index.css` so cached WebView references do not load outdated code.
