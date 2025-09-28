"""JWT helper utilities.

Provides issue_token() and verify_token() aligned with what the API
expects. Tokens carry subject (sub), role, optional branch_id, issued
at (iat) and an expiration (exp). Expiration default: 12 hours.
"""
from __future__ import annotations
from typing import Dict, Any

import os
import time
from typing import Any, Dict

import jwt

ALGO = "HS256"
DEFAULT_TTL_SECONDS = 60 * 60 * 12


def _secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        # Provide a deterministic but unsafe fallback for preview envs so
        # that routes still respond. Encourage user to set JWT_SECRET.
        secret = "dev-insecure-secret"
    return secret


def issue_token(*, sub: str, role: str, branch_id: str | None = None, ttl: int = DEFAULT_TTL_SECONDS) -> str:
    now = int(time.time())
    payload: Dict[str, Any] = {
        "sub": sub,
        "role": role,
        "iat": now,
        "exp": now + ttl,
    }
    if branch_id:
        payload["branch_id"] = branch_id
    return jwt.encode(payload, _secret(), algorithm=ALGO)  # type: ignore[arg-type]


def verify_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, _secret(), algorithms=[ALGO])  # type: ignore[no-any-unimported]


ALGO = "HS256"


def _secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET not set")
    return secret


def issue_token(sub: str, role: str, branch_id: str | None, ttl_seconds: int = 3600) -> str:
    now = int(time.time())
    payload: Dict[str, Any] = {
        "sub": sub,
        "role": role,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    if branch_id:
        payload["branch_id"] = branch_id
    return jwt.encode(payload, _secret(), algorithm=ALGO)


def verify_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, _secret(), algorithms=[ALGO])
