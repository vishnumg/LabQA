-- Add versioned targets by including valid_from in primary key
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='targets'
    ) THEN
        CREATE TABLE targets (
            branch_id uuid NOT NULL REFERENCES branches(id),
            parameter_id text NOT NULL,
            level text NOT NULL,
            valid_from date NOT NULL,
            mean double precision NOT NULL,
            sd double precision NOT NULL,
            PRIMARY KEY (branch_id, parameter_id, level, valid_from)
        );
    ELSE
        -- If table exists without valid_from in PK, we need to migrate
        -- Create new table, copy data assuming a single current version per key with today's date as valid_from if missing
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns WHERE table_name='targets' AND column_name='valid_from'
        ) THEN
            ALTER TABLE targets ADD COLUMN valid_from date NOT NULL DEFAULT CURRENT_DATE;
        END IF;
        -- Recreate PK including valid_from
        BEGIN
            ALTER TABLE targets DROP CONSTRAINT targets_pkey;
        EXCEPTION WHEN undefined_object THEN
            -- no-op
        END;
        ALTER TABLE targets ADD PRIMARY KEY (branch_id, parameter_id, level, valid_from);
    END IF;

    -- Ensure qc_entries exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name='qc_entries'
    ) THEN
        CREATE TABLE qc_entries (
            id uuid PRIMARY KEY,
            date date NOT NULL,
            parameter text NOT NULL,
            branch uuid NOT NULL REFERENCES branches(id),
            level text NOT NULL,
            value double precision NOT NULL,
            entered_by text NULL,
            entered_at timestamptz NULL
        );
    END IF;
END $$;
