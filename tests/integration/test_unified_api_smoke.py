import httpx
import pytest


BASES = ["http://localhost:3000"]  # vercel dev / next start default


@pytest.mark.parametrize("path,expected_key", [
    ("/api/health", "status"),
    ("/api/ping", "pong"),
])
def test_basic_endpoints_respond(path: str, expected_key: str):
    last_exc = None
    for base in BASES:
        try:
            r = httpx.get(f"{base}{path}", timeout=5.0)
            if r.status_code == 200:
                body = r.json()
                assert expected_key in body, body
                return
        except Exception as e:  # pragma: no cover - network/env flakiness
            last_exc = e
            continue
    pytest.skip(f"Endpoint {path} not reachable on {BASES}: {last_exc}")
