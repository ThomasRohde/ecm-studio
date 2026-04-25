# ECM Studio Stress Demo

This directory is a ready-to-open ECM Studio workspace for performance and workflow testing.

## Contents

- `stress-workspace\ecm-studio.json`: workspace metadata.
- `stress-workspace\ecm\capabilities.jsonl`: deterministic stress-test capability model.
- `stress-workspace\ecm\*.jsonl`: supporting durable JSONL files, empty for this demo.

## Model Shape

- Total capabilities: 3180
- Root domains: 12
- Level 2 capabilities per domain: 8
- Level 3 capabilities per level 2: 8
- Leaf capabilities per level 3: 3

The model intentionally includes searchable metadata across aliases, tags, domains, lifecycle statuses, steward IDs, and steward departments.

## Usage

Open `demos/stress-workspace` from ECM Studio, then use rebuild index, tree navigation, search, export, and Git checkpoint workflows.

Useful searches: `workflow`, `customer`, `risk`, `steward-3`, `continuous improvement`, `data capture`.
