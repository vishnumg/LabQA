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

## Google Docs Export (Stateless OAuth)

The app can export a QC report directly into the user's Google Docs. This uses a stateless
Authorization Code flow: access & refresh tokens are stored only in the browser (localStorage),
and each export request sends the current access token in the `X-Google-Access-Token` header.

### Scopes
We request only the scopes needed to create/update the document and (upcoming) upload images:

- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/drive.file`

### Environment Variables
Configure these (see `.env.example`):

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth Web Client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret (never commit) |
| `GOOGLE_REDIRECT_URI` | Must point to the FastAPI endpoint `/api/google/oauth/callback` on your deployed backend domain |
| `FRONTEND_ORIGIN` | Exact origin (scheme + host + optional port) of the Next.js frontend for `postMessage` security |

Optional (dev helpers):

- `DEV_GOOGLE_ACCESS_TOKEN_OVERRIDE` – Forces backend to use this access token (skips OAuth) for quick manual testing.
- `GOOGLE_TEST_ACCESS_TOKEN` – Alternate test token variable recognized by backend.

### Google Cloud Console Setup
1. Create (or select) a project.
2. Enable the Google Docs API and Google Drive API.
3. Configure OAuth consent screen (External, add test users if not publishing).
4. Create Credentials → OAuth Client ID → Application type: Web application.
5. Add Authorized redirect URI matching `GOOGLE_REDIRECT_URI` (e.g. `https://your-backend-domain/api/google/oauth/callback`).
6. Copy Client ID & Secret into environment variables (not into source control).

### Flow Summary
1. User clicks "Google Doc" export.
2. If no (valid) access token is present, a popup hits `/api/google/oauth/start` which returns the Google consent URL.
3. After consent, Google redirects to `/api/google/oauth/callback` (FastAPI). The backend exchanges the code for tokens and serves a tiny HTML page that `postMessage`s them to the opener window and closes itself.
4. Frontend stores tokens in localStorage; future exports attach `X-Google-Access-Token`.
5. When the access token is near expiry the frontend calls `/api/google/oauth/refresh` with the refresh token to rotate.

### Security Characteristics
- Backend stays stateless: no DB storage of Google tokens, simplifying revocation / compliance concerns.
- Refresh token lives only in the browser; clearing site data revokes local capability.
- You should rotate the `GOOGLE_CLIENT_SECRET` in the Google Cloud Console if it was ever committed (see below).

### Secret Hygiene
If `google-creds.json` was ever committed, treat the contained secret as compromised:
1. Delete the file from the repository (done).
2. Add it to `.gitignore` (done).
3. In Google Cloud Console, rotate by creating a new OAuth client OR regenerating the secret, then update env vars.
4. Invalidate the old credentials if desired.

### Embedding Charts (Upcoming)
Planned enhancement: client will rasterize each SVG chart to PNG (canvas) and send them; backend will upload images to Drive and insert them via `documents.batchUpdate` using `insertInlineImage` requests.

### Local Development Tips
- Use `http://localhost:3000` frontend + `http://localhost:8000` backend. Ensure both are listed in OAuth credentials (localhost origins do not need to be added for the consent screen, but redirect URI must exactly match backend callback).
- If you cannot open popups (ad blockers), temporarily use `DEV_GOOGLE_ACCESS_TOKEN_OVERRIDE` for quick iteration.

### Troubleshooting
| Issue | Likely Cause | Resolution |
|-------|--------------|------------|
| 500 `Google OAuth not configured` | Missing env vars | Set all required vars & redeploy |
| `redirect_uri_mismatch` from Google | Redirect URI not exactly matching | Update Google Cloud OAuth client settings |
| Popup closes but no tokens stored | `FRONTEND_ORIGIN` mismatch in env | Set exact origin (protocol + host + port) |
| `doc_create_failed:HTTPError` | Insufficient scopes / token expired | Re-run OAuth (clear localStorage) |


