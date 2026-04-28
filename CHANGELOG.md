# Changelog

## [0.6.0] - 2026-04-28
- Add repository-scoped Capability Map layout density and alignment settings.
- Apply configured Capability Map density and alignment in the live map and
  exported map layouts.
- Centralize Capability Map UI defaults and align the layout fallback with the
  repository 16:9 target aspect ratio.

## [0.5.0] - 2026-04-27

- Improve large-model capability moves with a searchable Structural Actions
  target picker.
- Add capability tree search clearing and right-aligned lifecycle/merged badges.
- Add checkpoint revert and pending file discard workflows with confirmation.
- Show checkpoint labels in the Git graph.
- Package and apply the ECM Studio Windows icon, including Start Menu shortcut
  repair for taskbar pins.
- Polish the view maximize control alignment.

## [0.4.0] - 2026-04-27

- Add direct structural operations for retiring, merging, and controlled Draft
  leaf deletes with rationale-backed audit events.
- Preserve replacement capability links across domain models, import/export,
  SQLite projection, bridge APIs, and the desktop UI.
- Record derived `promote` and `demote` audit events when hierarchy changes
  alter computed capability type.
- Document common ECM Studio workflows, including bootstrapping an existing
  model with CSV, JSONL, or bundled JSON schema guidance.

## [0.3.3] - 2026-04-26

- Bundle UI fonts locally and remove the Google Fonts runtime dependency.
- Include packaged UI assets in source distributions.

## [0.3.2] - 2026-04-26

- Use an absolute GitHub-hosted screenshot URL so the PyPI README renders the image.

## [0.3.1] - 2026-04-26

- Clarify installation instructions for standard `pip`, Windows Python launcher fallback, and uv users.

## [0.3.0] - 2026-04-26

- Add repository-scoped capability map settings for target aspect ratio and colors.
- Add a Repository Settings panel and bridge API for editing workspace-saved settings.
- Apply configured capability map layout and colors in the live map and exported SVG/HTML.
- Refresh stress workspace map demo outputs with the new map settings.

## [0.2.0] - 2026-04-26

- Add persisted Dockview layouts with panel close/reopen controls and default layout reset.
- Store app settings under `.ecms`, including saved view setup, while reading legacy settings.
- Wait for the PyWebView bridge before falling back to mock UI data.
- Stabilize packaged UI asset names and add a rebuild helper plus Biome UI formatting scripts.

## [0.1.1] - 2026-04-26

- Expand the GitHub and PyPI README with a screenshot, install instructions, and release guidance.

## [0.1.0] - 2026-04-26

- Prepare PyPI publishing, package version display, and release automation.
