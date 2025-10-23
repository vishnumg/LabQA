import os
import uuid
import bcrypt
import psycopg2
from dotenv import load_dotenv


def main():
    load_dotenv()
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL not set")
    email = os.getenv("ADMIN_EMAIL", "admin@example.com")
    password = os.getenv("ADMIN_PASSWORD", "ChangeMe123!")

    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    with psycopg2.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM users WHERE email=%s", (email,))
            if cur.fetchone():
                print("Admin user already exists")
                return
            cur.execute(
                "INSERT INTO users (id, email, password_hash, role) VALUES (%s, %s, %s, 'admin')",
                (str(uuid.uuid4()), email, pw_hash),
            )
            print("Admin user created:", email)


if __name__ == "__main__":
    main()
