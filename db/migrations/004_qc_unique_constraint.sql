-- Add unique constraint to qc_entries table
-- Ensures no duplicate entries for same branch, parameter, date, and level
-- Multiple entries can exist for the same branch/parameter/date if they have different levels

-- First, remove duplicate entries, keeping only the most recently entered one
DELETE FROM qc_entries
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY branch, parameter, date, level 
                   ORDER BY entered_at DESC NULLS LAST, id DESC
               ) AS rn
        FROM qc_entries
    ) t
    WHERE t.rn > 1
);

-- Now add the unique constraint
ALTER TABLE qc_entries 
ADD CONSTRAINT uq_qc_entry_branch_param_date_level 
UNIQUE (branch, parameter, date, level);
