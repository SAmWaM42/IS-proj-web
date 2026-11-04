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
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`
- `SEED`: a high-entropy server-only secret used as the HMAC-SHA256 key for participant-token validation.
- `PARTICIPANT_TOKENS`: JSON object mapping participant numbers to 64-character hexadecimal HMAC-SHA256 digests. Do not put raw participant tokens in this variable.

Never commit credentials, `SEED`, raw participant tokens, or generated token maps. Never include them in the desktop application or common participant ZIP.

### Generate participant credentials
Set `SEED` locally to the exact value configured in Vercel, then run:

```bash
SEED='your-server-seed' python3 scripts/generate_participant_tokens.py
```

The script generates one random token for each participant (default: 1–20) and prints:
1. A participant-to-token list for private distribution to the relevant participants.
2. A JSON digest map suitable for the Vercel `PARTICIPANT_TOKENS` environment variable.

Treat the output as sensitive. Send each participant only their own token alongside their participant number. Keep the complete output somewhere private and do not commit it. The server computes HMAC-SHA256 over the versioned participant/token message using `SEED`, then compares the digest with the corresponding entry in `PARTICIPANT_TOKENS`. Changing `SEED` requires regenerating and replacing the entire digest map and redistributing the corresponding raw tokens.

After deployment, place the deployed `/api/submissions` URL in the participant application's `Data/Study/upload-config.json` in the separate IS-proj repository.

Enable the Google Drive API and authorise the account owning the destination folder. Use a refresh token with sufficient Drive scope.

## API
`POST /api/submissions` accepts schema version 1 questionnaire responses. Required headers: `Authorization: Bearer <participant-token>`, `Content-Type: application/json`, and `Idempotency-Key` matching `submission_id`.

Required metadata: deterministic `submission_id` (`P{participant}-S{session}`), `participant_number` (1–9999), `session_index` (1 or 2), and `condition` (A or B). Odd participant numbers are assigned A then B; even numbers B then A. The API validates this mapping and the participant token.

Drive lookup-before-create handles ordinary retries after lost acknowledgements but is not atomic; simultaneous duplicate requests can race. A database unique constraint is needed for a strict guarantee. Send questionnaire responses only, not raw interaction text, memory records, affect traces, Q-table data, or diagnostic logs.

## Local checks
```bash
npm install
npm run typecheck
npx vercel dev
```
