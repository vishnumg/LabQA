from fastapi import FastAPI, Header, HTTPException, Query, Depends, Response, Body, Cookie, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from uuid import uuid4
import datetime as dt
import bcrypt
import os
import hmac
import hashlib
import base64 as _b64
import json
import urllib.request
import urllib.parse
import time
import base64
# Removed BytesIO import (no longer needed after removing non-GDoc export modes)
from sqlmodel import select
from backend import db, schemas
from backend.models import Branch, Target, QcEntry, User, Parameter
import uuid

SECRET = os.getenv('LABQA_AUTH_SECRET', 'dev-insecure-secret')
TOKEN_TTL_SECONDS = 60 * 60 * 8  # 8h


def _sign(parts: list[str]) -> str:
    mac = hmac.new(SECRET.encode(), ('|'.join(parts)).encode(), hashlib.sha256).digest()
    return _b64.urlsafe_b64encode(mac).decode().rstrip('=')


def _b64e(data: str) -> str:
    return _b64.urlsafe_b64encode(data.encode()).decode().rstrip('=')


def _b64d(data: str) -> str:
    pad = '=' * (-len(data) % 4)
    return _b64.urlsafe_b64decode(data + pad).decode()


def issue_token(user: User) -> str:
    now = int(time.time())
    exp = now + TOKEN_TTL_SECONDS
    payload = json.dumps({'sub': str(user.id), 'email': user.email, 'role': user.role, 'branch_id': str(
        user.branch_id) if getattr(user, 'branch_id', None) else None, 'exp': exp})
    b = _b64e(payload)
    sig = _sign([b])
    return f"v1.{b}.{sig}"


def verify_token(token: str):
    if not token.startswith('v1.'):
        raise ValueError('bad token version')
    try:
        _, b, sig = token.split('.')
    except ValueError:
        raise ValueError('malformed token')
    expected = _sign([b])
    if not hmac.compare_digest(expected, sig):
        raise ValueError('bad signature')
    data = json.loads(_b64d(b))
    if data.get('exp') and int(time.time()) > int(data['exp']):
        raise ValueError('expired')
    return data


# NOTE: Jinja2 template environment removed because only Google Docs export is now supported.

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


"""Authentication / session helpers & dependency"""

AUTH_COOKIE_NAME = os.getenv('LABQA_AUTH_COOKIE', 'labqa_token')
AUTH_COOKIE_SECURE = os.getenv('LABQA_COOKIE_SECURE', '0') == '1'
_raw_samesite = os.getenv('LABQA_COOKIE_SAMESITE', 'lax').lower()
if _raw_samesite not in {'lax', 'strict', 'none'}:
    _raw_samesite = 'lax'
# Use a simple str annotation for broad Python version compatibility (avoid runtime evaluation of union of string literals)
AUTH_COOKIE_SAMESITE: str = _raw_samesite


def _extract_bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith('bearer '):
        return authorization.split(' ', 1)[1].strip()
    return None


def _claims_from_token(token: str | None):
    if not token:
        raise HTTPException(status_code=401, detail='Unauthorized')
    try:
        return verify_token(token)
    except Exception:  # pragma: no cover
        raise HTTPException(status_code=401, detail='Unauthorized')


def require_claims(
    authorization: str | None = Header(default=None),
    labqa_token: str | None = Cookie(default=None, alias=AUTH_COOKIE_NAME),
):
    """FastAPI dependency returning token claims from Authorization header or auth cookie.

    Precedence: Authorization header > cookie.
    """
    token = _extract_bearer(authorization) or labqa_token
    return _claims_from_token(token)


ALLOWED_LEVELS = {"L1", "L2", "L3"}


def _conn():
    return db.get_conn()


# ---------------------------------------------------------------------------
# Auth endpoints

class LoginRequest(schemas.BaseModel):  # type: ignore
    # Support either username or email field from client; both optional but one must be provided.
    username: Optional[str] = None
    email: Optional[str] = None
    password: str


class LoginResponse(schemas.BaseModel):  # type: ignore
    token: str
    user: dict


@app.post('/api/auth/login', response_model=LoginResponse)
def auth_login(body: LoginRequest, session=Depends(db.session)):
    user_identifier = (body.username or body.email or '').strip().lower()
    if not user_identifier:
        raise HTTPException(status_code=400, detail='username_or_email_required')
    # Attempt lookup by available identity fields (username, then email)
    user = None
    if hasattr(User, 'username'):
        try:
            user = session.exec(select(User).where(getattr(User, 'username') ==
                                user_identifier)).first()  # type: ignore[arg-type]
        except Exception:
            user = None
    if not user and hasattr(User, 'email'):
        try:
            user = session.exec(select(User).where(getattr(User, 'email') ==
                                user_identifier)).first()  # type: ignore[arg-type]
        except Exception:
            user = None
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail='invalid credentials')
    if not bcrypt.checkpw(body.password.encode(), user.password_hash.encode() if isinstance(user.password_hash, str) else user.password_hash):
        raise HTTPException(status_code=401, detail='invalid credentials')
    token = issue_token(user)
    payload = LoginResponse(token=token, user={'id': str(user.id), 'role': user.role, 'branch_id': str(
        user.branch_id) if getattr(user, 'branch_id', None) else None})
    resp = JSONResponse(payload.model_dump())
    resp.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite=AUTH_COOKIE_SAMESITE if AUTH_COOKIE_SAMESITE in (
            'lax', 'strict', 'none') else 'lax',
        max_age=TOKEN_TTL_SECONDS,
        path='/',
    )
    return resp


@app.get('/api/auth/me')
def auth_me(claims=Depends(require_claims)):
    return {'ok': True, 'claims': claims}


@app.get('/api/auth/session', response_model=LoginResponse)
def auth_session(session=Depends(db.session), claims=Depends(require_claims)):
    """Restore a session from cookie/header and (optionally) refresh token if >50% lifetime elapsed."""
    user = session.get(User, claims.get('sub')) if claims.get('sub') else None
    if not user:
        raise HTTPException(status_code=401, detail='invalid user')
    now = int(time.time())
    exp = int(claims.get('exp', 0)) if claims.get('exp') else now
    remaining = exp - now
    # Refresh token (sliding) if < 50% TTL remains
    if remaining < TOKEN_TTL_SECONDS / 2:
        token = issue_token(user)
    else:
        token = _extract_bearer(None) or ''  # not available; re-issue anyway for simplicity
        token = issue_token(user)
    payload = LoginResponse(token=token, user={'id': str(user.id), 'role': user.role, 'branch_id': str(
        user.branch_id) if getattr(user, 'branch_id', None) else None})
    resp = JSONResponse(payload.model_dump())
    resp.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite=AUTH_COOKIE_SAMESITE if AUTH_COOKIE_SAMESITE in (
            'lax', 'strict', 'none') else 'lax',
        max_age=TOKEN_TTL_SECONDS,
        path='/',
    )
    return resp


@app.post('/api/auth/logout')
def auth_logout():
    resp = JSONResponse({'ok': True})
    resp.delete_cookie(AUTH_COOKIE_NAME, path='/')
    return resp


# ---------------------------------------------------------------------------
# Branches & Parameters

@app.get("/api/branches", response_model=schemas.BranchList)
def list_branches(session=Depends(db.session), claims=Depends(require_claims)):
    statement = select(Branch).order_by(Branch.name)
    branches = session.exec(statement).all()
    if claims.get("role") == "technician" and claims.get("branch_id"):
        branches = [b for b in branches if str(b.id) == claims.get("branch_id")]
    return schemas.BranchList(items=[schemas.BranchOut(id=str(b.id), name=b.name) for b in branches])


# ---------------- Admin Branch Management ----------------
@app.post("/api/admin/branches", response_model=schemas.BranchOut)
def admin_create_branch(body: schemas.BranchCreate, session=Depends(db.session), claims=Depends(require_claims)):
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name_required")
    # Simple uniqueness check on name (case-insensitive)
    existing = session.exec(select(Branch).where(Branch.name == name)).first()
    if existing:
        raise HTTPException(status_code=409, detail="branch_exists")
    b = Branch(name=name)
    session.add(b)
    session.commit()
    session.refresh(b)
    return schemas.BranchOut(id=str(b.id), name=b.name)


@app.put("/api/admin/branches/{branch_id}", response_model=schemas.BranchOut)
def admin_update_branch(branch_id: str, body: schemas.BranchUpdate, session=Depends(db.session), claims=Depends(require_claims)):
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        b = session.get(Branch, branch_id)
    except Exception:
        b = None
    if not b:
        raise HTTPException(status_code=404, detail="branch_not_found")
    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="name_required")
    conflict = session.exec(select(Branch).where(
        Branch.name == new_name, Branch.id != b.id)).first()
    if conflict:
        raise HTTPException(status_code=409, detail="branch_exists")
    b.name = new_name
    session.add(b)
    session.commit()
    session.refresh(b)
    return schemas.BranchOut(id=str(b.id), name=b.name)


@app.delete("/api/admin/branches/{branch_id}")
def admin_delete_branch(
    branch_id: str,
    cascade: list[str] = Query(default=[]),
    session=Depends(db.session),
    claims=Depends(require_claims)
):
    """
    Delete a branch with optional cascade delete of related data.

    Query parameters:
    - cascade: List of options to cascade delete. Options: 'qc_entries', 'targets', 'technicians'

    Examples:
    - DELETE /api/admin/branches/{id}  (fails if branch has related data)
    - DELETE /api/admin/branches/{id}?cascade=qc_entries&cascade=targets  (deletes branch and related data)
    """
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    try:
        b = session.get(Branch, branch_id)
    except Exception:
        b = None
    if not b:
        raise HTTPException(status_code=404, detail="branch_not_found")

    try:
        # Convert cascade list to set for easier checking
        cascade_set = set(cascade)

        # 1. Handle QC entries
        if 'qc_entries' in cascade_set:
            # Delete all QC entries for this branch
            qc_stmt = select(QcEntry).where(QcEntry.branch == uuid.UUID(branch_id))
            qc_entries = session.exec(qc_stmt).all()
            for entry in qc_entries:
                session.delete(entry)
        else:
            # Check if QC entries exist
            qc_stmt = select(QcEntry).where(QcEntry.branch == uuid.UUID(branch_id))
            qc_count = len(session.exec(qc_stmt).all())
            if qc_count > 0:
                raise HTTPException(
                    status_code=409,
                    detail=f"branch_in_use: {qc_count} QC entries exist. Use ?cascade=qc_entries to delete them."
                )

        # 2. Handle targets
        if 'targets' in cascade_set:
            # Delete all targets for this branch
            target_stmt = select(Target).where(Target.branch_id == uuid.UUID(branch_id))
            targets = session.exec(target_stmt).all()
            for target in targets:
                session.delete(target)
        else:
            # Check if targets exist
            target_stmt = select(Target).where(Target.branch_id == uuid.UUID(branch_id))
            target_count = len(session.exec(target_stmt).all())
            if target_count > 0:
                raise HTTPException(
                    status_code=409,
                    detail=f"branch_in_use: {target_count} targets exist. Use ?cascade=targets to delete them."
                )

        # 3. Handle technicians (users with branch_id)
        if 'technicians' in cascade_set:
            # Delete technicians assigned to this branch
            user_stmt = select(User).where(
                User.branch_id == uuid.UUID(branch_id),
                User.role == 'technician'
            )
            users = session.exec(user_stmt).all()
            for user in users:
                session.delete(user)
        else:
            # Unlink technicians (set branch_id to NULL) instead of checking/blocking
            user_stmt = select(User).where(
                User.branch_id == uuid.UUID(branch_id),
                User.role == 'technician'
            )
            users = session.exec(user_stmt).all()
            for user in users:
                user.branch_id = None
                session.add(user)

        # 4. Finally, delete the branch itself
        session.delete(b)
        session.commit()

        return {"ok": True, "message": "Branch deleted successfully"}

    except HTTPException:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        # Log the error for debugging
        print(f"Error deleting branch {branch_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"delete_failed: {str(e)}")


# ---------------- Admin Technician Management ----------------
@app.get("/api/admin/technicians", response_model=schemas.TechnicianList)
def admin_list_technicians(session=Depends(db.session), claims=Depends(require_claims)):
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    rows = session.exec(select(User).where(User.role == 'technician').order_by(
        User.created_at)).all()  # type: ignore[arg-type]
    items = [schemas.TechnicianOut(id=str(u.id), email=u.email, branch_id=str(
        u.branch_id) if u.branch_id else None, created_at=u.created_at) for u in rows]
    return schemas.TechnicianList(items=items)


@app.post("/api/admin/technicians", response_model=schemas.TechnicianOut)
def admin_create_technician(body: schemas.TechnicianCreate, session=Depends(db.session), claims=Depends(require_claims)):
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    email = body.email.strip().lower()
    if not email or '@' not in email:
        raise HTTPException(status_code=400, detail='invalid_email')
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail='user_exists')
    if body.branch_id:
        try:
            _b = session.get(Branch, body.branch_id)
        except Exception:
            _b = None
        if not _b:
            raise HTTPException(status_code=400, detail='invalid_branch')
    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    import uuid as _uuid  # local import to avoid top-level churn
    branch_uuid = _uuid.UUID(str(body.branch_id)) if body.branch_id else None
    u = User(email=email, password_hash=pw_hash, role='technician', branch_id=branch_uuid)
    session.add(u)
    session.commit()
    session.refresh(u)
    return schemas.TechnicianOut(id=str(u.id), email=u.email, branch_id=str(u.branch_id) if u.branch_id else None, created_at=u.created_at)


@app.put("/api/admin/technicians/{user_id}", response_model=schemas.TechnicianOut)
def admin_update_technician(user_id: str, body: schemas.TechnicianUpdate, session=Depends(db.session), claims=Depends(require_claims)):
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        u = session.get(User, user_id)
    except Exception:
        u = None
    if not u or u.role != 'technician':
        raise HTTPException(status_code=404, detail='technician_not_found')
    if body.email is not None:
        new_email = body.email.strip().lower()
        if not new_email or '@' not in new_email:
            raise HTTPException(status_code=400, detail='invalid_email')
        conflict = session.exec(select(User).where(
            User.email == new_email, User.id != u.id)).first()
        if conflict:
            raise HTTPException(status_code=409, detail='user_exists')
        u.email = new_email
    if body.branch_id is not None:
        if body.branch_id:
            try:
                _b = session.get(Branch, body.branch_id)
            except Exception:
                _b = None
            if not _b:
                raise HTTPException(status_code=400, detail='invalid_branch')
            import uuid as _uuid  # local import
            u.branch_id = _uuid.UUID(str(body.branch_id))
        else:
            u.branch_id = None
    session.add(u)
    session.commit()
    session.refresh(u)
    return schemas.TechnicianOut(id=str(u.id), email=u.email, branch_id=str(u.branch_id) if u.branch_id else None, created_at=u.created_at)


@app.delete("/api/admin/technicians/{user_id}")
def admin_delete_technician(
    user_id: str,
    cascade: list[str] = Query(default=[]),
    session=Depends(db.session),
    claims=Depends(require_claims)
):
    """
    Delete a technician with optional cascade delete of related data.

    Query parameters:
    - cascade: List of options to cascade delete. Currently no cascade options are needed,
               but this is here for future extensibility (e.g., if we track technician-specific data).

    Note: QcEntry has an 'entered_by' field but it's not enforced as a FK constraint,
          so deleting a technician won't cause FK errors. This cascade parameter is
          prepared for future use when technician tracking is enhanced.
    """
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        u = session.get(User, user_id)
    except Exception:
        u = None
    if not u or u.role != 'technician':
        raise HTTPException(status_code=404, detail='technician_not_found')

    try:
        # Convert cascade list to set for easier checking
        cascade_set = set(cascade)

        # Future: Add cascade options here if needed
        # For example, if we add a FK from QcEntry.entered_by to User.id:
        # if 'qc_entries' in cascade_set:
        #     qc_stmt = select(QcEntry).where(QcEntry.entered_by == u.email)
        #     for entry in session.exec(qc_stmt).all():
        #         session.delete(entry)

        # Delete the technician
        session.delete(u)
        session.commit()

        return {'ok': True, 'message': 'Technician deleted successfully'}

    except HTTPException:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        print(f"Error deleting technician {user_id}: {str(e)}")
        raise HTTPException(status_code=409, detail=f'delete_failed: {str(e)}')


@app.post("/api/admin/technicians/{user_id}/password")
def admin_change_technician_password(user_id: str, body: schemas.PasswordChange, session=Depends(db.session), claims=Depends(require_claims)):
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        u = session.get(User, user_id)
    except Exception:
        u = None
    if not u or u.role != 'technician':
        raise HTTPException(status_code=404, detail='technician_not_found')
    if not body.password or len(body.password) < 6:
        raise HTTPException(status_code=400, detail='weak_password')
    u.password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    session.add(u)
    session.commit()
    return {'ok': True}


@app.get("/api/parameters", response_model=schemas.ParameterList)
def list_parameters(session=Depends(db.session), claims=Depends(require_claims)):
    rows = session.exec(select(Parameter).order_by(Parameter.id)).all()
    return schemas.ParameterList(items=[schemas.ParameterOut(id=p.id, name=p.name, unit=p.unit) for p in rows])


@app.post("/api/admin/parameters", response_model=schemas.ParameterOut)
def admin_create_parameter(
    body: schemas.ParameterCreate,
    session=Depends(db.session),
    claims=Depends(require_claims)
):
    """Create a new parameter (admin only)"""
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    # Validate ID format (lowercase, no spaces, alphanumeric + underscore)
    param_id = body.id.strip().lower().replace(' ', '_')
    if not param_id or not param_id.replace('_', '').isalnum():
        raise HTTPException(status_code=400, detail="Invalid parameter ID format")

    # Check if already exists
    existing = session.get(Parameter, param_id)
    if existing:
        raise HTTPException(status_code=409, detail="parameter_exists")

    # Create parameter
    param = Parameter(id=param_id, name=body.name.strip(),
                      unit=body.unit.strip() if body.unit else None)
    session.add(param)
    session.commit()
    session.refresh(param)

    return schemas.ParameterOut(id=param.id, name=param.name, unit=param.unit)


@app.put("/api/admin/parameters/{parameter_id}", response_model=schemas.ParameterOut)
def admin_update_parameter(
    parameter_id: str,
    body: schemas.ParameterUpdate,
    session=Depends(db.session),
    claims=Depends(require_claims)
):
    """Update a parameter's name and/or unit (admin only)"""
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    param = session.get(Parameter, parameter_id)
    if not param:
        raise HTTPException(status_code=404, detail="parameter_not_found")

    # Update fields if provided
    if body.name is not None:
        param.name = body.name.strip()
    if body.unit is not None:
        param.unit = body.unit.strip() if body.unit.strip() else None

    session.add(param)
    session.commit()
    session.refresh(param)

    return schemas.ParameterOut(id=param.id, name=param.name, unit=param.unit)


@app.delete("/api/admin/parameters/{parameter_id}")
def admin_delete_parameter(
    parameter_id: str,
    cascade: list[str] = Query(default=[]),
    session=Depends(db.session),
    claims=Depends(require_claims)
):
    """
    Delete a parameter with optional cascade delete of related data.

    Query parameters:
    - cascade: List of options to cascade delete. Options: 'targets', 'qc_entries'

    Examples:
    - DELETE /api/admin/parameters/{id}  (fails if parameter has related data)
    - DELETE /api/admin/parameters/{id}?cascade=targets&cascade=qc_entries
    """
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    param = session.get(Parameter, parameter_id)
    if not param:
        raise HTTPException(status_code=404, detail="parameter_not_found")

    try:
        cascade_set = set(cascade)

        # 1. Handle targets
        if 'targets' in cascade_set:
            # Delete all targets for this parameter
            target_stmt = select(Target).where(Target.parameter_id == parameter_id)
            targets = session.exec(target_stmt).all()
            for target in targets:
                session.delete(target)
        else:
            # Check if targets exist
            target_stmt = select(Target).where(Target.parameter_id == parameter_id)
            target_count = len(session.exec(target_stmt).all())
            if target_count > 0:
                raise HTTPException(
                    status_code=409,
                    detail=f"parameter_in_use: {target_count} targets exist. Use ?cascade=targets to delete them."
                )

        # 2. Handle QC entries
        if 'qc_entries' in cascade_set:
            # Delete all QC entries for this parameter
            qc_stmt = select(QcEntry).where(QcEntry.parameter == parameter_id)
            qc_entries = session.exec(qc_stmt).all()
            for entry in qc_entries:
                session.delete(entry)
        else:
            # Check if QC entries exist
            qc_stmt = select(QcEntry).where(QcEntry.parameter == parameter_id)
            qc_count = len(session.exec(qc_stmt).all())
            if qc_count > 0:
                raise HTTPException(
                    status_code=409,
                    detail=f"parameter_in_use: {qc_count} QC entries exist. Use ?cascade=qc_entries to delete them."
                )

        # 3. Finally, delete the parameter itself
        session.delete(param)
        session.commit()

        return {"ok": True, "message": "Parameter deleted successfully"}

    except HTTPException:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        print(f"Error deleting parameter {parameter_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"delete_failed: {str(e)}")


# ---------------------------------------------------------------------------
# Targets (versioned)

@app.get("/api/targets", response_model=schemas.TargetList)
def get_targets(session=Depends(db.session), claims=Depends(require_claims)):
    # Use explicit column ordering; suppress mypy/SQLModel typing complaints with ignore if necessary
    rows = session.exec(select(Target)).all()  # Simplify ordering to avoid type issues
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
def upsert_target(payload: schemas.TargetUpsert, session=Depends(db.session), claims=Depends(require_claims)):
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


@app.put("/api/targets/{branch_id}/{parameter_id}/{level}/{valid_from}", response_model=schemas.UpsertResponse)
def update_target(
    branch_id: str,
    parameter_id: str,
    level: str,
    valid_from: str,
    payload: schemas.TargetUpdate,
    session=Depends(db.session),
    claims=Depends(require_claims)
):
    """Update an existing target version"""
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    if level not in ALLOWED_LEVELS:
        raise HTTPException(status_code=400, detail="Invalid level")

    existing = session.get(Target, (branch_id, parameter_id, level, valid_from))
    if not existing:
        raise HTTPException(status_code=404, detail="Target not found")

    existing.mean = payload.mean
    existing.sd = payload.sd
    session.commit()
    return schemas.UpsertResponse(ok=True)


@app.delete("/api/targets/{branch_id}/{parameter_id}/{level}/{valid_from}", response_model=schemas.UpsertResponse)
def delete_target(
    branch_id: str,
    parameter_id: str,
    level: str,
    valid_from: str,
    session=Depends(db.session),
    claims=Depends(require_claims)
):
    """Delete a specific target version"""
    if claims.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    existing = session.get(Target, (branch_id, parameter_id, level, valid_from))
    if not existing:
        raise HTTPException(status_code=404, detail="Target not found")

    session.delete(existing)
    session.commit()
    return schemas.UpsertResponse(ok=True)


# ---------------------------------------------------------------------------
# QC Entries

@app.get("/api/qc", response_model=schemas.QcList)
def list_qc(
    branch_id: Optional[str] = Query(default=None),
    parameter_id: Optional[str] = Query(default=None),
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    session=Depends(db.session),
    claims=Depends(require_claims),
):
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
def create_qc(payload: schemas.QcBulkCreate, session=Depends(db.session), claims=Depends(require_claims)):
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

        # Check for duplicate entry
        existing = session.exec(
            select(QcEntry).where(
                QcEntry.branch == uuid.UUID(str(e.branch)),
                QcEntry.parameter == e.parameter,
                QcEntry.date == e.date,
                QcEntry.level == e.level
            )
        ).first()

        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate entry: QC entry already exists for {e.parameter} level {e.level} on {e.date}"
            )

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


@app.put("/api/qc/{entry_id}", response_model=schemas.QcEntryOut)
def update_qc(
    entry_id: str,
    payload: schemas.QcEntryUpdate,
    session=Depends(db.session),
    claims=Depends(require_claims)
):
    """Update a QC entry's value. Only accessible by admin or technician with branch access."""
    role = claims.get("role")
    if role not in {"admin", "technician"}:
        raise HTTPException(status_code=403, detail="Forbidden")

    user_branch = claims.get("branch_id")

    # Get the existing entry
    try:
        entry_uuid = uuid.UUID(entry_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid entry ID format")

    entry = session.get(QcEntry, entry_uuid)
    if not entry:
        raise HTTPException(status_code=404, detail="QC entry not found")

    # Check branch access for technicians
    if role == "technician" and user_branch:
        if str(entry.branch) != user_branch:
            raise HTTPException(status_code=403, detail="Forbidden (branch scope)")

    # Update the value
    entry.value = payload.value
    session.add(entry)
    session.commit()
    session.refresh(entry)

    # Return updated entry
    return schemas.QcEntryOut(
        id=str(entry.id),
        date=entry.date,
        parameter=entry.parameter,
        branch=str(entry.branch),
        level=entry.level,
        value=entry.value,
        enteredBy=entry.entered_by,
        enteredAt=entry.entered_at,
    )


@app.delete("/api/qc/{entry_id}")
def delete_qc(
    entry_id: str,
    session=Depends(db.session),
    claims=Depends(require_claims)
):
    """Delete a QC entry. Only accessible by admin or technician with branch access."""
    role = claims.get("role")
    if role not in {"admin", "technician"}:
        raise HTTPException(status_code=403, detail="Forbidden")

    user_branch = claims.get("branch_id")

    # Get the existing entry
    try:
        entry_uuid = uuid.UUID(entry_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid entry ID format")

    entry = session.get(QcEntry, entry_uuid)
    if not entry:
        raise HTTPException(status_code=404, detail="QC entry not found")

    # Check branch access for technicians
    if role == "technician" and user_branch:
        if str(entry.branch) != user_branch:
            raise HTTPException(status_code=403, detail="Forbidden (branch scope)")

    # Delete the entry
    session.delete(entry)
    session.commit()

    return {"message": "QC entry deleted successfully"}


# ---------------------------------------------------------------------------
# Effective targets endpoint

@app.get("/api/targets/effective", response_model=schemas.TargetList)
def effective_targets(
    date: Optional[str] = Query(default=None),
    branch_id: Optional[str] = Query(default=None),
    parameter_id: Optional[str] = Query(default=None),
    session=Depends(db.session),
    claims=Depends(require_claims),
):
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


# ---------------------------------------------------------------------------
# Report Export

class ReportParameterStats(schemas.BaseModel):  # type: ignore
    name: str
    level: str
    stats: dict
    svg: str | None = None


class ReportExportRequest(schemas.BaseModel):  # type: ignore
    branchName: str
    period: dict
    narrative: str | None = None
    parameters: list[ReportParameterStats]
    format: Optional[str] = None  # optional; if provided must be 'gdoc'
    chartImages: list[dict] | None = None  # provided by frontend for gdoc export
    ruleViolations: list[dict] | None = None  # Westgard rule violations
    preparedBy: str | None = None  # Person who prepared the report
    reviewedBy: str | None = None  # Person who reviewed the report

# ---------------------------------------------------------------------------
# Google OAuth (stateless) endpoints


GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive.file'
]


@app.get('/api/google/oauth/start')
def google_oauth_start(state: str, redirect: Optional[str] = None):
    """Return a Google OAuth consent URL.

    The client is responsible for generating & storing the state value locally
    to validate on callback. This backend does NOT persist state (stateless).
    """
    client_id = os.getenv('GOOGLE_CLIENT_ID')
    redirect_uri = os.getenv('GOOGLE_REDIRECT_URI')
    if not client_id or not redirect_uri:
        raise HTTPException(status_code=500, detail='Google OAuth not configured')
    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': ' '.join(GOOGLE_SCOPES),
        'access_type': 'offline',  # request refresh token
        'include_granted_scopes': 'true',
        'prompt': 'consent',  # ensure refresh token returned first time
        'state': state,
    }
    auth_url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode(params)
    return {'url': auth_url}


@app.get('/api/google/oauth/callback')
def google_oauth_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    """Exchange code for tokens and postMessage them back to the opener window.

    Returns a tiny HTML page that communicates with the frontend via window.postMessage
    then closes itself. The frontend should verify the state value it originally set.
    """
    frontend_origin = os.getenv('FRONTEND_ORIGIN', '*')
    client_id = os.getenv('GOOGLE_CLIENT_ID')
    client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
    redirect_uri = os.getenv('GOOGLE_REDIRECT_URI')
    if not client_id or not redirect_uri or not client_secret:
        raise HTTPException(status_code=500, detail='Google OAuth not configured')
    payload: dict = {}
    if error:
        payload = {'error': error, 'state': state}
    elif code:
        token_url = 'https://oauth2.googleapis.com/token'
        form = {
            'code': code,
            'client_id': client_id,
            'client_secret': client_secret,
            'redirect_uri': redirect_uri,
            'grant_type': 'authorization_code'
        }
        data = urllib.parse.urlencode(form).encode()
        req = urllib.request.Request(token_url, data=data, method='POST')
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:  # nosec B310
                token_body = resp.read().decode()
            tokens = json.loads(token_body)
            payload = {
                'ok': True,
                'state': state,
                'tokens': tokens,
            }
        except Exception as e:  # pragma: no cover
            payload = {'error': f'exchange_failed:{type(e).__name__}', 'state': state}
    else:
        payload = {'error': 'missing_code', 'state': state}

    safe_json = json.dumps(payload).replace('</', '<\\/')
    html = f"""<!DOCTYPE html><html><head><meta charset='utf-8'><title>OAuth Complete</title></head>
<body><script>
  (function() {{
    const data = {safe_json};
    try {{
      if (window.opener) {{
        window.opener.postMessage(data, '{frontend_origin}');
      }}
    }} catch (e) {{}}
    setTimeout(() => window.close(), 250);
  }})();
</script><p>OAuth flow complete. You can close this window.</p></body></html>"""
    return Response(content=html, media_type='text/html')


class RefreshRequest(schemas.BaseModel):  # type: ignore
    refresh_token: str


@app.post('/api/google/oauth/refresh')
def google_oauth_refresh(body: RefreshRequest):
    client_id = os.getenv('GOOGLE_CLIENT_ID')
    client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail='Google OAuth not configured')
    form = {
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': body.refresh_token,
        'grant_type': 'refresh_token'
    }
    token_url = 'https://oauth2.googleapis.com/token'
    data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(token_url, data=data, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:  # nosec B310
            token_body = resp.read().decode()
        tokens = json.loads(token_body)
        return tokens
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f'refresh_failed:{type(e).__name__}')


GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive.file'
]


@app.post("/api/report/export")
def export_report(
    payload: ReportExportRequest,
    x_google_access_token: str | None = Header(default=None),
    claims=Depends(require_claims),
):
    """Export a QC report to Google Docs.

    The 'format' field is optional; if provided it must equal 'gdoc'.
    """
    if payload.format and payload.format.lower() != 'gdoc':
        raise HTTPException(status_code=400, detail='Only gdoc export is supported now')
    access_token = (
        x_google_access_token or
        os.getenv('DEV_GOOGLE_ACCESS_TOKEN_OVERRIDE') or
        os.getenv('GOOGLE_TEST_ACCESS_TOKEN')
    )
    if (not access_token and payload.narrative and payload.narrative.startswith('__token__:')):
        access_token = payload.narrative.split(':', 1)[1].strip()
    if not access_token:
        raise HTTPException(
            status_code=400, detail='Missing Google access token (X-Google-Access-Token)')
    return _export_report_gdoc(payload, access_token)


def _export_report_gdoc(payload: ReportExportRequest, access_token: str) -> dict:
    """Internal helper containing Google Docs export logic.

    Returns a dict with documentId and url.
    """
    def format_date_display(date_str: str) -> str:
        """Convert yyyy-mm-dd to dd/mm/yyyy for display"""
        try:
            date_obj = dt.datetime.strptime(date_str, '%Y-%m-%d')
            return date_obj.strftime('%d/%m/%Y')
        except Exception:
            return date_str

    def format_datetime_display(datetime_obj: dt.datetime) -> str:
        """Format datetime as dd-mm-yyyy hh:mm am/pm"""
        return datetime_obj.strftime('%d-%m-%Y %I:%M %p')

    period_from = payload.period.get('from')
    period_to = payload.period.get('to')
    # Format dates for display (dd/mm/yyyy)
    period_from_display = format_date_display(period_from) if period_from else period_from
    period_to_display = format_date_display(period_to) if period_to else period_to
    # Keep yyyy-mm-dd for filename in title
    title = f"QC Report - {payload.branchName} ({period_from} → {period_to})"
    create_body = json.dumps({'title': title}).encode()
    req = urllib.request.Request(
        'https://docs.googleapis.com/v1/documents', data=create_body, method='POST')
    req.add_header('Authorization', f'Bearer {access_token}')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:  # nosec B310
            doc_meta = json.loads(resp.read().decode())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f'doc_create_failed:{type(e).__name__}')
    document_id = doc_meta.get('documentId')
    if not document_id:
        raise HTTPException(status_code=502, detail='doc_create_missing_id')

    def fmt_num(v, places=2):
        try:
            if v is None:
                return '—'
            return f"{float(v):.{places}f}"
        except Exception:
            return str(v)

    title_line = f"Quality Control Report - {payload.branchName} ({period_from_display} → {period_to_display})"
    table_header = ['Parameter / Level', 'n', 'Mean', 'SD', 'CV%']
    stats_rows = []
    for p in payload.parameters:
        s = p.stats
        stats_rows.append([
            p.name,
            str(s.get('n', '')),
            fmt_num(s.get('mean'), 3),
            fmt_num(s.get('sd'), 3),
            fmt_num(s.get('cv'), 1),
        ])
    # Build text sections
    lines: list[str] = [
        title_line,
        '',
        f"Branch: {payload.branchName}",
        f"Period: {period_from_display} → {period_to_display}",
        f"Generated: {format_datetime_display(dt.datetime.utcnow())}",
    ]

    # Add Prepared By and Reviewed By if provided
    if payload.preparedBy:
        lines.append(f"Prepared By: {payload.preparedBy}")
    if payload.reviewedBy:
        lines.append(f"Reviewed By: {payload.reviewedBy}")

    lines.append('')  # Empty line after metadata

    if payload.narrative:
        lines.append('NARRATIVE:')
        lines.extend((payload.narrative or '').split('\n'))
        lines.append('')

    # Build complete text with placeholders for tables
    violations_placeholder = 'VIOLATIONS_TABLE_HERE'
    stats_placeholder = 'STATS_TABLE_HERE'
    has_violations = payload.ruleViolations and len(payload.ruleViolations) > 0

    if has_violations:
        lines.append('WESTGARD RULE VIOLATIONS:')
        lines.append(violations_placeholder)
        lines.append('')
    elif payload.ruleViolations is not None:
        lines.append('WESTGARD RULE VIOLATIONS:')
        lines.append('✓ No violations detected - all QC results within acceptable limits')
        lines.append('')

    lines.append('PARAMETER STATISTICS:')
    lines.append(stats_placeholder)
    lines.append('')

    base_text = '\n'.join(lines) + '\n'

    def _docs_batch(request_body: bytes):
        _r = urllib.request.Request(
            f'https://docs.googleapis.com/v1/documents/{document_id}:batchUpdate', data=request_body, method='POST')
        _r.add_header('Authorization', f'Bearer {access_token}')
        _r.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(_r, timeout=60) as _resp:  # nosec B310
            _resp.read()

    # Insert initial text with placeholders
    initial_requests: list[dict] = [
        {'insertText': {'location': {'index': 1}, 'text': base_text}}
    ]

    # Execute initial batch
    try:
        _docs_batch(json.dumps({'requests': initial_requests}).encode())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f'doc_update_failed_initial:{type(e).__name__}')

    # Fetch document to find placeholder positions
    try:
        get_req = urllib.request.Request(
            f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
        get_req.add_header('Authorization', f'Bearer {access_token}')
        with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
            doc_state = json.loads(gres.read().decode())
    except Exception:
        raise HTTPException(status_code=502, detail='doc_fetch_failed')

    content = doc_state.get('body', {}).get('content', [])

    def find_placeholder(placeholder_text: str) -> int | None:
        # Search through all content elements
        for el in content:
            if 'paragraph' not in el:
                continue

            para_start = el.get('startIndex', 1)
            elements = el.get('paragraph', {}).get('elements', [])

            # Build complete paragraph text
            full_text = ''
            for elem in elements:
                text_run = elem.get('textRun', {})
                full_text += text_run.get('content', '')

            # Search for placeholder in complete paragraph text
            if placeholder_text in full_text:
                offset = full_text.find(placeholder_text)
                return para_start + offset

        return None

    # Find placeholder positions
    violations_table_index = find_placeholder(violations_placeholder) if has_violations else None
    stats_table_index = find_placeholder(stats_placeholder)

    # Debug logging
    print(f"[DEBUG] Searching for placeholders:")
    print(
        f"  violations_placeholder: '{violations_placeholder}' -> index: {violations_table_index}")
    print(f"  stats_placeholder: '{stats_placeholder}' -> index: {stats_table_index}")
    print(f"  has_violations: {has_violations}")

    # Validate that we found the required placeholders
    if stats_table_index is None:
        # Log document content for debugging
        print(f"[DEBUG] Document content elements count: {len(content)}")
        for i, el in enumerate(content[:5]):  # First 5 elements
            if 'paragraph' in el:
                para_text = ''
                for elem in el.get('paragraph', {}).get('elements', []):
                    para_text += elem.get('textRun', {}).get('content', '')
                print(f"[DEBUG] Element {i}: {para_text[:100]}")
        raise HTTPException(status_code=500, detail=f'stats_placeholder_not_found')
    if has_violations and violations_table_index is None:
        raise HTTPException(status_code=500, detail=f'violations_placeholder_not_found')

    # Replace placeholders with tables
    # Process in reverse order (stats first if it comes after violations) to avoid index shifting issues
    replace_requests: list[dict] = []

    # Determine order based on positions
    tables_to_insert = []

    if violations_table_index is not None:
        violations_rows = len(payload.ruleViolations or []) + 1
        violations_cols = 6
        tables_to_insert.append({
            'index': violations_table_index,
            'placeholder_len': len(violations_placeholder),
            'rows': violations_rows,
            'cols': violations_cols,
            'type': 'violations'
        })

    if stats_table_index is not None:
        rows = len(stats_rows) + 1
        cols = len(table_header)
        tables_to_insert.append({
            'index': stats_table_index,
            'placeholder_len': len(stats_placeholder),
            'rows': rows,
            'cols': cols,
            'type': 'stats'
        })

    # Sort by index descending so we process from end to start (avoids index shifting)
    tables_to_insert.sort(key=lambda x: x['index'], reverse=True)

    for table_info in tables_to_insert:
        # Delete placeholder
        replace_requests.append({
            'deleteContentRange': {
                'range': {
                    'startIndex': table_info['index'],
                    'endIndex': table_info['index'] + table_info['placeholder_len']
                }
            }
        })
        # Insert table at same position
        replace_requests.append({
            'insertTable': {
                'rows': table_info['rows'],
                'columns': table_info['cols'],
                'location': {'index': table_info['index']}
            }
        })

    if replace_requests:
        print(f"[DEBUG] Executing {len(replace_requests)} replace requests")
        print(f"[DEBUG] Replace requests: {json.dumps(replace_requests, indent=2)}")
        try:
            _docs_batch(json.dumps({'requests': replace_requests}).encode())
            print("[DEBUG] Replace batch succeeded")
        except Exception as e:
            # Log the actual error instead of silently continuing
            print(f"[ERROR] Table replacement failed: {type(e).__name__}: {str(e)}")
            raise HTTPException(
                status_code=502, detail=f'table_replacement_failed:{type(e).__name__}')

    # Refetch document to get table structures
    try:
        get_req = urllib.request.Request(
            f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
        get_req.add_header('Authorization', f'Bearer {access_token}')
        with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
            doc_state = json.loads(gres.read().decode())
    except Exception:
        doc_state = None

    # Populate stats table
    if stats_table_index is not None and doc_state:
        table_index = None
        for _poll in range(12):
            body_content = doc_state.get('body', {}).get('content', [])
            for el in body_content:
                if el.get('startIndex') and el.get('startIndex') >= stats_table_index and 'table' in el:
                    table_index = el
                    break
            if table_index:
                tbl = table_index.get('table') or {}
                rows_list = tbl.get('tableRows') or []
                rows_ok = len(rows_list) == (len(stats_rows) + 1)
                shape_ok = rows_ok and all(len(r.get('tableCells', [])) ==
                                           len(table_header) for r in rows_list)
                if shape_ok:
                    flat_cells = [c for r in rows_list for c in r.get('tableCells', [])]
                    uniq = {c.get('startIndex')
                            for c in flat_cells if c.get('startIndex') is not None}
                    if flat_cells and len(uniq) >= len(flat_cells) * 0.9:
                        break
            try:
                time.sleep(0.25)
                get_req = urllib.request.Request(
                    f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
                get_req.add_header('Authorization', f'Bearer {access_token}')
                with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
                    doc_state = json.loads(gres.read().decode())
            except Exception:
                break
        if table_index:
            def _refetch_table():
                try:
                    r = urllib.request.Request(
                        f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
                    r.add_header('Authorization', f'Bearer {access_token}')
                    with urllib.request.urlopen(r, timeout=30) as rr:  # nosec B310
                        fresh = json.loads(rr.read().decode())
                    for el in fresh.get('body', {}).get('content', []):
                        if el.get('startIndex') == table_index.get('startIndex') and 'table' in el:
                            return el.get('table')
                except Exception:
                    return table_index.get('table')
                return table_index.get('table')
            table = _refetch_table()
            try:
                insert_cells: list[tuple[int, str]] = []
                for ci, header in enumerate(table_header):
                    cell = table['tableRows'][0]['tableCells'][ci]
                    insert_cells.append((cell['startIndex'] + 1, header))
                for ri, row_vals in enumerate(stats_rows, start=1):
                    for ci, val in enumerate(row_vals):
                        try:
                            cell = table['tableRows'][ri]['tableCells'][ci]
                            insert_cells.append((cell['startIndex'] + 1, val))
                        except Exception:
                            continue
                insert_cells.sort(key=lambda x: x[0], reverse=True)
                BATCH = 10
                for i in range(0, len(insert_cells), BATCH):
                    chunk = insert_cells[i:i+BATCH]
                    reqs = [{'insertText': {'location': {'index': idx}, 'text': text}}
                            for idx, text in chunk]
                    _docs_batch(json.dumps({'requests': reqs}).encode())
                table = _refetch_table()
                try:
                    header_cells = table['tableRows'][0]['tableCells']
                    style_reqs = []
                    for ci in range(len(table_header)):
                        c = header_cells[ci]
                        start = c['startIndex'] + 1
                        end = c['endIndex'] - 1
                        if end > start:
                            style_reqs.append({'updateTextStyle': {
                                'range': {'startIndex': start, 'endIndex': end}, 'textStyle': {'bold': True}, 'fields': 'bold'}})
                    if style_reqs:
                        _docs_batch(json.dumps({'requests': style_reqs}).encode())

                    # Set column widths for stats table (in points: 1 inch = 72 points)
                    # Stats table columns: Parameter/Level (wider), n, Mean, SD, CV%
                    stats_col_widths = [190, 45, 80, 80, 65]  # in points
                    width_reqs = []
                    for ci, width_pt in enumerate(stats_col_widths):
                        width_reqs.append({
                            'updateTableColumnProperties': {
                                'tableStartLocation': {'index': table_index.get('startIndex')},
                                'columnIndices': [ci],
                                'tableColumnProperties': {
                                    'widthType': 'FIXED_WIDTH',
                                    'width': {'magnitude': width_pt, 'unit': 'PT'}
                                },
                                'fields': 'widthType,width'
                            }
                        })
                    if width_reqs:
                        _docs_batch(json.dumps({'requests': width_reqs}).encode())
                except Exception:
                    pass
            except Exception:
                pass

    # Populate violations table if it exists
    if violations_table_index is not None and payload.ruleViolations and len(payload.ruleViolations) > 0:
        try:
            get_req = urllib.request.Request(
                f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
            get_req.add_header('Authorization', f'Bearer {access_token}')
            with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
                violations_doc_state = json.loads(gres.read().decode())
        except Exception:
            violations_doc_state = None

        if violations_doc_state:
            violations_table_elem = None
            violations_headers = ['Date', 'Parameter', 'Level', 'Rule', 'Description', 'Severity']
            violations_expected_rows = len(payload.ruleViolations) + 1

            # Poll for table with proper structure (similar to stats table)
            for _poll in range(12):
                body_content = violations_doc_state.get('body', {}).get('content', [])
                for el in body_content:
                    if el.get('startIndex') and el.get('startIndex') >= violations_table_index and 'table' in el:
                        violations_table_elem = el
                        break
                if violations_table_elem:
                    tbl = violations_table_elem.get('table') or {}
                    rows_list = tbl.get('tableRows') or []
                    rows_ok = len(rows_list) == violations_expected_rows
                    shape_ok = rows_ok and all(len(r.get('tableCells', [])) == 6 for r in rows_list)
                    if shape_ok:
                        flat_cells = [c for r in rows_list for c in r.get('tableCells', [])]
                        uniq = {c.get('startIndex')
                                for c in flat_cells if c.get('startIndex') is not None}
                        if flat_cells and len(uniq) >= len(flat_cells) * 0.9:
                            break
                violations_table_elem = None
                try:
                    time.sleep(0.25)
                    get_req = urllib.request.Request(
                        f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
                    get_req.add_header('Authorization', f'Bearer {access_token}')
                    with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
                        violations_doc_state = json.loads(gres.read().decode())
                except Exception:
                    break

            if violations_table_elem:
                def _refetch_violations_table():
                    try:
                        r = urllib.request.Request(
                            f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
                        r.add_header('Authorization', f'Bearer {access_token}')
                        with urllib.request.urlopen(r, timeout=30) as rr:  # nosec B310
                            fresh = json.loads(rr.read().decode())
                        for el in fresh.get('body', {}).get('content', []):
                            if el.get('startIndex') == violations_table_elem.get('startIndex') and 'table' in el:
                                return el.get('table')
                    except Exception:
                        return violations_table_elem.get('table')
                    return violations_table_elem.get('table')

                violations_table = _refetch_violations_table()
                violations_headers = ['Date', 'Parameter',
                                      'Level', 'Rule', 'Description', 'Severity']
                try:
                    insert_cells: list[tuple[int, str]] = []
                    # Insert headers
                    for ci, header in enumerate(violations_headers):
                        cell = violations_table['tableRows'][0]['tableCells'][ci]
                        insert_cells.append((cell['startIndex'] + 1, header))

                    # Insert data rows
                    for ri, violation in enumerate(payload.ruleViolations, start=1):
                        row_vals = [
                            violation.get('date', ''),
                            violation.get('parameter', ''),
                            violation.get('level', ''),
                            violation.get('rule', ''),
                            violation.get('description', ''),
                            violation.get('severity', '')
                        ]
                        for ci, val in enumerate(row_vals):
                            try:
                                cell = violations_table['tableRows'][ri]['tableCells'][ci]
                                insert_cells.append((cell['startIndex'] + 1, str(val)))
                            except Exception:
                                continue

                    insert_cells.sort(key=lambda x: x[0], reverse=True)
                    BATCH = 10
                    for i in range(0, len(insert_cells), BATCH):
                        chunk = insert_cells[i:i+BATCH]
                        reqs = [{'insertText': {'location': {'index': idx}, 'text': text}}
                                for idx, text in chunk]
                        _docs_batch(json.dumps({'requests': reqs}).encode())

                    # Style headers as bold
                    violations_table = _refetch_violations_table()
                    try:
                        header_cells = violations_table['tableRows'][0]['tableCells']
                        style_reqs = []
                        for ci in range(len(violations_headers)):
                            c = header_cells[ci]
                            start = c['startIndex'] + 1
                            end = c['endIndex'] - 1
                            if end > start:
                                style_reqs.append({'updateTextStyle': {
                                    'range': {'startIndex': start, 'endIndex': end}, 'textStyle': {'bold': True}, 'fields': 'bold'}})
                        if style_reqs:
                            _docs_batch(json.dumps({'requests': style_reqs}).encode())

                        # Set column widths for violations table
                        # Ruler positions: 0, 0.94, 2.34, 2.93, 3.59, 5.76, 6.51 inches
                        # Columns: Date, Parameter, Level, Rule, Description, Severity
                        # in points (1 inch = 72 points)
                        violations_col_widths = [68, 105, 40, 45, 155, 55]
                        width_reqs = []
                        for ci, width_pt in enumerate(violations_col_widths):
                            width_reqs.append({
                                'updateTableColumnProperties': {
                                    'tableStartLocation': {'index': violations_table_elem.get('startIndex')},
                                    'columnIndices': [ci],
                                    'tableColumnProperties': {
                                        'widthType': 'FIXED_WIDTH',
                                        'width': {'magnitude': width_pt, 'unit': 'PT'}
                                    },
                                    'fields': 'widthType,width'
                                }
                            })
                        if width_reqs:
                            _docs_batch(json.dumps({'requests': width_reqs}).encode())
                    except Exception:
                        pass
                except Exception:
                    pass

    try:
        get_req = urllib.request.Request(
            f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
        get_req.add_header('Authorization', f'Bearer {access_token}')
        with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
            styling_state = json.loads(gres.read().decode())
    except Exception:
        styling_state = None
    if styling_state:
        paragraph_style_requests: list[dict] = []
        for el in styling_state.get('body', {}).get('content', []):
            para = el.get('paragraph')
            if not para:
                continue
            text_fragments = []
            for elem in para.get('elements', []):
                tr = elem.get('textRun', {})
                txt = tr.get('content') or ''
                text_fragments.append(txt)
            full_para = ''.join(text_fragments).strip()
            start_i = el.get('startIndex')
            end_i = el.get('endIndex')
            if not start_i or not end_i:
                continue
            if full_para == title_line:
                paragraph_style_requests.append({'updateParagraphStyle': {
                    'range': {'startIndex': start_i, 'endIndex': end_i - 1},
                    'paragraphStyle': {'namedStyleType': 'TITLE'},
                    'fields': 'namedStyleType'
                }})
            elif full_para == 'NARRATIVE:':
                paragraph_style_requests.append({'updateParagraphStyle': {
                    'range': {'startIndex': start_i, 'endIndex': end_i - 1},
                    'paragraphStyle': {'namedStyleType': 'HEADING_2'},
                    'fields': 'namedStyleType'
                }})
            elif full_para == 'WESTGARD RULE VIOLATIONS:':
                paragraph_style_requests.append({'updateParagraphStyle': {
                    'range': {'startIndex': start_i, 'endIndex': end_i - 1},
                    'paragraphStyle': {'namedStyleType': 'HEADING_2'},
                    'fields': 'namedStyleType'
                }})
            elif full_para == 'PARAMETER STATISTICS:':
                paragraph_style_requests.append({'updateParagraphStyle': {
                    'range': {'startIndex': start_i, 'endIndex': end_i - 1},
                    'paragraphStyle': {'namedStyleType': 'HEADING_2'},
                    'fields': 'namedStyleType'
                }})
        if paragraph_style_requests:
            try:
                _docs_batch(json.dumps({'requests': paragraph_style_requests}).encode())
            except Exception:
                pass
    chart_images = getattr(payload, 'chartImages', None)
    if isinstance(chart_images, list):
        # Trust frontend-provided PNGs only (svg fallback removed)
        chart_images = [img for img in chart_images if isinstance(
            img, dict) and img.get('pngBase64')]
    if isinstance(chart_images, list):
        try:
            get_req = urllib.request.Request(
                f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
            get_req.add_header('Authorization', f'Bearer {access_token}')
            with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
                doc_state = json.loads(gres.read().decode())
            content = doc_state.get('body', {}).get('content', [])

            def _refind(marker: str) -> int | None:
                for el in content:
                    for p in el.get('paragraph', {}).get('elements', []):
                        tr = p.get('textRun', {})
                        txt = tr.get('content', '')
                        pos = txt.find(marker)
                        if pos >= 0:
                            para_start = el.get('startIndex')
                            return (para_start or 1) + pos
                return None
            charts_marker_index = _refind('[[CHARTS_SECTION]]')
        except Exception:
            charts_marker_index = None
        if charts_marker_index is None:
            try:
                get_req = urllib.request.Request(
                    f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
                get_req.add_header('Authorization', f'Bearer {access_token}')
                with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
                    doc_state = json.loads(gres.read().decode())
                    body_content = doc_state.get('body', {}).get('content', [])
                    charts_marker_index = body_content[-1]['endIndex'] - 1 if body_content else 1
            except Exception:
                charts_marker_index = 1
        else:
            try:
                _docs_batch(json.dumps({'requests': [{'deleteContentRange': {'range': {
                    'startIndex': charts_marker_index, 'endIndex': charts_marker_index + len('[[CHARTS_SECTION]]')}}}]}).encode())
            except Exception:
                pass
        uploaded: list[dict] = []
        # Parallel upload (threaded) to reduce total wall time; fallback to sequential if concurrency=1
        try:
            import threading
            import queue  # local import to avoid overhead when no images
            worker_count_env = os.getenv('LABQA_DRIVE_UPLOAD_WORKERS')
            try:
                WORKERS = max(1, min(8, int(worker_count_env))) if worker_count_env else 3
            except Exception:
                WORKERS = 3
            task_q: 'queue.Queue[tuple[int,dict]]' = queue.Queue()
            result_q: 'queue.Queue[tuple[int,dict]]' = queue.Queue()

            def build_body(name: str, binary: bytes) -> tuple[bytes, int, int, str]:
                orig_w = orig_h = 0
                try:
                    if len(binary) > 24 and binary[12:16] == b'IHDR':
                        orig_w = int.from_bytes(binary[16:20], 'big')
                        orig_h = int.from_bytes(binary[20:24], 'big')
                except Exception:
                    orig_w = orig_h = 0
                if not orig_w or not orig_h:
                    orig_w, orig_h = 1200, 360
                try:
                    max_width_pt_env = os.getenv('LABQA_GDOC_CHART_MAX_WIDTH_PT')
                    MAX_WIDTH_PT = int(max_width_pt_env) if max_width_pt_env else 460
                except Exception:
                    MAX_WIDTH_PT = 460
                aspect = orig_h / orig_w if orig_w else 0.3
                target_width_pt = MAX_WIDTH_PT
                target_height_pt = max(60, round(target_width_pt * aspect))
                metadata = json.dumps({'name': f"{title} - {name}.png"}).encode()
                boundary = 'labqa_boundary_' + uuid4().hex
                body_parts = [
                    f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata.decode()}\r\n',
                    f'--{boundary}\r\nContent-Type: image/png\r\n\r\n'
                ]
                body = b''.join([part.encode() if isinstance(
                    part, str) else part for part in body_parts]) + binary + f'\r\n--{boundary}--\r\n'.encode()
                return body, target_width_pt, target_height_pt, boundary

            for idx, img in enumerate(chart_images):
                b64 = img.get('pngBase64') if isinstance(img, dict) else None
                raw_name = img.get('name') if isinstance(img, dict) else f'Chart {idx+1}'
                name = str(raw_name) if raw_name is not None else f'Chart {idx+1}'
                if not b64:
                    continue
                try:
                    binary = base64.b64decode(b64)
                except Exception:
                    continue
                body, w_pt, h_pt, boundary = build_body(name, binary)
                task_q.put((idx, {'name': name, 'body': body, 'w_pt': w_pt,
                           'h_pt': h_pt, 'boundary': boundary}))

            for _ in range(WORKERS):
                task_q.put((-1, {}))  # sentinel

            skip_perm_global = os.getenv('LABQA_SKIP_DRIVE_PERMISSIONS', '0') == '1'

            def worker():  # pragma: no cover (network threading)
                while True:
                    idx, payload = task_q.get()
                    if idx == -1:
                        # BUGFIX: previously we broke without calling task_done() for the sentinel
                        # which caused task_q.join() to block indefinitely (leading to 5-minute timeout).
                        task_q.task_done()
                        break
                    name = payload.get('name')
                    body = payload.get('body')
                    w_pt = payload.get('w_pt')
                    h_pt = payload.get('h_pt')
                    boundary = payload.get('boundary') or 'labqa_boundary_fallback'
                    if body is None:
                        result_q.put((idx, {'error': 'missing_body'}))
                        task_q.task_done()
                        continue
                    try:
                        upload_req = urllib.request.Request(
                            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', data=body, method='POST')
                        upload_req.add_header('Authorization', f'Bearer {access_token}')
                        upload_req.add_header(
                            'Content-Type', f'multipart/related; boundary={boundary}')
                        with urllib.request.urlopen(upload_req, timeout=60) as uresp:  # nosec B310
                            meta = json.loads(uresp.read().decode())
                        file_id = meta.get('id')
                        if file_id and not skip_perm_global:
                            try:
                                perm_body = json.dumps(
                                    {'role': 'reader', 'type': 'anyone'}).encode()
                                perm_req = urllib.request.Request(
                                    f'https://www.googleapis.com/drive/v3/files/{file_id}/permissions', data=perm_body, method='POST')
                                perm_req.add_header('Authorization', f'Bearer {access_token}')
                                perm_req.add_header('Content-Type', 'application/json')
                                urllib.request.urlopen(perm_req, timeout=20).read()  # nosec B310
                            except Exception:
                                pass
                        if file_id:
                            result_q.put(
                                (idx, {'fileId': file_id, 'name': name, 'w_pt': w_pt, 'h_pt': h_pt}))
                        else:
                            result_q.put((idx, {'error': 'missing_file_id'}))
                    except Exception as e:  # pragma: no cover
                        result_q.put((idx, {'error': f'upload_failed:{type(e).__name__}'}))
                    finally:
                        task_q.task_done()

            threads = [threading.Thread(target=worker, daemon=True) for _ in range(WORKERS)]
            for t in threads:
                t.start()
            task_q.join()
            # Drain results preserving original order (sort by idx)
            results: list[tuple[int, dict]] = []
            while not result_q.empty():
                results.append(result_q.get())
            results.sort(key=lambda x: x[0])
            for _, r in results:
                uploaded.append(r)
        except Exception as e:
            # Fallback: no concurrency (should rarely hit unless threading import fails)
            uploaded.append({'error': f'parallel_init_failed:{type(e).__name__}'})
        if uploaded:
            try:
                get_req = urllib.request.Request(
                    f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
                get_req.add_header('Authorization', f'Bearer {access_token}')
                with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
                    doc_state = json.loads(gres.read().decode())
            except Exception:
                doc_state = None
            if doc_state:
                end_index = doc_state.get('body', {}).get(
                    'content', [])[-1]['endIndex'] if doc_state.get('body', {}).get('content') else 1
            else:
                end_index = 1
            insert_index = charts_marker_index if charts_marker_index else (end_index - 1)
            image_requests: list[dict] = []
            charts_heading = f"\nCHARTS\n"
            image_requests.append(
                {'insertText': {'location': {'index': insert_index}, 'text': charts_heading}})
            insert_index += len(charts_heading)
            for entry in uploaded:
                if 'fileId' in entry:
                    file_id = entry['fileId']
                    # Use stored scaled size (default fallback if missing)
                    w_pt = entry.get('w_pt', 460)
                    h_pt = entry.get('h_pt', 140)
                    image_requests.append({'insertInlineImage': {
                        'location': {'index': insert_index},
                        'uri': f'https://drive.google.com/uc?id={file_id}',
                        'objectSize': {'height': {'magnitude': h_pt, 'unit': 'PT'}, 'width': {'magnitude': w_pt, 'unit': 'PT'}}
                    }})
                    insert_index += 1
                    image_requests.append(
                        {'insertText': {'location': {'index': insert_index}, 'text': '\n'}})
                    insert_index += 1
                else:
                    err_line = f"[Image error: {entry.get('error')}]\n"
                    image_requests.append(
                        {'insertText': {'location': {'index': insert_index}, 'text': err_line}})
                    insert_index += len(err_line)
            try:
                _docs_batch(json.dumps({'requests': image_requests}).encode())
            except Exception:
                pass
            try:
                get_req = urllib.request.Request(
                    f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
                get_req.add_header('Authorization', f'Bearer {access_token}')
                with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
                    final_state = json.loads(gres.read().decode())
            except Exception:
                final_state = None
            if final_state:
                style_reqs: list[dict] = []
                for el in final_state.get('body', {}).get('content', []):
                    para = el.get('paragraph')
                    if not para:
                        continue
                    text_fragments = []
                    for elem in para.get('elements', []):
                        tr = elem.get('textRun', {})
                        txt = tr.get('content') or ''
                        text_fragments.append(txt)
                    full_para = ''.join(text_fragments).strip()
                    start_i = el.get('startIndex')
                    end_i = el.get('endIndex')
                    if not start_i or not end_i:
                        continue
                    if full_para == 'CHARTS':
                        style_reqs.append({'updateParagraphStyle': {
                            'range': {'startIndex': start_i, 'endIndex': end_i - 1},
                            'paragraphStyle': {'namedStyleType': 'HEADING_2'},
                            'fields': 'namedStyleType'
                        }})
                if style_reqs:
                    try:
                        _docs_batch(json.dumps({'requests': style_reqs}).encode())
                    except Exception:
                        pass
    return {'documentId': document_id, 'url': f'https://docs.google.com/document/d/{document_id}/edit'}
