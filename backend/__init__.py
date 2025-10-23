"""Backend package for serverless API.

Currently includes minimal DB access helpers and JWT utilities needed by
the FastAPI serverless functions in `api/index.py`.

If the full SQLModel-based implementation is reintroduced later, these
lightweight helpers can be replaced with real session logic while
preserving the public function contracts used by the API layer.
"""

from . import db  # re-export for convenience

__all__ = ["db"]
# Make backend a package
