# Animal Agent Web Backend

Vercel-hosted API for the Animal Agent participant client. This repository is separate from the C++ simulation repository and owns server-side participant authentication, questionnaire validation, and Google Drive storage.

## Branches
- `main`: integration branch for reviewed changes.
- `stable`: deliberate backup snapshot of a known-good `main` commit.
- `test`: active migration and implementation branch; do not use as production deployment target.

The initial `stable` branch mirrors the initial `main` snapshot. It does not automatically track future changes.

## Vercel deployment
Import this repository into a dedicated Vercel project and use the repository root as the project root. Test deployment before selecting `main` as the production branch. Configure these environment variables in Vercel:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`: long-lived OAuth refresh token obtained during the temporary administrator setup.
- `GOOGLE_DRIVE_FOLDER_ID`: folder selected by the administrator through Google Picker.
- `GOOGLE_REDIRECT_URI`: exact HTTPS callback URL `/api/admin/google/callback` registered in the Google OAuth client.
- `GOOGLE_PICKER_API_KEY`: API key with the Google Picker API enabled; restrict it to the Preview site referrer.
- `GOOGLE_CLOUD_PROJECT_NUMBER`: numeric Google Cloud project number used as the Picker App ID.
- `ADMIN_SETUP_SECRET`: high-entropy temporary administrator setup password; remove after setup.
- `SEED`: a high-entropy server-only secret used as the HMAC-SHA256 key for participant-token validation.
- `PARTICIPANT_TOKENS`: JSON object mapping participant numbers to 64-character hexadecimal HMAC-SHA256 digests. Do not put raw participant tokens in this variable.

Never commit credentials, `SEED`, raw participant tokens, or generated token maps. Never include them in the desktop application or common participant ZIP.

### Generate participant credentials
Generate a high-entropy seed (for example, with `openssl rand -hex 32`), store that exact value in Vercel as `SEED`, and provide it locally without putting it in shell history:

```bash
read -rsp "SEED: " SEED
echo
export SEED
python3 scripts/generate_participant_tokens.py
unset SEED
```

The script generates one random token for each participant (default: 1–20) and prints:
1. A participant-to-token list for private distribution to the relevant participants.
2. A JSON digest map suitable for the Vercel `PARTICIPANT_TOKENS` environment variable.

Treat the output as sensitive. Send each participant only their own token alongside their participant number. Keep the complete output somewhere private and do not commit it. The server computes HMAC-SHA256 over the versioned participant/token message using `SEED`, then compares the digest with the corresponding entry in `PARTICIPANT_TOKENS`. Changing `SEED` requires regenerating and replacing the entire digest map and redistributing the corresponding raw tokens.

After deployment, place the deployed `/api/submissions` URL in the participant application's `Data/Study/upload-config.json` in the separate IS-proj repository.

### Google Drive runtime configuration

The participant submission endpoint uses the Google Drive API with the `drive.file` scope. Keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `GOOGLE_DRIVE_FOLDER_ID` configured in Vercel for the deployment environment. The refresh token and folder ID were obtained through the one-time administrator setup flow, which has now been removed from this branch. Do not commit or share these values. The OAuth client must remain a **Web application** client; its redirect URI was needed only for the temporary setup flow and is no longer used by the participant submission endpoint.

## API
`POST /api/submissions` accepts schema version 1 questionnaire responses. Required headers: `Authorization: Bearer <participant-token>`, `Content-Type: application/json`, and `Idempotency-Key` matching `submission_id`.

Required metadata: deterministic `submission_id` (`P{participant}-S{session}`), `participant_number` (1–9999), `session_index` (1 or 2), and `condition` (A or B). Odd participant numbers are assigned A then B; even numbers B then A. The API validates this mapping and the participant token.

Drive lookup-before-create handles ordinary retries after lost acknowledgements but is not atomic; simultaneous duplicate requests can race. A database unique constraint is needed for a strict guarantee. Send questionnaire responses only, not raw interaction text, memory records, affect traces, Q-table data, or diagnostic logs.


## Backend smoke test

Run this only against a dedicated Vercel **Preview** deployment connected to a
dedicated test Google Drive folder. Do not point it at a production deployment.

The script submits two dummy questionnaire records (sessions 1 and 2) for one
test participant, repeats each submission to exercise the idempotent retry path,
and checks invalid schema, invalid A/B assignment, invalid idempotency key,
invalid token, and a non-POST request.

The test deliberately uses synthetic response data only. It does not use real
participant responses or include interaction text, memory, affect, or Q-table
data.

Set the test values in your terminal without putting the token in shell history:

```bash
read -rp "Preview submissions URL: " SUBMISSIONS_URL
read -rp "Test participant number: " TEST_PARTICIPANT_NUMBER
read -rsp "Test participant token: " TEST_PARTICIPANT_TOKEN
echo
export SUBMISSIONS_URL TEST_PARTICIPANT_NUMBER TEST_PARTICIPANT_TOKEN
export TEST_DEPLOYMENT_CONFIRMATION="DEDICATED_PREVIEW_AND_TEST_DRIVE"
npm run test:integration
unset TEST_PARTICIPANT_TOKEN TEST_PARTICIPANT_NUMBER SUBMISSIONS_URL TEST_DEPLOYMENT_CONFIRMATION
```

Run it once with an odd test participant number and once with an even test
participant number to exercise both A/B assignment orders. The participant
token must be generated for the exact participant number being tested and its
digest must be present in that Preview deployment's `PARTICIPANT_TOKENS`.

A successful run verifies API responses, including that repeating the same
submission ID is accepted. It does not by itself prove that Drive contains
exactly one file: inspect the dedicated test folder and confirm there is one
`Pxx-S1.json` and one `Pxx-S2.json` for each test participant. The current
Drive lookup-then-create implementation handles ordinary retries but is not
atomic under simultaneous duplicate requests.

## Local checks
```bash
npm install
npm run typecheck
npx vercel dev
```

## Participant application downloads

The participant application binaries are distributed as assets attached to
GitHub Releases in the separate `SAmWaM42/IS-proj` repository. This web
repository provides a stable redirect endpoint; it does not store or proxy the
binary files.

`GET /api/downloads/latest?platform=linux` redirects to the newest published
release that contains `AnimalAgent-Linux.zip`. Published prereleases are
included by default so controlled release-candidate testing can use this
endpoint. Use `channel=stable` to exclude prereleases:

```bash
curl -fL "https://is-proj-web.vercel.app/api/downloads/latest?platform=linux" \
  -o AnimalAgent-Linux.zip

# Stable releases only:
curl -fL "https://is-proj-web.vercel.app/api/downloads/latest?platform=linux&channel=stable" \
  -o AnimalAgent-Linux.zip
```

The endpoint also recognises `platform=windows` and looks for
`AnimalAgent-Windows.zip` when a Windows release is published. Until that
asset exists, the endpoint returns HTTP 404 for Windows.

The default `latest` channel selects the newest published release (including
prereleases) that contains the requested platform asset. The `stable`
channel selects the newest non-prerelease release containing that asset.
Draft releases are never exposed. The endpoint caches release metadata briefly
and redirects directly to GitHub's release asset; no GitHub credentials or
participant tokens are required to download the public application package.

A release must attach the expected asset filename exactly:
- Linux: `AnimalAgent-Linux.zip`
- Windows: `AnimalAgent-Windows.zip`

Do not attach participant credentials, questionnaire responses, or other
private study data to a public GitHub Release.

