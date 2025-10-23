"""Database access helpers (Postgres required).

This module now enforces a real Postgres database. No in‑memory fallback
remains. A missing or invalid `DATABASE_URL` should surface immediately
so deployment misconfiguration is caught early.
"""
from __future__ import annotations
from psycopg2.extras import RealDictCursor  # type: ignore

import os
import logging
from typing import Optional, Dict, Any, Generator
from sqlmodel import create_engine, Session

try:  # pragma: no cover - import guard
    import psycopg2  # type: ignore
except Exception:  # If psycopg2 not available, we still allow memory fallback
    psycopg2 = None  # type: ignore

logger = logging.getLogger(__name__)

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        dsn = os.getenv("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL not set")
        # Normalize DSN for SQLAlchemy psycopg2 driver usage
        if dsn.startswith("postgres://"):
            dsn_sa = dsn.replace("postgres://", "postgresql+psycopg2://", 1)
        elif dsn.startswith("postgresql://") and "+" not in dsn:
            dsn_sa = dsn.replace("postgresql://", "postgresql+psycopg2://", 1)
        else:
            dsn_sa = dsn
        _engine = create_engine(dsn_sa, pool_pre_ping=True)
    return _engine


def session() -> Generator[Session, None, None]:
    eng = get_engine()
    with Session(eng) as s:  # type: ignore
        yield s


def _fetch_user_postgres(email: str) -> Optional[Dict[str, Any]]:
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL not set")
    if not psycopg2:  # pragma: no cover
        raise RuntimeError("psycopg2 not installed in runtime")
    with psycopg2.connect(dsn) as conn:  # type: ignore
        with conn.cursor(cursor_factory=RealDictCursor) as cur:  # type: ignore
            cur.execute(
                "SELECT id, email, password_hash, role, branch_id FROM users WHERE email=%s",
                (email,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def fetch_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Return user row from Postgres or None.

    Raises RuntimeError if DATABASE_URL / psycopg2 absent.
    """
    return _fetch_user_postgres(email.strip().lower())


def get_conn():  # Optional convenience if later code needs raw connection
    dsn = os.getenv("DATABASE_URL")
    if not dsn or not psycopg2:
        raise RuntimeError("DATABASE_URL not available")
    return psycopg2.connect(dsn)  # type: ignore
