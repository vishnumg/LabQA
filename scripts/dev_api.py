import os
import sys
from dotenv import load_dotenv
import uvicorn


def main():
    load_dotenv()
    # Ensure project root on sys.path
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    if root not in sys.path:
        sys.path.insert(0, root)
    if not os.getenv("JWT_SECRET"):
        raise SystemExit("JWT_SECRET not set in env")
    uvicorn.run("backend.dev_app:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    main()
