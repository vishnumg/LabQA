import os
import psycopg2
from dotenv import load_dotenv


def main():
    load_dotenv()
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL not set")
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "db", "migrations"))
    files = ["001_init.sql", "002_targets_versioning.sql"]
    with psycopg2.connect(dsn) as conn:
        with conn.cursor() as cur:
            for name in files:
                path = os.path.join(base, name)
                with open(path, "r", encoding="utf-8") as f:
                    sql = f.read()
                cur.execute(sql)
                conn.commit()
                print("Migration applied:", path)


if __name__ == "__main__":
    main()
