from __future__ import annotations

import argparse
from pathlib import Path

from . import __version__


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ecms", description="ECM Studio desktop app")
    parser.add_argument("workspace", nargs="?", help="Workspace repository path to open")
    parser.add_argument("--dev-ui", help="Load UI from a Vite dev server URL")
    parser.add_argument("--version", action="store_true", help="Print version and exit")
    args = parser.parse_args(argv)

    if args.version:
        print(__version__)
        return 0

    from .desktop.app import run

    workspace = Path(args.workspace).resolve() if args.workspace else None
    return run(workspace=workspace, dev_ui=args.dev_ui)
