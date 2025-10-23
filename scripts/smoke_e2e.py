import os
import sys
from dotenv import load_dotenv
from fastapi.testclient import TestClient

load_dotenv()
os.environ.setdefault("JWT_SECRET", os.getenv("JWT_SECRET", "test"))
# Ensure project root on sys.path for 'backend' package
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if root not in sys.path:
    sys.path.insert(0, root)

from backend.dev_app import app  # noqa: E402

client = TestClient(app)


def main():
    # Health
    r = client.get('/api/health')
    assert r.status_code == 200, r.text
    print('health: OK')

    # Login (requires DB and seeded admin)
    email = os.getenv('ADMIN_EMAIL', 'admin@example.com')
    password = os.getenv('ADMIN_PASSWORD', 'ChangeMe123!')
    r = client.post('/api/auth/login', json={'email': email, 'password': password})
    if r.status_code != 200:
        print('login: not OK (status', r.status_code, ') - continue')
        return
    token = r.json()['token']
    print('login: OK')

    # Example protected
    r = client.get('/api/example', headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 200, r.text
    print('example: OK')


if __name__ == '__main__':
    main()
