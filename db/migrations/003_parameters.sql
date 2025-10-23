-- Create table
CREATE TABLE IF NOT EXISTS parameters (
    id text PRIMARY KEY,
    name text NOT NULL,
    unit text NULL
);

-- Backfill from targets (if any)
INSERT INTO parameters (id, name)
SELECT DISTINCT parameter_id, parameter_id FROM targets t
ON CONFLICT (id) DO NOTHING;

-- Backfill from qc_entries (if any)
INSERT INTO parameters (id, name)
SELECT DISTINCT parameter, parameter FROM qc_entries q
ON CONFLICT (id) DO NOTHING;