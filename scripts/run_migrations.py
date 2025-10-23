#!/usr/bin/env python
"""Simple migration runner for SQL files in db/migrations.

Usage:
  python scripts/run_migrations.py            # apply (idempotent) migrations
  python scripts/run_migrations.py --reset    # drop known tables then re-apply

Environment:
  Requires DATABASE_URL in environment (.env loaded automatically if present)
"""
from __future__ import annotations
import os
import sys
from pathlib import Path
import argparse
import psycopg2
from psycopg2.extensions import connection as _PGConn
from dotenv import load_dotenv

# Ensure project root on path
root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

load_dotenv()

KNOWN_TABLES = [
    "qc_entries",
    "targets",
    "users",
    "branches",
    "parameters",  # created in 003
]


def get_conn() -> _PGConn:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL not set")
    return psycopg2.connect(url)


def drop_tables(conn: _PGConn):
    cur = conn.cursor()
    for t in KNOWN_TABLES:
        cur.execute(f"DROP TABLE IF EXISTS {t} CASCADE;")
    conn.commit()
    cur.close()


def apply_migrations(conn: _PGConn, migrations_path: Path):
    cur = conn.cursor()
    for sql_file in sorted(migrations_path.glob("*.sql")):
        with open(sql_file, "r") as f:
            sql_text = f.read()
        print(f"Applying {sql_file.name}...")
        cur.execute(sql_text)
    conn.commit()
    cur.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true",
                        help="Drop known tables before applying migrations")
    args = parser.parse_args()

    migrations_dir = root / "db" / "migrations"
    if not migrations_dir.exists():
        raise SystemExit("migrations directory not found")

    conn = get_conn()
    try:
        if args.reset:
            print("--reset specified: dropping tables...")
            drop_tables(conn)
        apply_migrations(conn, migrations_dir)
        print("Migrations applied successfully")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
