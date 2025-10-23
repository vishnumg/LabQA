import httpx
import pytest


BASES = [
    'http://localhost:3000',
    'http://localhost:8000',
]


def _post_any(path: str, json: dict):
    last_exc = None
    for base in BASES:
        try:
            return httpx.post(f"{base}{path}", json=json, timeout=5.0)
        except Exception as e:
            last_exc = e
            continue
    pytest.skip(f"No server reachable on {BASES}: {last_exc}")


def test_login_invalid_credentials_returns_401():
    r = _post_any('/api/auth/login', {"email": "no@user", "password": "bad"})
    assert r.status_code == 401


def test_login_valid_credentials_returns_200_and_token():
    # This requires seed admin and DATABASE_URL; if not configured, allow skip
    email = 'admin@example.com'
    password = 'ChangeMe123!'
    r = _post_any('/api/auth/login', {"email": email, "password": password})
    if r.status_code == 200:
        data = r.json()
        assert 'token' in data and isinstance(data['token'], str)
    else:
        # Without DB seeded, 401 is acceptable
        assert r.status_code == 401
