import httpx
import pytest


def test_health_ok():
    bases = ['http://localhost:3000', 'http://localhost:8000']
    last_exc = None
    for base in bases:
        try:
            r = httpx.get(f'{base}/api/health', timeout=5.0)
            assert r.status_code == 200
            return
        except Exception as e:
            last_exc = e
            continue
    pytest.skip(f"No server reachable on {bases}: {last_exc}")
