from sqlalchemy import desc, text  # may be unused after change; kept if needed
from sqlmodel import select, Session
import bcrypt
from dotenv import load_dotenv
from backend import db
from backend.models import Branch, User, Target, QcEntry, Parameter
import os
import sys
import uuid
import random
import datetime as dt
from typing import Dict, Tuple

# Ensure project root on sys.path for 'backend' package BEFORE importing backend
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if root not in sys.path:
    sys.path.insert(0, root)


PARAMETERS = [
    {"id": "glucose", "name": "Glucose", "unit": "mg/dL"},
    {"id": "hba1c", "name": "HbA1c", "unit": "%"},
    {"id": "cholesterol", "name": "Total Cholesterol", "unit": "mg/dL"},
    {"id": "triglycerides", "name": "Triglycerides", "unit": "mg/dL"},
]


def upsert_branch(session: Session, name: str) -> uuid.UUID:
    row = session.exec(select(Branch).where(Branch.name == name)).first()
    if row:
        return row.id
    b = Branch(id=uuid.uuid4(), name=name)
    session.add(b)
    session.commit()
    session.refresh(b)
    return b.id


def upsert_user(session: Session, email: str, password: str, role: str, branch_id: uuid.UUID | None):
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        return existing.id
    u = User(id=uuid.uuid4(), email=email, password_hash=pw_hash, role=role, branch_id=branch_id)
    session.add(u)
    session.commit()
    return u.id


def default_target_for(parameter_id: str, level: str) -> Tuple[float, float]:
    if parameter_id == "glucose":
        mean = 80 if level == "L1" else 150 if level == "L2" else 300
        sd = 4 if level == "L1" else 7 if level == "L2" else 15
    elif parameter_id == "hba1c":
        mean = 5.0 if level == "L1" else 7.5 if level == "L2" else 10.0
        sd = 0.3 if level == "L1" else 0.4 if level == "L2" else 0.5
    elif parameter_id == "cholesterol":
        mean = 150 if level == "L1" else 200 if level == "L2" else 300
        sd = 8 if level == "L1" else 10 if level == "L2" else 15
    else:
        mean = 100 if level == "L1" else 200 if level == "L2" else 400
        sd = 5 if level == "L1" else 10 if level == "L2" else 20
    return float(mean), float(sd)


def set_targets(session: Session, branch_ids: list[uuid.UUID], valid_from: str, deltas: Dict[Tuple[str, str], Tuple[float, float]] | None = None):
    for bid in branch_ids:
        for p in PARAMETERS:
            for level in ("L1", "L2", "L3"):
                mean, sd = default_target_for(p["id"], level)
                if deltas and (p["id"], level) in deltas:
                    d_mean, d_sd = deltas[(p["id"], level)]
                    mean += d_mean
                    sd += d_sd
                # Convert valid_from ISO string to date for composite key lookup
                vf_date_for_key = dt.date.fromisoformat(valid_from)
                row = session.get(Target, (bid, p["id"], level, vf_date_for_key))
                if row:
                    row.mean = mean
                    row.sd = sd
                else:
                    # valid_from expected as ISO string -> convert to date
                    vf_date = dt.date.fromisoformat(valid_from)
                    session.add(
                        Target(branch_id=bid, parameter_id=p["id"], level=level, mean=mean, sd=sd, valid_from=vf_date))
    session.commit()


def gen_value(mean: float, sd: float, z: float | None = None) -> float:
    if z is None:
        return random.gauss(mean, sd)
    return mean + z * sd


def seed_month_qc(session: Session, branch_ids: list[uuid.UUID], start_date: dt.date, days: int, mid_update_date: dt.date):
    # Generate QC entries across parameters/levels for each day and branch.
    # Stagger levels: L1 on day 0,3,6..., L2 on day 1,4,7..., L3 on day 2,5,8...
    # Insert specific patterns for alerts around some dates.
    random.seed(42)
    for d in range(days):
        day = start_date + dt.timedelta(days=d)
        day_str = day.isoformat()
        # Determine which level to generate based on day modulo 3
        level_index = d % 3
        level = ["L1", "L2", "L3"][level_index]

        for bid in branch_ids:
            for p in PARAMETERS:
                # Effective target is the latest with valid_from <= day
                t = session.exec(
                    select(Target)
                    .where(
                        Target.branch_id == bid,
                        Target.parameter_id == p["id"],
                        Target.level == level,
                        Target.valid_from <= day,
                    )
                    .order_by(Target.valid_from.desc())  # type: ignore[attr-defined]
                ).first()
                if t:
                    mean, sd = (t.mean, t.sd)
                else:
                    mean, sd = default_target_for(p["id"], level)
                z = None
                # Inject scenarios (adjusted for staggered days):
                # - 1_3s: single >3SD on day 15 (L1) for cholesterol L1 (XYZ)
                if p["id"] == "cholesterol" and level == "L1" and d == 15 and bid == branch_ids[1]:
                    z = 3.2
                # - 2_2s: two consecutive >2SD (same side) for glucose L2 (ABC) on days 10,13 (L2 days)
                if p["id"] == "glucose" and level == "L2" and d in (10, 13) and bid == branch_ids[0]:
                    z = 2.3
                # - R_4s: consecutive range >=4SD for triglycerides L3 (ABC) day 14,17 (L3 days)
                if p["id"] == "triglycerides" and level == "L3" and bid == branch_ids[0]:
                    if d == 14:
                        z = -2.2
                    if d == 17:
                        z = 2.2
                # - 4_1s: four consecutive >1SD same side for HbA1c L1 (XYZ) days 18,21,24,27 (L1 days)
                if p["id"] == "hba1c" and level == "L1" and bid == branch_ids[1] and d in (18, 21, 24, 27):
                    z = 1.3
                # - 10_x: ten consecutive on same side for glucose L1 (ABC) days 0,3,6,9,12,15,18,21,24,27 (first 10 L1 days)
                if p["id"] == "glucose" and level == "L1" and bid == branch_ids[0] and d in (0, 3, 6, 9, 12, 15, 18, 21, 24, 27):
                    z = 0.6
                # - Normal days: mild noise
                value = gen_value(mean, sd, z)
                session.add(QcEntry(
                    id=uuid.uuid4(),
                    date=day,
                    parameter=p["id"],
                    branch=bid,
                    level=level,
                    value=round(value, 2),
                    entered_by="seed",
                    entered_at=dt.datetime.utcnow(),
                ))

        # On mid_update_date, after inserting that day's rows, add a versioned target for ABC branch (branch_ids[0])
        if day == mid_update_date:
            # Slightly adjust glucose means and sds to simulate recalibration
            deltas = {("glucose", "L1"): (2.0, 0.5), ("glucose", "L2")                      : (3.0, 1.0), ("glucose", "L3"): (5.0, 2.0)}
            set_targets(session, [branch_ids[0]], valid_from=day_str, deltas=deltas)
            # No need to refresh map; we query effective targets per day

        # Additional staggered mid-month updates to simulate maintenance/recalibration across sites
        if day == (mid_update_date + dt.timedelta(days=2)):
            # XYZ HbA1c drifts up slightly; increase means and minor SD increase
            deltas_xyz_hba1c = {
                ("hba1c", "L1"): (0.2, 0.05),
                ("hba1c", "L2"): (0.3, 0.05),
                ("hba1c", "L3"): (0.4, 0.05),
            }
            set_targets(session, [branch_ids[1]], valid_from=day_str, deltas=deltas_xyz_hba1c)

        if day == (mid_update_date + dt.timedelta(days=5)):
            # ABC Cholesterol maintenance; mean slightly corrected down, SD tightened
            deltas_abc_chol = {
                ("cholesterol", "L1"): (-5.0, -1.0),
                ("cholesterol", "L2"): (-3.0, -1.0),
                ("cholesterol", "L3"): (-10.0, -2.0),
            }
            set_targets(session, [branch_ids[0]], valid_from=day_str, deltas=deltas_abc_chol)

        if day == (mid_update_date + dt.timedelta(days=7)):
            # XYZ Triglycerides reagent lot change; higher mean and higher SD
            deltas_xyz_trig = {
                ("triglycerides", "L1"): (15.0, 3.0),
                ("triglycerides", "L2"): (20.0, 4.0),
                ("triglycerides", "L3"): (25.0, 5.0),
            }
            set_targets(session, [branch_ids[1]],
                        valid_from=day.isoformat(), deltas=deltas_xyz_trig)
    session.commit()


def main():
    load_dotenv()
    if not os.getenv("DATABASE_URL"):
        raise SystemExit("DATABASE_URL not set")
    # Expect migrations already applied externally
    engine = db.get_engine()
    with Session(engine) as session:  # type: ignore
        # Truncate tables before seeding (in correct order to respect foreign keys)
        print("Truncating existing data...")
        session.connection().execute(text("TRUNCATE TABLE qc_entries CASCADE"))
        session.connection().execute(text("TRUNCATE TABLE targets CASCADE"))
        session.connection().execute(text("TRUNCATE TABLE users CASCADE"))
        session.connection().execute(text("TRUNCATE TABLE branches CASCADE"))
        session.connection().execute(text("TRUNCATE TABLE parameters CASCADE"))
        session.commit()
        print("Tables truncated.")

        # Upsert parameters first
        for p in PARAMETERS:
            if not session.get(Parameter, p["id"]):
                session.add(Parameter(id=p["id"], name=p["name"], unit=p["unit"]))
        session.commit()

        abc_id = upsert_branch(session, "ABC Lab - Pattom")
        xyz_id = upsert_branch(session, "XYZ Lab - Ulloor")

        # Create admin user (no branch association)
        upsert_user(session, "admin@labqa.in", os.getenv("ADMIN_PASSWORD",
                    "ChangeMe123!"), "admin", None)

        upsert_user(session, "tech@abc.in", os.getenv("TECH_ABC_PASSWORD",
                    "ChangeMe123!"), "technician", abc_id)
        upsert_user(session, "tech@xyz.in", os.getenv("TECH_XYZ_PASSWORD",
                    "ChangeMe123!"), "technician", xyz_id)

        today = dt.date.today()
        start = today - dt.timedelta(days=29)
        mid = start + dt.timedelta(days=15)
        set_targets(session, [abc_id, xyz_id], valid_from=start.isoformat())
        seed_month_qc(session, [abc_id, xyz_id], start_date=start, days=30, mid_update_date=mid)

        print("Demo data seeded:")
        print("  Branches:", str(abc_id), str(xyz_id))
        print("  Users:")
        print("    - admin@labqa.in (role: admin, password: ChangeMe123!)")
        print("    - tech@abc.in (role: technician, password: ChangeMe123!)")
        print("    - tech@xyz.in (role: technician, password: ChangeMe123!)")
        print("  QC: 30 days with alert scenarios & versioned targets")


if __name__ == "__main__":
    main()
