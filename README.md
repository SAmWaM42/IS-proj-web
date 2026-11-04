# Animal Agent Web Backend

Vercel-hosted API for the Animal Agent participant client. This repository is separate from the C++ simulation repository and owns server-side participant authentication, questionnaire validation, and Google Drive storage.

## Branches
- `main`: integration branch for reviewed changes.
- `stable`: deliberate backup snapshot of a known-good `main` commit.
- `test`: active migration and implementation branch; do not use as production deployment target.

The initial `stable` branch mirrors the initial `main` snapshot. It does not automatically track future changes.

## Vercel deployment
Import this repository into a dedicated Vercel project and use the repository root as the project root. Test deployment before selecting `main` as the production branch. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_FOLDER_ID`, and `PARTICIPANT_TOKENS` in Vercel environment variables. Never commit credentials or participant tokens.

Enable the Google Drive API and authorise the account owning the destination folder. Use a refresh token with sufficient Drive scope. After deployment, place the deployed `/api/submissions` URL in the participant application's `Data/Study/upload-config.json` in the separate IS-proj repository.

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
