CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('technician','admin')),
  branch_id uuid NULL REFERENCES branches(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
