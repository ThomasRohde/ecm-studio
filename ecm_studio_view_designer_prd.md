# PRD: ECM Studio Capability View Designer

**Document status:** Developer-ready implementation PRD  
**Target product:** ECM Studio  
**Target feature:** Create, design, save, version, publish, and export one or more views of the capability model in the current ECM repository  
**Date:** 28 April 2026  
**Prepared for:** Codex implementation handoff  
**Primary implementation style:** Extend the existing ECM Studio desktop application; do not create a separate application.

---

## 1. Executive summary

ECM Studio needs a modern replacement for the older Domain Designer capability-model view designer. The new feature will let architects create multiple saved views of the capability model in the currently opened ECM repository, edit those views interactively, version them, publish immutable view revisions, and export them for stakeholders.

A **view** is not a copy of the capability model. It is a versioned, repository-stored definition of how a selected projection of the current or published model should be shown. It includes scope rules, root selections, filters, layout policy, manual layout overrides, presentation settings, annotations, and export defaults. Published view revisions also store a materialized snapshot sufficient to reproduce the view exactly against the model version it was published from.

The implementation must remain aligned with ECM Studio’s current architectural direction: Git-managed readable files as the source of truth, SQLite as a rebuildable local projection, React/Dockview/Fluent UI as the desktop UI, and pywebview/Python services as the backend bridge. The interactive canvas should use modern, common packages rather than custom low-level SVG editing. The recommended primary package is `@xyflow/react` for the interactive node-based designer, with `elkjs` for automatic hierarchical layout.

This PRD is independent of the legacy Domain Designer codebase. It defines the desired behavior, contracts, storage model, UI, validation, testing, and phased implementation plan without requiring the legacy repo to be available.

---

## 2. Current context and grounding

ECM Studio is a Windows-first desktop application for managing an Enterprise Capability Model as local Git-managed JSONL files. The public package description and repository show the current architecture and workflow direction: React, Dockview, Fluent UI, pywebview, Git-native checkpoints/releases, durable JSONL files under `ecm/`, and SQLite as a rebuildable local projection rather than source of truth.

Current ECM Studio already includes a static capability map panel with SVG/HTML export. The new View Designer should evolve this into a first-class saved and versioned view capability rather than leave it as a transient map screen.

Recommended external package direction:

| Area | Recommended package | Reason |
|---|---|---|
| Interactive diagram canvas | `@xyflow/react` | Modern React package for node-based editors and interactive diagrams; current React Flow package name is `@xyflow/react`. |
| Automatic graph layout | `elkjs` | JavaScript package for Eclipse Layout Kernel layout algorithms; suited for layered, directed, node-link diagrams. |
| Docked workbench panels | Existing `dockview` | ECM Studio already uses Dockview; it supports IDE-like docking, tabs, groups, split views, drag/drop, floating panels, and popouts. |
| App controls and theme | Existing `@fluentui/react-components` | Keep the Windows/enterprise UI consistent with existing ECM Studio. |
| Server state | Existing `@tanstack/react-query` | Keep repository-backed API state separate from local canvas state. |
| Local UI state | Existing `zustand` | Keep transient canvas/editor state local and composable. |
| Runtime validation in frontend | Add `zod` if bridge payloads need strict frontend parsing | Backend remains authoritative with Python/Pydantic; Zod can guard untrusted bridge responses and persisted view definitions in UI code. |

Reference links are listed at the end of this PRD.

---

## 3. Problem statement

The existing ECM Studio map capability is useful for static visualization, but it does not yet solve the broader architectural need:

Architects need to create purpose-specific views of the capability model, keep several views in the repository, update them as the model changes, version them independently, and publish stable view revisions that can be reviewed, exported, and traced back to model versions.

The legacy Domain Designer apparently offered some of this capability, but the new ECM Studio implementation must be modern, maintainable, repository-native, and based on common interactive packages. The new system must avoid becoming a free-form drawing tool where the diagram silently diverges from the model. Views must remain semantic projections of capabilities with optional presentation and annotation, not independent model copies.

---

## 4. Product goals

### G1. Create multiple named views in the current repository

Users can create one or more views of the currently opened ECM model. Views are persisted in the repository and visible to other users who pull the repo.

### G2. Keep views semantic and model-linked

A view references capabilities by stable capability IDs and uses scope/filter rules. It must not duplicate capabilities as disconnected diagram boxes.

### G3. Support interactive design with modern packages

Users can pan, zoom, select, auto-layout, manually position, collapse/expand, annotate, style, and export views using a modern React diagram canvas.

### G4. Version views independently from the model while linking them to model state

View revisions are versioned independently but always record the model commit/hash or release they were created from.

### G5. Preserve exact published views

A published view revision must be reproducible later, even after the model changes, as long as the referenced capability records can be resolved from the pinned model state.

### G6. Fit ECM Studio architecture

The implementation must use repository files as source of truth, SQLite projection for fast navigation/search/indexes, Python application services, and the existing React/Dockview UI model.

---

## 5. Non-goals

The first implementation must not attempt to become a general-purpose diagramming suite like draw.io.

It must not store authoritative view data only in SQLite, browser local storage, or hidden runtime files.

It must not require a server, cloud runtime, or external SaaS.

It must not use the legacy Domain Designer as a runtime dependency.

It must not allow users to create boxes that pretend to be capabilities without resolving to stable capability IDs, except for explicit annotations.

It must not implement arbitrary non-hierarchical dependency modeling in MVP. Capability-to-capability or application-to-capability mappings can be added as overlays later.

It must not make a model release automatically just because a view is published. View publishing and model publishing are related but separate actions.

---

## 6. Users and personas

### P1. Enterprise Architect / ECM Curator

Creates and maintains official views for governance, executive reporting, capability ownership/stewardship discussions, and release documentation.

### P2. Domain Architect

Creates focused views for a domain, product area, transformation topic, or analysis workshop. May create draft views and request review.

### P3. Architecture Reviewer / Governance Board Member

Inspects view revisions, checks what changed, and verifies that published views represent the intended capability model state.

### P4. Integration / Platform Engineer

Consumes exported view definitions or rendered artifacts, integrates published views into documentation, portals, release bundles, or downstream reporting.

### P5. Read-only stakeholder

Opens and exports published views but does not author them.

---

## 7. Core concepts

### 7.1 Capability model

The existing ECM model is the source of truth for capabilities. Capabilities have stable IDs, names, hierarchy, lifecycle status, metadata, and audit/release history.

### 7.2 View

A saved, named, repository-stored object representing a reusable visualization of part or all of the capability model.

A view has stable identity, metadata, tags, lifecycle/status, and one or more revisions.

### 7.3 View definition

The editable configuration that defines what a view shows and how it should be presented. It includes projection rules, layout settings, style rules, annotations, and manual overrides.

### 7.4 View revision

A numbered saved version of a view definition. Revisions can be draft or published. A published revision is immutable.

### 7.5 View snapshot

A materialized frozen representation created when a view revision is published. It records the resolved capabilities, labels, positions, collapsed state, annotations, styling, and model reference needed to reproduce the published view.

### 7.6 Model reference

A pointer from a view revision to the model state it was created against. For draft views this may be the current working tree. For published revisions it should be a Git commit SHA, release ID, model hash, or a combination.

### 7.7 View scope

The semantic subset of the model included in the view. Scope may be based on one or more roots, depth, explicit included IDs, explicit excluded IDs, lifecycle status, tags, domain, steward, or search-derived rules.

### 7.8 Annotation

A diagram element that is not a capability. Examples: title, note, callout, legend, boundary label, or grouping label. An annotation must be visually distinct and must never be exported as a capability record.

---

## 8. Product principles

1. **Semantic-first, not pixel-first.** The saved view must primarily describe a model projection and presentation rules. Coordinates are important, but they are not the meaning of the view.
2. **Stable IDs over names.** Every capability shown in a view is referenced by capability ID. Names are display labels and may change.
3. **Repository-native.** Views live in the same Git repository as the model, under `ecm/`, and participate in Git diff, checkpoint, pull, push, and release workflows.
4. **SQLite is rebuildable.** SQLite may index views but must never be the authoritative store.
5. **Published means reproducible.** A published view revision freezes enough information to render the same artifact later.
6. **Draft means editable.** Draft revisions can be updated while users design; published revisions cannot be edited in place.
7. **No silent drift.** If a view references capabilities that no longer exist in the current model, the UI must show diagnostics.
8. **No hidden external dependencies.** The desktop app must work offline against a local repo.
9. **Keep existing workflows working.** The current capability map/export path should either remain available or be cleanly migrated into View Designer without regression.
10. **Modern common packages.** Use established React diagram tooling for interactive canvas work rather than expanding custom SVG editing.

---

## 9. Scope

### 9.1 MVP scope

MVP must include:

- View list panel showing all saved views in the current workspace.
- Create view from all roots, a selected root, selected capability, or manual root selection.
- Create view metadata: name, description, tags, steward/owner field, intended audience, lifecycle/status.
- Interactive view designer canvas with pan, zoom, fit-to-view, select, drag, auto-layout, manual positioning, and reset layout.
- Scope filters: roots, max depth, lifecycle statuses, domains, tags, explicit include IDs, explicit exclude IDs.
- Collapse/expand subtrees in a view without modifying the model.
- Basic styling: color by domain, lifecycle, steward, custom fixed color, or neutral theme.
- Basic label controls: show name, ID, lifecycle badge, steward, tags, child count.
- Basic annotations: title, note/callout, legend toggle.
- Save draft revision.
- Publish immutable view revision.
- Duplicate view.
- Archive view.
- Diff two revisions of the same view at a functional level: scope changes, included/removed capabilities, layout changed, style changed, annotation changed.
- Export view as SVG and self-contained HTML. PNG export is desirable but optional in MVP if it adds too much implementation risk.
- Index views into SQLite for fast listing/search.
- Validate view references against current model and pinned model references.
- Include unit, component, and smoke tests.

### 9.2 Post-MVP scope

Post-MVP candidates:

- PNG/PDF export using a browser-side renderer.
- View templates.
- Relationship overlays, such as application-to-capability mappings or risk/control coverage.
- Heatmaps based on metadata or external measures.
- Compare a published view revision against current model and propose repair actions.
- Import old Domain Designer view definitions, if the legacy schema is provided.
- Governance workflow for view publication approval.
- Role-based permissions if ECM Studio gains user identity/authorization.
- Batch publish view bundle as part of model release workflow.

---

## 10. Functional requirements

### 10.1 View registry and metadata

**VD-FR-001** The system must store views in the currently opened ECM repository.

**VD-FR-002** A view must have a stable ID generated by the system.

**VD-FR-003** A view must have a unique name within the workspace after trimming and case-normalizing.

**VD-FR-004** A view must support metadata fields: name, description, tags, steward, intended audience, created timestamp, updated timestamp, archived flag/status, latest draft revision ID, latest published revision ID.

**VD-FR-005** The user must be able to list, search, sort, duplicate, archive, and open views.

**VD-FR-006** Archived views must remain in the repository and be restorable.

**VD-FR-007** Hard deletion of a view is not part of MVP except for clearly erroneous draft-only records and must require confirmation.

### 10.2 View creation

**VD-FR-008** The user must be able to create a view from the current full model.

**VD-FR-009** The user must be able to create a view from the currently selected capability as root.

**VD-FR-010** The user must be able to create a view from one or more manually selected roots.

**VD-FR-011** The user must be able to choose max depth during creation.

**VD-FR-012** The system must create a draft revision automatically when a view is created.

**VD-FR-013** The created view must open immediately in the View Designer.

### 10.3 View scope and projection

**VD-FR-014** A view definition must support one or more root capability IDs.

**VD-FR-015** A view definition must support all-roots mode.

**VD-FR-016** A view definition must support max depth. `null` or `-1` means no explicit depth limit.

**VD-FR-017** A view definition must support lifecycle filters.

**VD-FR-018** A view definition must support domain filters.

**VD-FR-019** A view definition must support tag filters.

**VD-FR-020** A view definition must support explicit capability includes.

**VD-FR-021** A view definition must support explicit capability excludes.

**VD-FR-022** Excluded capability IDs must hide the selected capability and descendants unless the definition explicitly uses `exclude_self_only`.

**VD-FR-023** Scope resolution must preserve valid hierarchy context. If a child is included while its parent is filtered out, the view must either show compact ancestor breadcrumbs or record an intentional orphan mode.

**VD-FR-024** Scope resolution must return diagnostics for missing IDs, retired hidden nodes, invalid roots, conflicting include/exclude rules, and empty views.

### 10.4 Canvas interaction

**VD-FR-025** The designer must support pan and zoom.

**VD-FR-026** The designer must support fit-to-view.

**VD-FR-027** The designer must support selecting a capability node and synchronizing selection with ECM Studio’s existing selected capability state.

**VD-FR-028** The designer must support dragging nodes to create manual positions.

**VD-FR-029** The designer must clearly show when a node has a manual position override.

**VD-FR-030** The designer must support reset layout for selected nodes and whole view.

**VD-FR-031** The designer must support collapse/expand subtree for a capability node.

**VD-FR-032** Collapse/expand state must be stored in the view definition, not in the capability model.

**VD-FR-033** The designer must support read-only mode for published revisions.

**VD-FR-034** Published revisions must not allow drag, delete, style, annotation, or scope edits unless the user first creates a new draft from that revision.

**VD-FR-035** The designer must not permit creating a capability node directly on the canvas. New capabilities must be created through existing model-editing flows.

### 10.5 Layout

**VD-FR-036** The system must support automatic hierarchical layout using `elkjs`.

**VD-FR-037** The default layout direction must be top-to-bottom for capability hierarchy, with left-to-right available.

**VD-FR-038** The layout settings must include direction, spacing/density, alignment, and optional aspect-ratio target.

**VD-FR-039** Manual node position overrides must be stored separately from automatic layout policy.

**VD-FR-040** Re-running auto-layout must preserve manual overrides if the user chooses “preserve manual positions”.

**VD-FR-041** Re-running auto-layout must clear manual overrides if the user chooses “full relayout”.

**VD-FR-042** The system must warn when a view contains enough nodes to make interactive rendering slow.

**VD-FR-043** The system must allow compact rendering for large views: smaller node cards, hidden metadata badges, and simplified edges.

### 10.6 Styling and presentation

**VD-FR-044** The view definition must support color scheme selection.

**VD-FR-045** Color modes must include neutral, domain, lifecycle, steward, and custom per-node override.

**VD-FR-046** Label options must include capability name, capability ID, lifecycle status, steward, domain, tags, and child count.

**VD-FR-047** The designer must support legend visibility on/off.

**VD-FR-048** The designer must support theme mode: follow app theme, light, dark, print.

**VD-FR-049** Styling must be deterministic and exportable.

**VD-FR-050** Custom node style overrides must reference capability IDs and must not mutate capability records.

### 10.7 Annotations

**VD-FR-051** The user must be able to add a view title annotation.

**VD-FR-052** The user must be able to add note/callout annotations.

**VD-FR-053** An annotation must have stable ID, type, text, position, size, optional anchor capability ID, and style.

**VD-FR-054** Annotations anchored to a capability must move relative to that capability when auto-layout is recalculated unless explicitly detached.

**VD-FR-055** Annotations must be visually distinguishable from capability nodes.

**VD-FR-056** Annotations must never appear in capability exports or model JSONL as capabilities.

### 10.8 Versioning

**VD-FR-057** Every view must have one editable draft revision unless the view is archived.

**VD-FR-058** Saving a draft updates the draft revision.

**VD-FR-059** Publishing a draft creates a new immutable published revision.

**VD-FR-060** Published revision numbers must increment monotonically per view.

**VD-FR-061** Publishing must record model reference, model hash, current Git commit if available, author/user label if available, timestamp, and rationale.

**VD-FR-062** If the model repository has uncommitted changes when publishing a view, the system must either require a checkpoint or explicitly record a working-tree model hash. Preferred MVP behavior: offer to create a Git checkpoint before publishing.

**VD-FR-063** The user must be able to create a new draft from any published revision.

**VD-FR-064** The user must be able to inspect revision history.

**VD-FR-065** The user must be able to compare two revisions of the same view.

**VD-FR-066** Published revisions must remain renderable even if the latest model has changed.

### 10.9 View diagnostics and repair

**VD-FR-067** The system must validate that all capability IDs referenced by a draft view exist in the current model.

**VD-FR-068** The system must validate that all capability IDs referenced by a published revision existed in its pinned model snapshot/reference.

**VD-FR-069** The system must show missing capability references with clear diagnostics.

**VD-FR-070** The system must show renamed capabilities as normal, because IDs remain stable.

**VD-FR-071** The system must show lifecycle changes that affect view filters.

**VD-FR-072** The user must be able to repair a draft view by removing missing references, replacing a missing/retired root, or changing filters.

**VD-FR-073** Published revisions must not be repaired in place. A repair must create a new draft/revision.

### 10.10 Export

**VD-FR-074** The system must export a view revision to SVG.

**VD-FR-075** The system must export a view revision to self-contained HTML.

**VD-FR-076** Exports must include title, legend if enabled, annotations, and visible capability nodes.

**VD-FR-077** Exports must include metadata: view name, revision label, model reference, export timestamp, and workspace name.

**VD-FR-078** Exports must not require external CDN assets.

**VD-FR-079** Exported HTML must be read-only.

**VD-FR-080** PNG export should be added if straightforward using browser-side SVG-to-canvas conversion; otherwise defer to post-MVP.

### 10.11 Integration with existing ECM Studio panels

**VD-FR-081** A “Views” panel must be available in the Dockview layout.

**VD-FR-082** A “View Designer” panel must be available and reusable for draft and published revisions.

**VD-FR-083** The existing capability tree and search selection should synchronize with the view designer selection.

**VD-FR-084** The existing capability map panel should either remain as “Quick Map” or be migrated into a default unsaved view flow.

**VD-FR-085** The application menu must include view actions: New View, Open Views, Save Draft, Publish View, Export View.

**VD-FR-086** The status bar must show whether the open view is draft, dirty, published/read-only, archived, or has diagnostics.

---

## 11. Non-functional requirements

### 11.1 Performance

**VD-NFR-001** Opening the view list should complete within 500 ms for 100 saved views on a normal developer workstation.

**VD-NFR-002** Opening a typical view of up to 250 visible nodes should render interactively within 1 second after data is loaded.

**VD-NFR-003** Views with 1,000 visible nodes should remain usable for navigation, selection, and export, though not necessarily smooth for heavy manual editing.

**VD-NFR-004** Views over 1,000 visible nodes should show a “large view” warning and offer compact mode, depth reduction, or static export.

**VD-NFR-005** Scope resolution for a 3,000-capability model should complete within 1 second in backend or frontend utility code.

### 11.2 Reliability

**VD-NFR-006** View registry, revision metadata, and definition files must be written atomically where practical.

**VD-NFR-007** Invalid view files must not crash the app; they must produce diagnostics and continue loading valid records.

**VD-NFR-008** The projection rebuild must tolerate archived and invalid views.

**VD-NFR-009** Save/publish operations must fail loudly and safely if the repository path is unavailable or files cannot be written.

### 11.3 Accessibility

**VD-NFR-010** The View Designer must support keyboard selection, keyboard zoom controls, and accessible labels for node cards.

**VD-NFR-011** Critical actions must be available outside canvas-only gestures.

**VD-NFR-012** Color schemes must not rely only on color; badges or labels must be available for lifecycle/domain/steward modes.

### 11.4 Security and compliance

**VD-NFR-013** No view designer data may be sent to external services.

**VD-NFR-014** No external CDN runtime assets may be required.

**VD-NFR-015** Exported files must escape all user-provided text to prevent HTML/SVG injection.

**VD-NFR-016** File paths selected for export must be validated by the existing desktop save mechanism.

**VD-NFR-017** The implementation must be suitable for a banking/regulated desktop environment: offline capable, local repository native, auditable, and deterministic.

### 11.5 Maintainability

**VD-NFR-018** Domain logic must not be embedded only in React components.

**VD-NFR-019** Scope resolution, validation, diff, and persistence must have unit tests.

**VD-NFR-020** React Flow node/edge conversion must be isolated in adapter functions.

**VD-NFR-021** ELK layout invocation must be isolated behind a layout service/utility.

**VD-NFR-022** Existing `CapabilityMapPanel` logic should be reused only where it is clean and tested. Avoid copying large monolithic components into the new designer.

---

## 12. Recommended information architecture and UX

### 12.1 New panels

Add these panels to the workbench:

1. **Views**: list/search/filter saved views.
2. **View Designer**: interactive canvas for a selected view revision.
3. **View Inspector**: right-side inspector for metadata, scope, layout, style, annotations, diagnostics, and revision history. This may be embedded inside View Designer if simpler.

### 12.2 Views panel

The Views panel should show:

- Search box.
- Filter chips: All, Draft, Published, Archived, Has diagnostics.
- New View button.
- List rows with view name, latest published revision, draft dirty state, tags, updated timestamp.
- Context menu: Open, Duplicate, Publish Draft, Export Latest Published, Archive, Restore.

### 12.3 Create view flow

Create View dialog fields:

- Name.
- Description.
- Starting point: All roots, selected capability, choose roots.
- Max depth.
- Initial layout: Top-down, left-to-right.
- Color mode: Neutral, lifecycle, domain, steward.
- Include lifecycle statuses.
- Tags.
- Intended audience.

After Create, open the draft in View Designer.

### 12.4 View Designer layout

Recommended workbench layout:

- Top toolbar: Save Draft, Publish, Export, Auto-layout, Fit, Reset, View Revision dropdown, Diagnostics indicator.
- Left mini-panel or inspector tab: Scope.
- Center: React Flow canvas.
- Right inspector: selected node, annotation, or view settings.
- Bottom or status: visible node count, model reference, revision state, dirty state.

### 12.5 Canvas behavior

Use React Flow for:

- Nodes = capabilities and annotations.
- Edges = parent-child hierarchy edges.
- Controls = zoom, fit view, minimap if useful.
- Custom nodes = capability cards with labels/badges.
- Selection = sync to ECM selected capability.
- Drag = manual layout override.

Recommended node types:

- `capabilityNode`: semantic capability node.
- `annotationNote`: callout/note.
- `annotationTitle`: title block.
- `legendNode`: optional legend element.
- `groupBoundary`: optional group visual in post-MVP.

### 12.6 Inspector behavior

When nothing is selected, show View settings:

- Metadata.
- Scope.
- Layout.
- Style.
- Revision history.
- Diagnostics.

When a capability is selected, show:

- Capability name, ID, lifecycle, domain, steward.
- Open capability details action.
- Collapse/expand subtree.
- Exclude from view.
- Pin/manual position status.
- Custom style override.

When an annotation is selected, show:

- Text.
- Anchor.
- Position/size.
- Style.
- Delete annotation.

### 12.7 Dirty-state behavior

A draft revision becomes dirty when metadata, scope, layout, style, annotations, or manual positions change.

Closing a dirty draft must prompt Save / Discard / Cancel.

Published revisions are read-only and should never become dirty.

---

## 13. Repository storage model

### 13.1 Proposed file layout

Use repository-native files under `ecm/`:

```text
ecm/
  capabilities.jsonl                 # existing
  views.jsonl                        # new: view registry records
  view_revisions.jsonl               # new: revision metadata records
  view_events.jsonl                  # new: view audit/event records, optional in MVP but recommended
  view_definitions/
    <view_id>/
      draft.json                     # editable current draft definition
      rev-0001.json                  # immutable published definition/snapshot
      rev-0002.json
```

Rationale:

- `views.jsonl` keeps view metadata easy to list and diff.
- `view_revisions.jsonl` keeps revision history easy to query and diff.
- Larger definition/snapshot documents are stored as separate JSON files to avoid extremely long JSONL lines and reduce merge pain.
- Published revision files are immutable. A published file must not be rewritten except by an explicit repair/migration tool with audit evidence.

### 13.2 View registry record

Record type: `model_view`  
File: `ecm/views.jsonl`

```json
{
  "_t": "model_view",
  "schema_version": "1.0",
  "id": "view-payments-overview",
  "name": "Payments Capability Overview",
  "description": "Domain-level view of payment capabilities for governance and portfolio discussions.",
  "status": "Active",
  "tags": ["payments", "governance"],
  "steward_id": "ea-payments",
  "intended_audience": "Architecture Governance Board",
  "latest_draft_revision_id": "draft",
  "latest_published_revision_id": "view-payments-overview-rev-0003",
  "latest_published_revision_number": 3,
  "created_at": "2026-04-28T08:00:00Z",
  "created_by": "local-user",
  "updated_at": "2026-04-28T08:30:00Z",
  "updated_by": "local-user"
}
```

Allowed `status` values:

- `Active`
- `Archived`

### 13.3 View revision metadata record

Record type: `model_view_revision`  
File: `ecm/view_revisions.jsonl`

```json
{
  "_t": "model_view_revision",
  "schema_version": "1.0",
  "id": "view-payments-overview-rev-0003",
  "view_id": "view-payments-overview",
  "revision_number": 3,
  "revision_label": "v3",
  "status": "Published",
  "definition_path": "ecm/view_definitions/view-payments-overview/rev-0003.json",
  "parent_revision_id": "view-payments-overview-rev-0002",
  "model_ref": {
    "kind": "git_commit",
    "git_commit": "abc123def456",
    "model_release_id": "release-2026-q2",
    "model_hash": "sha256:..."
  },
  "summary": "Updated scope to include domestic clearing and card settlement branches.",
  "created_at": "2026-04-28T08:30:00Z",
  "created_by": "local-user",
  "published_at": "2026-04-28T08:35:00Z",
  "published_by": "local-user",
  "immutable": true
}
```

Allowed `status` values:

- `Draft`
- `Published`
- `Superseded`

Draft revision metadata may point to `draft.json` and use `revision_number: null`.

### 13.4 View definition document

Record type: `model_view_definition`  
File: `ecm/view_definitions/<view_id>/draft.json` or `rev-000N.json`

```json
{
  "_t": "model_view_definition",
  "schema_version": "1.0",
  "view_id": "view-payments-overview",
  "revision_id": "draft",
  "definition_version": 1,
  "model_ref": {
    "kind": "working_tree",
    "git_commit": null,
    "model_release_id": null,
    "model_hash": "sha256:working-tree-model-hash"
  },
  "projection": {
    "mode": "hierarchy",
    "root_ids": ["cap-payments"],
    "all_roots": false,
    "max_depth": 4,
    "include_lifecycle_statuses": ["Draft", "Active", "Deprecated"],
    "include_domains": [],
    "include_tags": [],
    "explicit_include_ids": [],
    "explicit_exclude_ids": [],
    "ancestor_context_mode": "show_compact_ancestors"
  },
  "layout": {
    "engine": "elkjs",
    "algorithm": "layered",
    "direction": "DOWN",
    "density": "comfortable",
    "alignment": "center",
    "target_aspect_ratio": 1.6,
    "preserve_manual_positions": true,
    "manual_node_positions": {
      "cap-domestic-payments": { "x": 420, "y": 180 }
    },
    "collapsed_subtree_ids": ["cap-card-payments"]
  },
  "presentation": {
    "theme": "follow_app",
    "color_mode": "lifecycle",
    "show_legend": true,
    "label_fields": ["name", "lifecycle_status"],
    "node_density": "comfortable",
    "edge_style": "orthogonal",
    "custom_node_styles": {}
  },
  "annotations": [
    {
      "id": "ann-title",
      "type": "title",
      "text": "Payments Capability Overview",
      "position": { "x": 0, "y": -120 },
      "size": { "width": 600, "height": 64 },
      "anchor_capability_id": null,
      "style": { "emphasis": "strong" }
    }
  ],
  "export_defaults": {
    "include_metadata": true,
    "include_legend": true,
    "format": "svg"
  },
  "snapshot": null
}
```

For a published revision, `snapshot` must be populated:

```json
{
  "snapshot": {
    "created_at": "2026-04-28T08:35:00Z",
    "model_hash": "sha256:...",
    "resolved_capabilities": [
      {
        "id": "cap-payments",
        "name": "Payments",
        "parent_id": null,
        "lifecycle_status": "Active",
        "domain": "Banking",
        "steward_id": "ea-payments",
        "depth": 0,
        "path": ["Payments"]
      }
    ],
    "nodes": [
      {
        "id": "cap-payments",
        "type": "capabilityNode",
        "position": { "x": 100, "y": 100 },
        "size": { "width": 240, "height": 88 },
        "data_hash": "sha256:..."
      }
    ],
    "edges": [
      {
        "id": "edge-cap-payments-cap-domestic-payments",
        "source": "cap-payments",
        "target": "cap-domestic-payments",
        "type": "hierarchy"
      }
    ],
    "annotations": []
  }
}
```

Snapshot rationale: a draft can be regenerated from the current model; a published revision must be reproducible and auditable.

### 13.5 View event record

Record type: `model_view_event`  
File: `ecm/view_events.jsonl`

```json
{
  "_t": "model_view_event",
  "schema_version": "1.0",
  "id": "view-event-20260428-0001",
  "view_id": "view-payments-overview",
  "revision_id": "view-payments-overview-rev-0003",
  "event_type": "publish_view_revision",
  "summary": "Published v3 of Payments Capability Overview.",
  "actor": "local-user",
  "created_at": "2026-04-28T08:35:00Z",
  "details": {
    "visible_node_count": 87,
    "model_ref_kind": "git_commit"
  }
}
```

Recommended `event_type` values:

- `create_view`
- `update_view_metadata`
- `save_view_draft`
- `publish_view_revision`
- `duplicate_view`
- `archive_view`
- `restore_view`
- `export_view`
- `repair_view`

---

## 14. SQLite projection

SQLite must be rebuildable from repository files. Add or extend projection tables:

```sql
CREATE TABLE IF NOT EXISTS views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  steward_id TEXT,
  intended_audience TEXT,
  latest_draft_revision_id TEXT,
  latest_published_revision_id TEXT,
  latest_published_revision_number INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS view_revisions (
  id TEXT PRIMARY KEY,
  view_id TEXT NOT NULL,
  revision_number INTEGER,
  revision_label TEXT,
  status TEXT NOT NULL,
  definition_path TEXT NOT NULL,
  parent_revision_id TEXT,
  model_ref_json TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT,
  immutable INTEGER NOT NULL,
  FOREIGN KEY (view_id) REFERENCES views(id)
);

CREATE TABLE IF NOT EXISTS view_capability_refs (
  view_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  PRIMARY KEY (view_id, revision_id, capability_id, ref_kind)
);

CREATE TABLE IF NOT EXISTS view_diagnostics (
  view_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  diagnostic_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  capability_id TEXT,
  created_at TEXT NOT NULL
);
```

`view_capability_refs.ref_kind` values:

- `root`
- `explicit_include`
- `explicit_exclude`
- `visible_snapshot`
- `manual_position`
- `annotation_anchor`

---

## 15. Backend/application service design

### 15.1 Python domain objects

Add domain models in `src/ecm_studio/domain/views.py` or extend existing domain model module if that is the current pattern.

Required classes/enums:

- `ModelView`
- `ModelViewRevision`
- `ModelViewDefinition`
- `ViewProjection`
- `ViewLayoutPolicy`
- `ViewPresentation`
- `ViewAnnotation`
- `ViewSnapshot`
- `ViewDiagnostic`
- `ViewStatus`
- `ViewRevisionStatus`
- `ViewEventType`

Use Pydantic if current code uses Pydantic for repository payloads; otherwise follow existing domain model style.

### 15.2 Application service

Add `ViewService` in `src/ecm_studio/application/services.py` or a dedicated module if services are being split.

Required service methods:

```python
class ViewService:
    def list_views(self, include_archived: bool = False) -> list[ModelViewSummary]: ...
    def get_view(self, view_id: str) -> ModelViewDetail: ...
    def get_revision(self, view_id: str, revision_id: str) -> ModelViewRevisionDetail: ...
    def create_view(self, request: CreateViewRequest) -> ModelViewDetail: ...
    def update_view_metadata(self, view_id: str, request: UpdateViewMetadataRequest) -> ModelViewDetail: ...
    def save_draft(self, view_id: str, definition: ModelViewDefinition) -> ModelViewRevisionDetail: ...
    def publish_draft(self, view_id: str, request: PublishViewRequest) -> ModelViewRevisionDetail: ...
    def create_draft_from_revision(self, view_id: str, revision_id: str) -> ModelViewRevisionDetail: ...
    def duplicate_view(self, view_id: str, request: DuplicateViewRequest) -> ModelViewDetail: ...
    def archive_view(self, view_id: str) -> ModelViewDetail: ...
    def restore_view(self, view_id: str) -> ModelViewDetail: ...
    def validate_view(self, view_id: str, revision_id: str | None = None) -> list[ViewDiagnostic]: ...
    def diff_revisions(self, view_id: str, left_revision_id: str, right_revision_id: str) -> ViewRevisionDiff: ...
    def export_view(self, request: ExportViewRequest) -> ExportResult: ...
```

### 15.3 Infrastructure/persistence

Add a repository class in `src/ecm_studio/infrastructure/views_repository.py` or similar:

```python
class ViewsRepository:
    def load_views(self) -> list[ModelView]: ...
    def save_views(self, views: list[ModelView]) -> None: ...
    def load_revisions(self) -> list[ModelViewRevision]: ...
    def save_revisions(self, revisions: list[ModelViewRevision]) -> None: ...
    def load_definition(self, path: str) -> ModelViewDefinition: ...
    def save_definition(self, path: str, definition: ModelViewDefinition, immutable: bool = False) -> None: ...
    def append_event(self, event: ModelViewEvent) -> None: ...
```

Persistence rules:

- Use existing JSONL helpers for registry files.
- Use canonical JSON formatting for definition files: sorted keys if compatible, 2-space indentation, UTF-8, newline at EOF.
- Validate before write.
- Use temp file and atomic replace for mutable files.
- Refuse to overwrite immutable published revision files.
- Create directories as needed.

### 15.4 Model resolver

Add a model resolver utility that can resolve capabilities for:

- Current working tree.
- Current SQLite projection.
- Published model release if supported.
- Git commit snapshot if current infrastructure can read historical files.

MVP fallback: Published view revisions store a materialized snapshot, so rendering a published revision does not require checking out historical Git commits. Diffing current model against a published revision can use current model plus snapshot.

### 15.5 View scope resolver

Implement pure functions for scope resolution:

```python
def resolve_view_scope(model: CapabilityModel, projection: ViewProjection) -> ResolvedViewScope: ...
def validate_view_definition(model: CapabilityModel, definition: ModelViewDefinition) -> list[ViewDiagnostic]: ...
def materialize_view_snapshot(model: CapabilityModel, definition: ModelViewDefinition) -> ViewSnapshot: ...
```

Scope resolver must be unit-tested independently from UI.

---

## 16. Frontend/API bridge design

### 16.1 API namespace

Extend the pywebview bridge with a `views` namespace, or add methods following existing bridge conventions.

Required API methods from UI perspective:

```ts
api.views.list({ includeArchived?: boolean }): Promise<ViewSummary[]>;
api.views.get({ viewId: string }): Promise<ViewDetail>;
api.views.getRevision({ viewId: string; revisionId: string }): Promise<ViewRevisionDetail>;
api.views.create(request: CreateViewRequest): Promise<ViewDetail>;
api.views.updateMetadata(request: UpdateViewMetadataRequest): Promise<ViewDetail>;
api.views.saveDraft(request: SaveViewDraftRequest): Promise<ViewRevisionDetail>;
api.views.publishDraft(request: PublishViewRequest): Promise<ViewRevisionDetail>;
api.views.createDraftFromRevision(request: CreateDraftFromRevisionRequest): Promise<ViewRevisionDetail>;
api.views.duplicate(request: DuplicateViewRequest): Promise<ViewDetail>;
api.views.archive(request: ArchiveViewRequest): Promise<ViewDetail>;
api.views.restore(request: RestoreViewRequest): Promise<ViewDetail>;
api.views.validate(request: ValidateViewRequest): Promise<ViewDiagnostic[]>;
api.views.diff(request: DiffViewRevisionsRequest): Promise<ViewRevisionDiff>;
api.views.export(request: ExportViewRequest): Promise<ExportResult>;
```

### 16.2 Frontend types

Add TypeScript types under `ui/src/api/types.ts` or a dedicated `ui/src/views/types.ts`.

Core frontend types:

```ts
export type ViewStatus = 'Active' | 'Archived';
export type ViewRevisionStatus = 'Draft' | 'Published' | 'Superseded';
export type ViewColorMode = 'neutral' | 'domain' | 'lifecycle' | 'steward' | 'custom';
export type ViewTheme = 'follow_app' | 'light' | 'dark' | 'print';
export type ViewLayoutDirection = 'DOWN' | 'RIGHT';

export interface ViewSummary {
  id: string;
  name: string;
  description?: string;
  status: ViewStatus;
  tags: string[];
  latestDraftRevisionId?: string;
  latestPublishedRevisionId?: string;
  latestPublishedRevisionNumber?: number;
  updatedAt: string;
  hasDiagnostics: boolean;
}

export interface ModelViewDefinition {
  _t: 'model_view_definition';
  schema_version: '1.0';
  view_id: string;
  revision_id: string;
  model_ref: ModelRef;
  projection: ViewProjection;
  layout: ViewLayoutPolicy;
  presentation: ViewPresentation;
  annotations: ViewAnnotation[];
  export_defaults: ViewExportDefaults;
  snapshot: ViewSnapshot | null;
}
```

### 16.3 State management

Use:

- TanStack Query for repository-backed data: views list, view detail, revision detail, validation, diff.
- Zustand for transient editor state: selected React Flow node, dirty state, unsaved local definition, canvas UI mode, pending changes.
- React Flow internal state for nodes/edges while editing, synchronized to the draft definition through adapter functions.

Do not put large React Flow node arrays into a global store unless necessary.

---

## 17. React Flow adapter design

### 17.1 Adapter functions

Create a dedicated module, for example `ui/src/views/react-flow-adapter.ts`:

```ts
export function definitionToFlow(definition: ModelViewDefinition, capabilities: CapabilitySummary[]): FlowModel;
export function flowToDefinitionPatch(flow: FlowModel, previous: ModelViewDefinition): Partial<ModelViewDefinition>;
export function resolvedScopeToFlowNodes(scope: ResolvedViewScope, definition: ModelViewDefinition): Node[];
export function resolvedScopeToFlowEdges(scope: ResolvedViewScope): Edge[];
export function applyManualPositionOverrides(nodes: Node[], definition: ModelViewDefinition): Node[];
export function extractManualPositionOverrides(nodes: Node[], previous: ModelViewDefinition): Record<string, ViewPoint>;
```

### 17.2 Node data contract

React Flow capability node data:

```ts
interface CapabilityFlowNodeData {
  kind: 'capability';
  capabilityId: string;
  name: string;
  lifecycleStatus: string;
  domain?: string;
  stewardId?: string;
  tags: string[];
  depth: number;
  childCount: number;
  collapsed: boolean;
  diagnostics: ViewDiagnostic[];
  display: {
    labelFields: string[];
    colorMode: ViewColorMode;
    fill: string;
    badgeText?: string;
  };
}
```

Annotation node data:

```ts
interface AnnotationFlowNodeData {
  kind: 'annotation';
  annotationId: string;
  annotationType: 'title' | 'note' | 'callout' | 'legend';
  text: string;
  anchorCapabilityId?: string | null;
}
```

### 17.3 Edge data contract

Hierarchy edge data:

```ts
interface CapabilityHierarchyEdgeData {
  kind: 'hierarchy';
  parentId: string;
  childId: string;
}
```

### 17.4 Layout service

Create `ui/src/views/layout/elk-layout.ts`:

```ts
export async function layoutWithElk(input: LayoutInput, options: ViewLayoutPolicy): Promise<LayoutOutput>;
```

Rules:

- Keep ELK-specific shape conversion in one module.
- Do not let React components build ELK JSON directly.
- Support `DOWN` and `RIGHT` directions in MVP.
- Apply manual positions after ELK layout unless full relayout is requested.
- Use web worker later if layout blocks UI; not mandatory for MVP unless performance is poor.

---

## 18. Diff design

View revision diff must compare:

- Metadata changes.
- Projection changes.
- Added visible capabilities.
- Removed visible capabilities.
- Changed root IDs.
- Changed filters.
- Changed collapsed nodes.
- Changed manual positions.
- Changed presentation/style rules.
- Added/removed/changed annotations.
- Changed export defaults.
- Changed model reference.

Diff output example:

```json
{
  "view_id": "view-payments-overview",
  "left_revision_id": "view-payments-overview-rev-0002",
  "right_revision_id": "view-payments-overview-rev-0003",
  "summary": {
    "added_capabilities": 12,
    "removed_capabilities": 3,
    "layout_changes": 18,
    "annotation_changes": 1,
    "style_changes": 2
  },
  "changes": [
    {
      "kind": "capability_added",
      "capability_id": "cap-card-settlement",
      "path": "Payments > Card Payments > Card Settlement"
    },
    {
      "kind": "projection_changed",
      "field": "max_depth",
      "old": 3,
      "new": 4
    }
  ]
}
```

---

## 19. Publish flow

### 19.1 Publish dialog

Fields:

- Summary/rationale, required.
- Revision label, default `vN`.
- Model reference preview: current commit, release, model hash, dirty state.
- Checkbox: “Create Git checkpoint before publishing” if working tree is dirty.
- Warning if diagnostics exist.

### 19.2 Publish validation

Publishing must be blocked if:

- View name is missing.
- View has no visible capabilities.
- View references missing capability IDs.
- View definition schema is invalid.
- Published revision file path already exists.

Publishing should warn, but not necessarily block, if:

- View includes retired capabilities.
- View includes draft capabilities.
- View has over 1,000 visible nodes.
- Workspace Git state is dirty and user declines checkpoint; product owner decision: preferred MVP behavior is to allow only with explicit working-tree hash, but strict checkpoint-only is acceptable.

### 19.3 Publish side effects

On successful publish:

- Materialize snapshot.
- Write immutable `rev-000N.json` file.
- Append/replace revision metadata in `view_revisions.jsonl`.
- Update `views.jsonl` latest published fields.
- Append view event.
- Rebuild or update SQLite projection.
- Notify user.
- Keep draft open and mark clean; either keep draft equal to published revision or start a new draft from it. Preferred behavior: keep draft equal to published and clean.

---

## 20. Export design

### 20.1 Supported formats

MVP required:

- SVG.
- Self-contained HTML.

Optional if quick and reliable:

- PNG.

### 20.2 Export metadata block

Exports must include metadata in a visually modest footer or embedded metadata section:

- View name.
- View revision label/number.
- Model reference.
- Workspace name.
- Export timestamp.
- Node count.

### 20.3 Export implementation

Prefer using the same render model for interactive and export. Do not build two divergent rendering engines.

Suggested approach:

- Convert `ModelViewDefinition` + snapshot/resolved scope into a serializable render model.
- Render React Flow for interactive editing.
- Render SVG/HTML from the render model using deterministic functions.
- Reuse existing capability map export utilities where practical, but avoid forcing the new designer into the old static map shape.

Security requirement: Escape all user-controlled fields in SVG/HTML export.

---

## 21. Acceptance criteria by user story

### US-001 Create a new view

As an EA Curator, I can create a new named view from the current selected capability so I can focus on a domain branch.

Acceptance criteria:

- Given an open workspace and selected capability, New View offers “Selected capability as root”.
- When I enter a valid name and create the view, a new view record is stored in `ecm/views.jsonl`.
- A draft definition is stored under `ecm/view_definitions/<view_id>/draft.json`.
- The view opens in View Designer.
- The visible nodes match the selected root and depth setting.

### US-002 Save a draft view

As a Domain Architect, I can move nodes and save the draft view so my layout is preserved.

Acceptance criteria:

- Dragging a capability node marks the draft dirty.
- Save Draft writes manual position overrides.
- Reopening the view restores manual positions.
- Capability records are not modified.

### US-003 Auto-layout a view

As an EA Curator, I can auto-layout a view so that a messy diagram becomes readable.

Acceptance criteria:

- Auto-layout uses the selected layout direction and density.
- Manual positions are preserved or cleared according to the selected option.
- The resulting definition is dirty until saved.
- Layout does not change model hierarchy.

### US-004 Collapse a subtree

As a reviewer, I can collapse a subtree so that the view can focus on higher-level structure.

Acceptance criteria:

- A selected non-leaf capability offers Collapse Subtree.
- Descendants are hidden from the canvas.
- The collapsed node indicates hidden descendants.
- Collapse state is saved in the view definition.
- Expanding restores descendants according to current scope filters.

### US-005 Publish a view revision

As an EA Curator, I can publish a draft as a stable view revision.

Acceptance criteria:

- Publish requires a summary/rationale.
- Publish creates `rev-000N.json`.
- Published revision metadata is added to `ecm/view_revisions.jsonl`.
- The published revision records a model reference and model hash.
- The published revision is read-only when reopened.
- Attempting to edit a published revision prompts creation of a new draft.

### US-006 Compare revisions

As a governance reviewer, I can compare two revisions of the same view.

Acceptance criteria:

- Revision history lists published revisions.
- Selecting two revisions opens a diff.
- Diff shows added/removed visible capabilities.
- Diff shows changed scope filters.
- Diff shows changed annotations and layout counts.

### US-007 Export a published view

As a stakeholder, I can export a published view to SVG or HTML.

Acceptance criteria:

- Export action is available on a published revision.
- Exported SVG/HTML includes visible capabilities, hierarchy, annotations, legend if enabled, and metadata.
- Export does not require external network access.
- Export escapes user-provided text.

### US-008 Validate broken references

As an EA Curator, I can see when a draft view references capabilities that no longer exist.

Acceptance criteria:

- Opening a draft with missing IDs shows diagnostics.
- Missing references do not crash the designer.
- The repair action can remove missing explicit references from the draft.
- Published revisions are not modified by repair.

---

## 22. Implementation plan

### Phase 1: Storage, domain model, and projection

Deliverables:

- Domain models for views, revisions, definitions, annotations, snapshots, diagnostics.
- Repository read/write for `views.jsonl`, `view_revisions.jsonl`, `view_events.jsonl`, and definition JSON files.
- SQLite projection tables and rebuild integration.
- Unit tests for load/save/validation/projection.

Exit criteria:

- A sample workspace with view files loads successfully.
- Invalid records produce diagnostics rather than app crash.
- Projection rebuild indexes views and revisions.

### Phase 2: Backend service and bridge

Deliverables:

- `ViewService` with list/get/create/save/publish/archive/duplicate/validate/diff/export stubs or full implementation where possible.
- pywebview bridge methods.
- TypeScript API types and bridge wrappers.
- Unit tests for service behavior.

Exit criteria:

- UI can list views from backend.
- UI can create a view and save a draft definition.
- Publish creates a published revision and immutable file.

### Phase 3: View list and create/open UI

Deliverables:

- Views Dockview panel.
- Create View dialog.
- View row actions.
- Open draft/published revision.
- Dirty/read-only status handling.

Exit criteria:

- User can create/open/archive/restore/duplicate views from UI.

### Phase 4: Interactive designer

Deliverables:

- Add `@xyflow/react` and `elkjs` dependencies.
- React Flow canvas with custom capability node.
- Scope-to-flow adapter.
- Selection sync with existing app selected capability.
- Pan/zoom/fit controls.
- Drag/manual positions.
- Auto-layout with ELK.
- Collapse/expand.

Exit criteria:

- User can design and save a draft view interactively.
- Reopen restores layout and collapsed state.
- Large-view warning appears above configured threshold.

### Phase 5: Inspector, styling, annotations

Deliverables:

- View settings inspector.
- Selected capability inspector actions.
- Annotation add/edit/delete.
- Presentation settings.
- Legend.

Exit criteria:

- User can configure styling and annotations, save draft, publish, and reopen.

### Phase 6: Diff, diagnostics, and export

Deliverables:

- Revision history UI.
- Revision diff UI.
- Validation diagnostics UI.
- SVG and HTML export.
- Export metadata.
- Export escaping tests.

Exit criteria:

- User can compare revisions and export published or draft views.

### Phase 7: Polish and regression

Deliverables:

- Keyboard actions.
- Accessibility labels.
- Integration with menu/status bar.
- Ensure existing capability map/export still works or has clear migration path.
- End-to-end smoke tests if Playwright is added.

Exit criteria:

- Existing `pytest`, frontend test, lint, and typecheck commands pass.
- No regression in capability tree, existing map, export, or Git checkpoint workflows.

---

## 23. Testing strategy

### 23.1 Python unit tests

Add tests for:

- View registry parsing.
- Revision parsing.
- Definition parsing.
- Invalid schema handling.
- Unique view name validation.
- Create view.
- Save draft.
- Publish draft.
- Immutable published revision protection.
- Archive/restore.
- Duplicate view.
- Scope resolution.
- Missing capability diagnostics.
- Materialized snapshot creation.
- Diff generation.

### 23.2 Frontend unit/component tests

Add tests for:

- Views panel renders empty, active, archived, diagnostic states.
- Create View dialog validation.
- `definitionToFlow` adapter.
- `flowToDefinitionPatch` manual position extraction.
- ELK layout adapter with deterministic mocked layout.
- Capability node rendering.
- Annotation rendering.
- Dirty state changes.
- Read-only published state.
- Export render model escaping.

### 23.3 Integration tests

Add tests using a fixture workspace:

- Create view from selected root.
- Save draft and reopen.
- Publish and verify files.
- Rebuild projection and verify view list.
- Export SVG/HTML and verify metadata.

### 23.4 Manual test checklist

- Open workspace with no views.
- Create all-roots view.
- Create selected-root view.
- Add annotation.
- Change color mode.
- Drag nodes.
- Save and reopen.
- Auto-layout.
- Collapse subtree.
- Publish.
- Open published revision and verify read-only.
- Create draft from published.
- Archive and restore.
- Export SVG/HTML.
- Pull/reopen repository and verify views still load.

---

## 24. Package and dependency changes

Update `ui/package.json` dependencies:

```json
{
  "dependencies": {
    "@xyflow/react": "^12.10.2",
    "elkjs": "^0.11.1",
    "zod": "^4.0.0"
  }
}
```

Notes:

- Keep existing React, Dockview, Fluent UI, TanStack Query, and Zustand.
- `zod` is recommended but optional if the team prefers backend-only validation plus TypeScript types. If added, use it only at API boundaries and persisted definition parsing, not as a replacement for domain validation.
- Do not add `dagre` as the primary layout engine. ELK is the preferred default because it supports richer layered layout configuration and is suitable for directed hierarchical diagrams.
- Do not use a CDN import; dependencies must be bundled with the desktop app.

---

## 25. Suggested frontend file structure

```text
ui/src/views/
  ViewDesignerPanel.tsx
  ViewsPanel.tsx
  ViewCreateDialog.tsx
  ViewInspector.tsx
  ViewToolbar.tsx
  ViewRevisionHistory.tsx
  ViewRevisionDiff.tsx
  ViewDiagnostics.tsx
  nodes/
    CapabilityViewNode.tsx
    AnnotationNode.tsx
    LegendNode.tsx
  layout/
    elk-layout.ts
    layout-types.ts
  export/
    view-export.ts
    view-export.test.ts
  state/
    view-editor-store.ts
  adapters/
    react-flow-adapter.ts
    view-definition-adapter.ts
  types.ts
  validation.ts
```

Existing `CapabilityMapPanel` can either remain under `ui/src/components/` or be gradually migrated into this structure.

---

## 26. Suggested backend file structure

```text
src/ecm_studio/domain/
  views.py

src/ecm_studio/application/
  view_service.py

src/ecm_studio/infrastructure/
  views_repository.py
  view_projection.py
  view_exports.py
```

If current code style prefers fewer modules, these can be merged into existing files, but the separation of domain, application service, infrastructure, and UI bridge must remain clear.

---

## 27. Edge cases

- Workspace has no capabilities: View creation disabled except explanatory empty state.
- View root capability is retired: Allow in draft with warning; published view may include retired capabilities if intentionally selected.
- View root capability is missing: Show diagnostic and offer repair.
- Duplicate view name: Block.
- Draft file missing but registry says draft exists: Show diagnostic and allow recreating draft from latest published revision.
- Published definition file missing: Show severe diagnostic; do not remove revision metadata automatically.
- User drags a node hidden by scope filter: Not possible in UI; if file contains stale manual position, preserve but mark unused.
- Capability renamed after view draft created: Display new name because ID resolves to current model.
- Capability moved after view draft created: Scope should reflect current hierarchy unless draft pins a published snapshot.
- Published revision opened after model changes: Render snapshot, not current model, unless user chooses “compare to current model”.
- Export path unwritable: Fail with user-facing error; do not modify view.
- Git dirty on publish: Prefer checkpoint prompt.

---

## 28. Risks and mitigations

### Risk: Interactive canvas becomes a free-form drawing tool

Mitigation: Do not allow arbitrary capability-like boxes. All capability nodes must resolve to capability IDs. Use annotations for non-model content.

### Risk: Huge views perform poorly

Mitigation: Default max depth, large-view warnings, compact mode, static export path, and possible worker-based layout later.

### Risk: View versioning conflicts with Git versioning

Mitigation: Treat view revisioning as semantic product versioning and Git as storage/history. Published view revisions are immutable files in Git.

### Risk: Published revisions cannot be reproduced after model changes

Mitigation: Store materialized snapshot in published revision file and record model reference/hash.

### Risk: Implementation spreads business logic across React components

Mitigation: Isolate scope resolution, adapters, layout, validation, and export render model.

### Risk: Legacy Domain Designer expectations are unknown

Mitigation: This PRD defines the modern target independently. Legacy import/parity review can be a follow-up once the old schema/screens are available.

---

## 29. Codex implementation instructions

Codex should implement this feature in small PR-sized increments. Do not attempt a full rewrite of ECM Studio.

Hard rules:

1. Keep repository files as the source of truth.
2. Keep SQLite projection rebuildable.
3. Preserve existing model editing, Git, release, import/export, and static map behavior unless intentionally migrated with tests.
4. Add tests with each implementation slice.
5. Avoid large monolithic React components.
6. Avoid adding unbounded dependencies.
7. Do not use legacy Domain Designer code as runtime dependency.
8. Do not use external network/CDN assets.
9. Escape text in exports.
10. Refuse to overwrite published immutable revision files.

Recommended first PR:

- Add backend domain/storage/projection for views.
- Add fixture files.
- Add tests.
- Add no major UI beyond perhaps list API wiring.

Recommended second PR:

- Add Views panel and create/open draft flow.

Recommended third PR:

- Add React Flow designer with ELK auto-layout, save draft, and publish.

Recommended fourth PR:

- Add annotations, styling, diff, diagnostics, and export polish.

---

## 30. Definition of done

The feature is done when:

- Users can create multiple views in an ECM repository.
- Views survive application restart and repository reopen.
- Draft views can be edited interactively.
- View revisions can be published and are immutable/read-only.
- Published revisions record model reference and materialized snapshot.
- Views are indexed in SQLite and list/search is fast.
- Users can export SVG and HTML.
- Diagnostics identify missing/stale references.
- Existing ECM Studio tests pass.
- New backend and frontend tests cover the core flows.
- The implementation uses `@xyflow/react` and `elkjs` for interactive view design and layout unless a clearly documented blocker is found during implementation.

---

## 31. Reference links consulted

These links are included to help the implementer verify package choices and current ECM Studio architecture.

- ECM Studio public package: https://pypi.org/project/ecm-studio/
- ECM Studio public repository: https://github.com/ThomasRohde/ecm-studio
- ECM Studio UI package file: https://github.com/ThomasRohde/ecm-studio/blob/master/ui/package.json
- xyflow / React Flow overview: https://xyflow.com/
- React Flow docs: https://reactflow.dev/
- React Flow v12 migration: https://reactflow.dev/learn/troubleshooting/migrate-to-v12
- React Flow ELK example: https://reactflow.dev/examples/layout/elkjs
- `@xyflow/react` npm package: https://www.npmjs.com/package/@xyflow/react
- Eclipse Layout Kernel documentation: https://eclipse.dev/elk/documentation.html
- `elkjs` GitHub repository: https://github.com/kieler/elkjs
- `elkjs` npm package: https://www.npmjs.com/package/elkjs
- Dockview documentation: https://dockview.dev/
- Zustand documentation: https://zustand.docs.pmnd.rs/
- TanStack Query: https://tanstack.com/query/latest
- Zod documentation: https://zod.dev/
- Vitest documentation: https://vitest.dev/
- Playwright documentation: https://playwright.dev/
