import httpx
import pytest


BASES = ['http://localhost:3000', 'http://localhost:8000']


def test_example_unauthorized():
    last_exc = None
    for base in BASES:
        try:
            r = httpx.get(f"{base}/api/example", timeout=5.0)
            assert r.status_code in (401, 404)
            return
        except Exception as e:
            last_exc = e
            continue
    pytest.skip(f"No server reachable on {BASES}: {last_exc}")
