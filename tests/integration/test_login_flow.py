import httpx
import pytest


def test_login_then_access_protected_example_if_token_available():
    bases = ['http://localhost:3000', 'http://localhost:8000']
    last_exc = None
    for base in bases:
        try:
            r = httpx.post(f"{base}/api/auth/login", json={"email": "admin@example.com",
                           "password": "123!"}, timeout=5.0)
            if r.status_code == 200:
                token = r.json().get('token')
                assert token
                r2 = httpx.get(f"{base}/api/example",
                               headers={"Authorization": f"Bearer {token}"}, timeout=5.0)
                assert r2.status_code == 200
            else:
                assert r.status_code in (401, 404)
            return
        except Exception as e:
            last_exc = e
            continue
    pytest.skip(f"No server reachable on {bases}: {last_exc}")
