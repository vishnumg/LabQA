# LabQA

Unified Next.js + FastAPI (serverless) laboratory QC dashboard.

## Seeding the Database

A seed script is provided to reset and populate development data.

Prerequisites:
- `DATABASE_URL` environment variable pointing to your Postgres instance.
- (Optional) `JWT_SECRET` for running the app, not required just to seed.

Commands:

Run default seed (safe delete + sample QC data):

```
npm run seed
```

Custom usage:

```
python scripts/seed.py --yes --with-qc            # same as npm run seed
python scripts/seed.py --yes                      # seed without QC entries
python scripts/seed.py --yes --reset-hard         # TRUNCATE CASCADE (drops all referenced rows)
python scripts/seed.py --yes --with-qc --reset-hard
```

Flags:
- `--yes` Skip interactive confirmation.
- `--with-qc` Insert example 30 days of GLU L1/L2 QC entries.
- `--reset-hard` Use TRUNCATE CASCADE instead of DELETE (faster, resets sequences).

Seeded Data Overview:
- Branches: Main Lab, East Wing
- Parameters: GLU (Glucose), HBA1C (HbA1c), CHO (Cholesterol)
- Users:
  - admin@example.com / admin123 (role=admin)
  - tech@example.com / tech123 (role=technician, branch=Main Lab)
- Targets: Multiple versions demonstrating effective target logic.
- QC Entries: Optional 30-day synthetic series (if `--with-qc`).

## Effective Targets Endpoint
`GET /api/targets/effective?date=YYYY-MM-DD&branch_id=...&parameter_id=...`
Returns one version per (branch, parameter, level) using the latest `valid_from <= date`.

## Pagination (QC)
`GET /api/qc?limit=200&offset=0` returns fields: `items[], total, limit, offset`.

## Notes
- CORS currently wide open; restrict before production.
- Migration `003_parameters.sql` must be applied before seeding or running with new Parameter model.

