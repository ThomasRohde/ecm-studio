from __future__ import annotations

import hashlib
import re
import sqlite3
from collections.abc import Iterable
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from ecm_workbench.domain.capabilities import capability_path
from ecm_workbench.domain.models import Capability

from .repository import CapabilityRepository
from .workspace import WorkspaceRepository

TOKEN_RE = re.compile(r"[A-Za-z0-9_]+")


@dataclass(frozen=True)
class RebuildResult:
    capability_count: int
    source_hash: str

    def to_dict(self) -> dict:
        return {"capability_count": self.capability_count, "source_hash": self.source_hash}


class SQLiteProjection:
    def __init__(self, workspace: WorkspaceRepository) -> None:
        self.workspace = workspace
        self.db_path = workspace.paths.sqlite_file

    def connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def rebuild(self) -> RebuildResult:
        repo = CapabilityRepository(self.workspace.paths.capabilities_file)
        capabilities, errors = repo.load()
        if errors:
            from ecm_workbench.domain.errors import JsonlParseFailed

            raise JsonlParseFailed(errors)
        source_hash = self._hash_file(self.workspace.paths.capabilities_file)
        with closing(self.connect()) as conn:
            self._create_schema(conn)
            self._clear(conn)
            self._insert_capabilities(conn, capabilities)
            conn.execute(
                """
                INSERT INTO projection_meta(key, value)
                VALUES('source_hash', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value
                """,
                (source_hash,),
            )
            conn.execute(
                """
                INSERT INTO projection_meta(key, value)
                VALUES('capability_count', ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value
                """,
                (str(len(capabilities)),),
            )
            conn.commit()
        return RebuildResult(capability_count=len(capabilities), source_hash=source_hash)

    def is_current(self) -> bool:
        if not self.db_path.exists():
            return False
        try:
            with closing(self.connect()) as conn:
                row = conn.execute(
                    "SELECT value FROM projection_meta WHERE key='source_hash'"
                ).fetchone()
        except sqlite3.DatabaseError:
            return False
        return bool(row and row["value"] == self._hash_file(self.workspace.paths.capabilities_file))

    def list_capabilities(self) -> list[dict]:
        with closing(self.connect()) as conn:
            try:
                rows = conn.execute(
                    "SELECT * FROM capabilities ORDER BY path_sort, name COLLATE NOCASE"
                ).fetchall()
            except sqlite3.DatabaseError:
                self.rebuild()
                rows = conn.execute(
                    "SELECT * FROM capabilities ORDER BY path_sort, name COLLATE NOCASE"
                ).fetchall()
        return [dict(row) for row in rows]

    def search(self, query: str) -> list[dict]:
        q = query.strip().lower()
        if not q:
            return self.list_capabilities()[:100]
        like = f"%{q}%"
        with closing(self.connect()) as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT c.*
                FROM capabilities c
                LEFT JOIN search_tokens st ON st.capability_id = c.id
                WHERE lower(c.name) LIKE ?
                   OR lower(c.aliases) LIKE ?
                   OR lower(c.tags) LIKE ?
                   OR lower(c.domain) LIKE ?
                   OR lower(c.steward_id) LIKE ?
                   OR st.token LIKE ?
                ORDER BY c.path_sort, c.name COLLATE NOCASE
                LIMIT 100
                """,
                (like, like, like, like, like, like),
            ).fetchall()
        return [dict(row) for row in rows]

    def _create_schema(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projection_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS capabilities (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              parent_id TEXT,
              path TEXT NOT NULL,
              path_sort TEXT NOT NULL,
              depth INTEGER NOT NULL,
              aliases TEXT NOT NULL,
              description TEXT NOT NULL,
              domain TEXT NOT NULL,
              type TEXT NOT NULL,
              lifecycle_status TEXT NOT NULL,
              tags TEXT NOT NULL,
              steward_id TEXT NOT NULL,
              steward_department TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS hierarchy_paths (
              ancestor_id TEXT NOT NULL,
              descendant_id TEXT NOT NULL,
              depth INTEGER NOT NULL,
              PRIMARY KEY (ancestor_id, descendant_id)
            );
            CREATE TABLE IF NOT EXISTS search_tokens (
              token TEXT NOT NULL,
              capability_id TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS diagnostics (
              code TEXT NOT NULL,
              message TEXT NOT NULL,
              severity TEXT NOT NULL,
              path TEXT,
              line INTEGER
            );
            CREATE TABLE IF NOT EXISTS mappings (
              id TEXT PRIMARY KEY,
              capability_id TEXT,
              payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS change_requests (
              id TEXT PRIMARY KEY,
              status TEXT,
              payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS releases (
              id TEXT PRIMARY KEY,
              label TEXT,
              payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_capabilities_parent ON capabilities(parent_id);
            CREATE INDEX IF NOT EXISTS idx_capabilities_name ON capabilities(name);
            CREATE INDEX IF NOT EXISTS idx_search_tokens ON search_tokens(token);
            """
        )

    def _clear(self, conn: sqlite3.Connection) -> None:
        for table in [
            "capabilities",
            "hierarchy_paths",
            "search_tokens",
            "diagnostics",
            "mappings",
            "change_requests",
            "releases",
        ]:
            conn.execute(f"DELETE FROM {table}")

    def _insert_capabilities(
        self, conn: sqlite3.Connection, capabilities: list[Capability]
    ) -> None:
        for capability in capabilities:
            path_items = capability_path(capabilities, capability.id)
            path_names = [item.name for item in path_items]
            path_ids = [item.id for item in path_items]
            conn.execute(
                """
                INSERT INTO capabilities(
                  id, name, parent_id, path, path_sort, depth, aliases, description, domain,
                  type, lifecycle_status, tags, steward_id, steward_department, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    capability.id,
                    capability.name,
                    capability.parent_id,
                    " / ".join(path_names),
                    "/".join(
                        f"{item.order:05d}-{item.name.lower()}-{item.id}" for item in path_items
                    ),
                    len(path_items) - 1,
                    "\n".join(capability.aliases),
                    capability.description,
                    capability.domain,
                    capability.type,
                    capability.lifecycle_status,
                    "\n".join(capability.tags),
                    capability.steward_id,
                    capability.steward_department,
                    capability.updated_at,
                ),
            )
            for depth, ancestor_id in enumerate(path_ids):
                conn.execute(
                    """
                    INSERT INTO hierarchy_paths(ancestor_id, descendant_id, depth)
                    VALUES (?, ?, ?)
                    """,
                    (ancestor_id, capability.id, len(path_ids) - depth - 1),
                )
            for token in self._tokens(capability):
                conn.execute(
                    "INSERT INTO search_tokens(token, capability_id) VALUES (?, ?)",
                    (token, capability.id),
                )

    def _tokens(self, capability: Capability) -> Iterable[str]:
        text = " ".join(
            [
                capability.name,
                capability.description,
                capability.domain,
                capability.steward_id,
                capability.steward_department,
                " ".join(capability.aliases),
                " ".join(capability.tags),
            ]
        )
        yield from TOKEN_RE.findall(text.lower())

    def _hash_file(self, path: Path) -> str:
        if not path.exists():
            return ""
        return hashlib.sha256(path.read_bytes()).hexdigest()
