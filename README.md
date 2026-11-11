# Animal Agent — Web Collection and Distribution Service

This repository (`SAmWaM42/IS-proj-web`) owns the web-facing services for Animal Agent. It is separate from the C++ desktop application repository.

Its scope is deliberately limited to:
1. authenticated questionnaire submission;
2. questionnaire envelope/assignment validation;
3. Google Drive persistence through server-side OAuth credentials;
4. stable redirects to desktop application assets published as GitHub Releases.

The C++/SFML participant client is in [`SAmWaM42/IS-proj`](https://github.com/SAmWaM42/IS-proj/tree/deployment/participant-client). Researcher-side training, evaluation, retrieval and analysis are on that repository's `Dev` branch. The repository's `main` README provides the cross-project overview.

## Runtime and deployment

- Platform: Vercel serverless functions.
- Language: TypeScript / Node.js.
- API entry points: `api/submissions.ts` and `api/downloads/latest.ts`.
- Google Drive access uses the `googleapis` client and OAuth refresh token held in Vercel environment variables.
- `package.json` and the Vercel project configuration define the deployment/build environment.

Deploy this repository to the dedicated Vercel project with the repository root as the project root. The production deployment URL is configured separately from the participant client. Do not commit credentials or change production environment variables without explicit approval.

## Questionnaire submission API

### Endpoint

`POST /api/submissions`

Required headers:
- `Authorization: Bearer <participant-token>`
- `Content-Type: application/json`
- `Idempotency-Key: P{participant}-S{session}`

The body uses schema version 1 and includes:
- `submission_id`, deterministically `P{participant}-S{session}`;
- `participant_number` (1–9999);
- `session_index` (1 or 2);
- `condition` (`A` or `B`);
- questionnaire response fields.

The handler checks the submission envelope, deterministic identifier, A/B assignment (odd participants: A then B; even participants: B then A), and that the idempotency header matches the submission ID. It authenticates the participant token using HMAC-SHA256: Vercel's server-only `SEED` is the HMAC key and `PARTICIPANT_TOKENS` stores the participant-number-indexed digest. The raw token is not stored in the server environment map.

On success, the API looks for a Drive file with the same submission ID and creates one if none is found. It returns `{ "stored": true, "submission_id": "..." }`. This supports ordinary retry after a lost acknowledgement, but lookup-then-create is not atomic; concurrent duplicate requests can race. A database with a unique constraint would be required for strict uniqueness.

**Validation boundary:** the current handler validates the envelope, ID, condition mapping, idempotency header and participant authentication. It does not yet perform complete server-side validation of every active questionnaire ID, answer type, required field, allowed option, scale bound or questionnaire version. Do not describe it as full questionnaire-schema validation until that is implemented and tested.

Only questionnaire response JSON should be submitted. Do not send raw interaction text, memory records, affect traces, Q-table data or researcher diagnostics.

### Required Vercel environment variables

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`
- `SEED` — high-entropy server-only HMAC key.
- `PARTICIPANT_TOKENS` — JSON map of participant number to 64-character hexadecimal HMAC digest.

Never commit these values, raw participant tokens, token maps, OAuth secrets or refresh tokens. Generate unique high-entropy tokens for participants and distribute each participant only their own number/token pair. Rotating `SEED` requires regenerating the digest map and redistributing tokens.

## Release download redirects

`GET` and `HEAD /api/downloads/latest?platform=linux|windows` query GitHub Releases in `SAmWaM42/IS-proj` and redirect to the newest eligible release asset:
- Linux: `AnimalAgent-Linux.zip`
- Windows: `AnimalAgent-Windows.zip`

`channel=latest` includes published prereleases; `channel=stable` excludes prereleases. The endpoint chooses the newest eligible release that actually contains the requested platform asset. It does not host or proxy the ZIP itself.

The redirect only works once a matching asset has been published to a GitHub Release. A CI workflow artifact is not automatically a GitHub Release asset.

## Testing

Local checks:

```bash
npm install
npm run typecheck
npx vercel dev
```

The repository's integration smoke test should be run only against a dedicated Vercel Preview deployment and dedicated test Drive folder, using synthetic test submissions and test participant credentials. Test odd and even participant numbers to exercise both condition orders. Confirm the Drive folder contains one expected JSON file per test session; API success alone does not prove transactional uniqueness.

## Repository boundaries

| Location | Responsibility |
|---|---|
| `IS-proj/deployment/participant-client` | Participant UI, guided study, local queue/uploader, C++/SFML runtime. |
| `IS-proj/Dev` | Agent development, researcher training, evaluation and analysis. |
| `IS-proj-web` | Server API, token authentication, Drive persistence and release redirects. |
| `IS-proj/main` | Cross-project build, pipeline, tools and architecture overview. |
