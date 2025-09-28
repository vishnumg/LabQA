#!/usr/bin/env python3
"""Seed script for LabQA.

Actions:
  - (Optionally) drop / truncate data tables (safe mode avoids dropping schema).
  - Insert sample branches, parameters, users (admin + technician), targets (versioned), and QC entries.

Usage:
  python scripts/seed.py --yes --with-qc
  python scripts/seed.py --reset-hard  # issues TRUNCATE CASCADE

Environment:
  Requires DATABASE_URL and JWT_SECRET (only for consistency if app imports) to be set.

Notes:
  Uses SQLModel session & raw SQL for truncate for speed.
"""
from __future__ import annotations
import argparse
import os
import sys
import uuid
import datetime as dt
from sqlmodel import Session

# Local imports
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from backend import db  # noqa: E402
from backend.models import Branch, User, Parameter, Target, QcEntry  # noqa: E402


def confirm(prompt: str) -> bool:
    try:
        return input(prompt + ' [y/N]: ').strip().lower() == 'y'
    except EOFError:
        return False


def truncate_all(session: Session, hard: bool):
    conn = session.exec("SELECT 1").session.get_bind()  # type: ignore
    with conn.begin():  # type: ignore
        if hard:
            conn.exec_driver_sql(
                "TRUNCATE TABLE qc_entries, targets, users, parameters, branches RESTART IDENTITY CASCADE;")
        else:
            for table in ["qc_entries", "targets", "users", "parameters", "branches"]:
                conn.exec_driver_sql(f"DELETE FROM {table};")


def seed(session: Session, with_qc: bool):
    # Branches
    b_main = Branch(id=uuid.uuid4(), name="Main Lab")
    b_east = Branch(id=uuid.uuid4(), name="East Wing")
    session.add_all([b_main, b_east])

    # Parameters
    p_glu = Parameter(id="GLU", name="Glucose", unit="mg/dL")
    p_hba1c = Parameter(id="HBA1C", name="HbA1c", unit="%")
    p_cho = Parameter(id="CHO", name="Cholesterol", unit="mg/dL")
    session.add_all([p_glu, p_hba1c, p_cho])

    # Users (password: admin123 / tech123)
    import bcrypt
    admin_pw = bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode()
    tech_pw = bcrypt.hashpw(b"tech123", bcrypt.gensalt()).decode()
    u_admin = User(id=uuid.uuid4(), email="admin@example.com",
                   password_hash=admin_pw, role="admin", branch_id=None)
    u_tech = User(id=uuid.uuid4(), email="tech@example.com",
                  password_hash=tech_pw, role="technician", branch_id=b_main.id)
    session.add_all([u_admin, u_tech])

    # Targets (two versions for GLU L1 in main branch to demo effective endpoint)
    today = dt.date.today()
    earlier = today - dt.timedelta(days=60)
    session.add_all([
        Target(branch_id=b_main.id, parameter_id="GLU",
               level="L1", valid_from=earlier, mean=100.0, sd=5.0),
        Target(branch_id=b_main.id, parameter_id="GLU", level="L1",
               valid_from=today - dt.timedelta(days=10), mean=102.0, sd=4.8),
        Target(branch_id=b_main.id, parameter_id="GLU",
               level="L2", valid_from=earlier, mean=150.0, sd=7.0),
        Target(branch_id=b_east.id, parameter_id="GLU",
               level="L1", valid_from=earlier, mean=98.0, sd=5.2),
        Target(branch_id=b_main.id, parameter_id="HBA1C",
               level="L1", valid_from=earlier, mean=5.2, sd=0.3),
        Target(branch_id=b_main.id, parameter_id="CHO",
               level="L1", valid_from=earlier, mean=180.0, sd=9.0),
    ])

    if with_qc:
        # Generate 30 days GLU L1/L2 QC entries for main branch
        for i in range(30):
            d = today - dt.timedelta(days=29 - i)
            session.add(QcEntry(
                id=uuid.uuid4(),
                date=d,
                parameter="GLU",
                branch=b_main.id,
                level="L1",
                value=100 + (i % 5) - 2,  # small variation
                entered_by=str(u_admin.id),
                entered_at=dt.datetime.utcnow(),
            ))
            session.add(QcEntry(
                id=uuid.uuid4(),
                date=d,
                parameter="GLU",
                branch=b_main.id,
                level="L2",
                value=150 + (i % 7) - 3,
                entered_by=str(u_admin.id),
                entered_at=dt.datetime.utcnow(),
            ))
    session.commit()


def main():
    parser = argparse.ArgumentParser(description="Seed the LabQA database")
    parser.add_argument("--yes", action="store_true", help="Skip confirmation prompts")
    parser.add_argument("--reset-hard", action="store_true",
                        help="Use TRUNCATE CASCADE instead of DELETE")
    parser.add_argument("--with-qc", action="store_true", help="Insert sample QC entries")
    args = parser.parse_args()

    if not os.getenv("DATABASE_URL"):
        print("DATABASE_URL not set", file=sys.stderr)
        return 1

    if not args.yes and not confirm("Proceed with seeding? This will erase existing data."):
        print("Aborted.")
        return 1

    engine = db.get_engine()
    with Session(engine) as session:  # type: ignore
        truncate_all(session, hard=args.reset_hard)
        seed(session, with_qc=args.with_qc)

    print("Seed complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
