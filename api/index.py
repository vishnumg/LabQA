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

try:  # optional chart svg conversion for docx
    import cairosvg  # type: ignore
except Exception:
    cairosvg = None  # type: ignore


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
    payload = json.dumps({'sub': str(user.id), 'role': user.role, 'branch_id': str(
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


@app.get("/api/parameters", response_model=schemas.ParameterList)
def list_parameters(session=Depends(db.session), claims=Depends(require_claims)):
    rows = session.exec(select(Parameter).order_by(Parameter.id)).all()
    return schemas.ParameterList(items=[schemas.ParameterOut(id=p.id, name=p.name, unit=p.unit) for p in rows])


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


# ---------------------------------------------------------------------------
# QC Entries

@app.get("/api/qc", response_model=schemas.QcList)
def list_qc(
    branch_id: Optional[str] = Query(default=None),
    parameter_id: Optional[str] = Query(default=None),
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
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
    period_from = payload.period.get('from')
    period_to = payload.period.get('to')
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

    title_line = f"Quality Control Report - {payload.branchName} ({period_from} → {period_to})"
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
    lines: list[str] = [
        title_line,
        '',
        f"Branch: {payload.branchName}",
        f"Period: {period_from} → {period_to}",
        f"Generated: {dt.datetime.utcnow().isoformat()}",
        ''
    ]
    if payload.narrative:
        lines.append('NARRATIVE:')
        lines.extend((payload.narrative or '').split('\n'))
        lines.append('')
    lines.append('PARAMETER STATISTICS:')
    lines.append('[[STATS_TABLE]]')
    lines.append('')
    lines.append('[[CHARTS_SECTION]]')
    base_text = '\n'.join(lines) + '\n'
    initial_req_body = json.dumps({'requests': [
        {'insertText': {'location': {'index': 1}, 'text': base_text}}
    ]}).encode()

    def _docs_batch(request_body: bytes):
        _r = urllib.request.Request(
            f'https://docs.googleapis.com/v1/documents/{document_id}:batchUpdate', data=request_body, method='POST')
        _r.add_header('Authorization', f'Bearer {access_token}')
        _r.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(_r, timeout=60) as _resp:  # nosec B310
            _resp.read()
    try:
        _docs_batch(initial_req_body)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f'doc_update_failed_initial:{type(e).__name__}')
    # Fetch document to locate placeholder indices
    try:
        get_req = urllib.request.Request(
            f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
        get_req.add_header('Authorization', f'Bearer {access_token}')
        with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
            doc_state = json.loads(gres.read().decode())
    except Exception:
        raise HTTPException(status_code=502, detail='doc_fetch_failed')
    content = doc_state.get('body', {}).get('content', [])

    def find_marker(marker: str) -> int | None:
        for el in content:
            for p in el.get('paragraph', {}).get('elements', []):
                text_run = p.get('textRun', {})
                text = text_run.get('content', '')
                idx = text.find(marker)
                if idx >= 0:
                    para_start = el.get('startIndex')
                    return (para_start or 1) + idx
        return None

    stats_marker_index = find_marker('[[STATS_TABLE]]')
    charts_marker_index = find_marker('[[CHARTS_SECTION]]')
    requests: list[dict] = []
    if stats_marker_index is not None:
        requests.append({'deleteContentRange': {'range': {
            'startIndex': stats_marker_index, 'endIndex': stats_marker_index + len('[[STATS_TABLE]]')}}})
        rows = len(stats_rows) + 1
        cols = len(table_header)
        requests.append({'insertTable': {'rows': rows, 'columns': cols,
                                         'location': {'index': stats_marker_index}}})
    if requests:
        try:
            _docs_batch(json.dumps({'requests': requests}).encode())
        except Exception:
            pass
    if stats_marker_index is not None:
        try:
            get_req = urllib.request.Request(
                f'https://docs.googleapis.com/v1/documents/{document_id}', method='GET')
            get_req.add_header('Authorization', f'Bearer {access_token}')
            with urllib.request.urlopen(get_req, timeout=30) as gres:  # nosec B310
                doc_state = json.loads(gres.read().decode())
        except Exception:
            doc_state = None
    if stats_marker_index is not None and doc_state:
        table_index = None
        for _poll in range(12):
            body_content = doc_state.get('body', {}).get('content', [])
            for el in body_content:
                if el.get('startIndex') and el.get('startIndex') >= stats_marker_index and 'table' in el:
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
        # If after fallback no images, we still proceed (just omit charts section heading later)
        for idx, img in enumerate(chart_images):
            try:
                b64 = img.get('pngBase64') if isinstance(img, dict) else None
                name = img.get('name') if isinstance(img, dict) else f'Chart {idx+1}'
                if not b64:
                    continue
                binary = base64.b64decode(b64)
                # Extract PNG dimensions to preserve aspect ratio when scaling into page width
                orig_w = 0
                orig_h = 0
                try:
                    if len(binary) > 24 and binary[12:16] == b'IHDR':
                        orig_w = int.from_bytes(binary[16:20], 'big')
                        orig_h = int.from_bytes(binary[20:24], 'big')
                except Exception:
                    orig_w = 0
                    orig_h = 0
                # Fallback dimensions if header parse failed (approx previous 600x180 design)
                if not orig_w or not orig_h:
                    orig_w, orig_h = 1200, 360
                # Determine target width (fit within typical content width ~ 6.3in minus margins)
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
                upload_req = urllib.request.Request(
                    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', data=body, method='POST')
                upload_req.add_header('Authorization', f'Bearer {access_token}')
                upload_req.add_header('Content-Type', f'multipart/related; boundary={boundary}')
                with urllib.request.urlopen(upload_req, timeout=60) as uresp:  # nosec B310
                    meta = json.loads(uresp.read().decode())
                file_id = meta.get('id')
                if file_id:
                    try:
                        perm_body = json.dumps({'role': 'reader', 'type': 'anyone'}).encode()
                        perm_req = urllib.request.Request(
                            f'https://www.googleapis.com/drive/v3/files/{file_id}/permissions', data=perm_body, method='POST')
                        perm_req.add_header('Authorization', f'Bearer {access_token}')
                        perm_req.add_header('Content-Type', 'application/json')
                        urllib.request.urlopen(perm_req, timeout=30).read()  # nosec B310
                    except Exception:
                        pass
                    uploaded.append({'fileId': file_id, 'name': name,
                                    'w_pt': target_width_pt, 'h_pt': target_height_pt})
            except Exception as ie:  # pragma: no cover
                uploaded.append({'error': f'upload_failed:{type(ie).__name__}'})
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
