from fastapi import FastAPI, Header, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from uuid import uuid4
import datetime as dt
import bcrypt

from backend import db
from backend.models import Branch, Target, QcEntry, User, Parameter
import uuid
from backend import schemas
from sqlmodel import select
from backend.jwt_utils import issue_token, verify_token

app = FastAPI(title="LabQA API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/auth/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, session=Depends(db.session)):
    stmt = select(User).where(User.email == payload.email.lower())
    user = session.exec(stmt).first()
    if not user or not bcrypt.checkpw(payload.password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = issue_token(sub=str(user.id), role=user.role, branch_id=str(
        user.branch_id) if user.branch_id else None)
    return schemas.TokenResponse(token=token)


@app.get("/api/example")
def example(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ", 1)[1]
    try:
        claims = verify_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"ok": True, "role": claims.get("role"), "branch_id": claims.get("branch_id")}


@app.get("/api/ping")
def ping():
    return {"pong": True}


# ---------------------------------------------------------------------------
# Auth helpers

def _require_auth(authorization: str | None):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ", 1)[1]
    try:
        claims = verify_token(token)
    except Exception:  # pragma: no cover
        raise HTTPException(status_code=401, detail="Unauthorized")
    return claims


ALLOWED_LEVELS = {"L1", "L2", "L3"}


def _conn():
    return db.get_conn()


# ---------------------------------------------------------------------------
# Branches & Parameters

@app.get("/api/branches", response_model=schemas.BranchList)
def list_branches(authorization: str | None = Header(default=None), session=Depends(db.session)):
    claims = _require_auth(authorization)
    statement = select(Branch).order_by(Branch.name)
    branches = session.exec(statement).all()
    if claims.get("role") == "technician" and claims.get("branch_id"):
        branches = [b for b in branches if str(b.id) == claims.get("branch_id")]
    return schemas.BranchList(items=[schemas.BranchOut(id=str(b.id), name=b.name) for b in branches])


@app.get("/api/parameters", response_model=schemas.ParameterList)
def list_parameters(authorization: str | None = Header(default=None), session=Depends(db.session)):
    _require_auth(authorization)
    rows = session.exec(select(Parameter).order_by(Parameter.id)).all()
    return schemas.ParameterList(items=[schemas.ParameterOut(id=p.id, name=p.name, unit=p.unit) for p in rows])


# ---------------------------------------------------------------------------
# Targets (versioned)

@app.get("/api/targets", response_model=schemas.TargetList)
def get_targets(authorization: str | None = Header(default=None), session=Depends(db.session)):
    _require_auth(authorization)
    rows = session.exec(
        select(Target).order_by(  # type: ignore[arg-type]
            # type: ignore[arg-type]
            Target.branch_id, Target.parameter_id, Target.level, Target.valid_from
        )
    ).all()
    return schemas.TargetList(
        items=[
            schemas.TargetVersion(
                branch_id=str(t.branch_id),
                parameter_id=t.parameter_id,
                level=t.level,
                validFrom=t.valid_from,
                mean=t.mean,
                sd=t.sd,
            )
            for t in rows
        ]
    )


@app.put("/api/targets", response_model=schemas.UpsertResponse)
def upsert_target(payload: schemas.TargetUpsert, authorization: str | None = Header(default=None), session=Depends(db.session)):
    claims = _require_auth(authorization)
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    if payload.level not in ALLOWED_LEVELS:
        raise HTTPException(status_code=400, detail="Invalid level")
    # Parameter existence check
    if not session.get(Parameter, payload.parameter_id):
        raise HTTPException(status_code=400, detail="Unknown parameter_id")
    existing = session.get(Target, (payload.branch_id, payload.parameter_id,
                           payload.level, payload.validFrom))
    if existing:
        existing.mean = payload.mean
        existing.sd = payload.sd
    else:
        session.add(
            Target(
                branch_id=uuid.UUID(str(payload.branch_id)),
                parameter_id=payload.parameter_id,
                level=payload.level,
                valid_from=payload.validFrom,
                mean=payload.mean,
                sd=payload.sd,
            )
        )
    session.commit()
    return schemas.UpsertResponse(ok=True)


# ---------------------------------------------------------------------------
# QC Entries

@app.get("/api/qc", response_model=schemas.QcList)
def list_qc(
    authorization: str | None = Header(default=None),
    branch_id: Optional[str] = Query(default=None),
    parameter_id: Optional[str] = Query(default=None),
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    session=Depends(db.session),
):
    claims = _require_auth(authorization)
    stmt = select(QcEntry)
    if branch_id:
        stmt = stmt.where(QcEntry.branch == branch_id)
    if parameter_id:
        stmt = stmt.where(QcEntry.parameter == parameter_id)
    if start:
        try:
            start_date = dt.date.fromisoformat(start)
            stmt = stmt.where(QcEntry.date >= start_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start date")
    if end:
        try:
            end_date = dt.date.fromisoformat(end)
            stmt = stmt.where(QcEntry.date <= end_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end date")
    if claims.get("role") == "technician" and claims.get("branch_id"):
        if branch_id and branch_id != claims.get("branch_id"):
            raise HTTPException(status_code=403, detail="Forbidden (branch scope)")
        stmt = stmt.where(QcEntry.branch == claims.get("branch_id"))
    stmt = stmt.order_by(QcEntry.date)  # type: ignore[arg-type]
    total = session.exec(select(QcEntry).where(stmt.whereclause)
                         if stmt.whereclause is not None else select(QcEntry)).all()
    rows = session.exec(stmt.limit(limit).offset(offset)).all()
    return schemas.QcList(items=[
        schemas.QcEntryOut(
            id=str(r.id),
            date=r.date,
            parameter=r.parameter,
            branch=str(r.branch),
            level=r.level,
            value=r.value,
            enteredBy=r.entered_by,
            enteredAt=r.entered_at,
        ) for r in rows
    ], total=len(total), limit=limit, offset=offset)


@app.post("/api/qc", response_model=schemas.QcBulkResponse)
def create_qc(payload: schemas.QcBulkCreate, authorization: str | None = Header(default=None), session=Depends(db.session)):
    claims = _require_auth(authorization)
    role = claims.get("role")
    if role not in {"admin", "technician"}:
        raise HTTPException(status_code=403, detail="Forbidden")
    user_branch = claims.get("branch_id")
    now = dt.datetime.utcnow()
    inserted = 0
    for e in payload.entries:
        if e.level not in ALLOWED_LEVELS:
            raise HTTPException(status_code=400, detail=f"Invalid level: {e.level}")
        if not session.get(Parameter, e.parameter):
            raise HTTPException(status_code=400, detail=f"Unknown parameter: {e.parameter}")
        if role == "technician" and user_branch and e.branch != user_branch:
            raise HTTPException(status_code=403, detail="Forbidden (branch scope)")
        session.add(QcEntry(
            id=uuid4(),
            date=e.date,
            parameter=e.parameter,
            branch=uuid.UUID(str(e.branch)),
            level=e.level,
            value=e.value,
            entered_by=claims.get("sub"),
            entered_at=now,
        ))
        inserted += 1
    session.commit()
    return schemas.QcBulkResponse(inserted=inserted)


# ---------------------------------------------------------------------------
# Effective targets endpoint

@app.get("/api/targets/effective", response_model=schemas.TargetList)
def effective_targets(
    authorization: str | None = Header(default=None),
    date: Optional[str] = Query(default=None),
    branch_id: Optional[str] = Query(default=None),
    parameter_id: Optional[str] = Query(default=None),
    session=Depends(db.session),
):
    _require_auth(authorization)
    # Parse date (default today)
    if date:
        try:
            target_date = dt.date.fromisoformat(date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
    else:
        target_date = dt.date.today()
    stmt = select(Target)
    if branch_id:
        stmt = stmt.where(Target.branch_id == branch_id)
    if parameter_id:
        stmt = stmt.where(Target.parameter_id == parameter_id)
    rows = session.exec(stmt).all()
    # Choose latest valid_from <= target_date per (branch, parameter, level)
    chosen = {}
    for t in rows:
        if t.valid_from <= target_date:
            key = (t.branch_id, t.parameter_id, t.level)
            prev = chosen.get(key)
            if not prev or prev.valid_from < t.valid_from:
                chosen[key] = t
    result = [schemas.TargetVersion(
        branch_id=str(v.branch_id),
        parameter_id=v.parameter_id,
        level=v.level,
        validFrom=v.valid_from,
        mean=v.mean,
        sd=v.sd,
    ) for v in chosen.values()]
    # Sort for deterministic order
    result.sort(key=lambda x: (x.branch_id, x.parameter_id, x.level, x.validFrom))
    return schemas.TargetList(items=result)
