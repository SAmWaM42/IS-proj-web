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

### One-time Google Drive authorisation (temporary setup page)

The backend uses the narrow `https://www.googleapis.com/auth/drive.file` scope, not the broad full-Drive scope. This is not a literal folder-only OAuth scope: the administrator selects the dedicated destination folder through Google Picker, and the app can create and manage files it creates there. It does not receive blanket access to unrelated Drive files. Start with a new, empty folder dedicated to this study.

1. In the same Google Cloud project, enable **Google Drive API** and **Google Picker API**.
2. Configure the OAuth consent screen and add the administrator Google account as a test user if the app is in Testing.
3. Create/use an OAuth client of type **Web application**. Add the exact value of `GOOGLE_REDIRECT_URI` to its authorised redirect URIs. It must be the HTTPS URL for this deployment's `/api/admin/google/callback`.
4. Create a Google API key for Picker. Restrict it to the Google Picker API and HTTP referrers for the Preview deployment. Record the numeric Cloud project number for `GOOGLE_CLOUD_PROJECT_NUMBER`.
5. Set the temporary environment variables in Vercel Preview for the setup branch: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_PICKER_API_KEY`, `GOOGLE_CLOUD_PROJECT_NUMBER`, and a high-entropy `ADMIN_SETUP_SECRET`. Do not place secrets in source control or chat.
6. Deploy the branch and open `/admin-drive-setup.html`. Enter the setup secret, sign in as the Drive owner, approve the requested `drive.file` permission, then select the dedicated empty folder in Picker.
7. The callback page displays `GOOGLE_REFRESH_TOKEN` and `GOOGLE_DRIVE_FOLDER_ID` once. Copy them directly into Vercel Preview environment variables. Never paste the refresh token into ChatGPT, commit it, or include it in a participant package.
8. Redeploy the Preview deployment so the submission function receives the variables. Then run the smoke test below and verify created JSON files appear in the selected folder.

The callback URL must exactly match the OAuth client's registered redirect URI. If Google returns no refresh token, revoke the app's previous grant from the Google Account security page and repeat the consent flow. Do not silently reuse an old broad `drive` grant; verify that the granted scope is `drive.file`.

**Cleanup after successful verification:** remove `public/admin-drive-setup.html`, `api/admin/google/start.ts`, and `api/admin/google/callback.ts` in a follow-up commit; remove `ADMIN_SETUP_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_PICKER_API_KEY`, and `GOOGLE_CLOUD_PROJECT_NUMBER` from Vercel. Keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `GOOGLE_DRIVE_FOLDER_ID` for the participant submission endpoint. The setup branch is deliberately separate so this temporary surface is not merged to the production branch.

The setup page exposes the refresh token only to the administrator's browser over HTTPS after OAuth consent. Treat that page and its output as sensitive until it is removed.

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
