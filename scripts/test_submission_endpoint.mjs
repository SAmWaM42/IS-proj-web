#!/usr/bin/env node
/**
 * End-to-end smoke test for an Animal Agent backend Preview deployment.
 *
 * Required environment:
 *   SUBMISSIONS_URL
 *   TEST_PARTICIPANT_NUMBER
 *   TEST_PARTICIPANT_TOKEN
 *   TEST_DEPLOYMENT_CONFIRMATION=DEDICATED_PREVIEW_AND_TEST_DRIVE
 *     or SHARED_PREVIEW_FOLDER_ACKNOWLEDGED when intentionally reusing a Drive folder.
 *
 * Shared-folder mode writes synthetic test submissions to the Drive folder
 * configured for this Preview deployment. It does not select or change that folder.
 * Never run against production or with a real participant's token.
 */

const required = [
  "SUBMISSIONS_URL",
  "TEST_PARTICIPANT_NUMBER",
  "TEST_PARTICIPANT_TOKEN",
  "TEST_DEPLOYMENT_CONFIRMATION",
  "VERCEL_OIDC_TOKEN"
];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(2);
  }
}
const confirmation = process.env.TEST_DEPLOYMENT_CONFIRMATION;
const allowedConfirmations = new Set([
  "DEDICATED_PREVIEW_AND_TEST_DRIVE",
  "SHARED_PREVIEW_FOLDER_ACKNOWLEDGED"
]);
if (!allowedConfirmations.has(confirmation)) {
  console.error(
    "Refusing to run. Set TEST_DEPLOYMENT_CONFIRMATION to " +
    "DEDICATED_PREVIEW_AND_TEST_DRIVE (isolated test folder) or " +
    "SHARED_PREVIEW_FOLDER_ACKNOWLEDGED (existing shared folder)."
  );
  process.exit(2);
}
if (confirmation === "SHARED_PREVIEW_FOLDER_ACKNOWLEDGED") {
  console.warn(
    "WARNING: shared-folder test mode is enabled. Synthetic test submissions " +
    "will be written to the Google Drive folder configured for this Preview deployment."
  );
}

const endpoint = process.env.SUBMISSIONS_URL;
const participant = Number(process.env.TEST_PARTICIPANT_NUMBER);
const token = process.env.TEST_PARTICIPANT_TOKEN;

if (!Number.isInteger(participant) || participant < 1 || participant > 9999) {
  console.error("TEST_PARTICIPANT_NUMBER must be an integer in the range 1..9999.");
  process.exit(2);
}
if (!/^https:\/\//i.test(endpoint) || !/\/api\/submissions\/?$/.test(new URL(endpoint).pathname)) {
  console.error("SUBMISSIONS_URL must be an HTTPS URL ending in /api/submissions.");
  process.exit(2);
}

const expectedCondition = (session) => {
  if (participant % 2 === 1) return session === 1 ? "A" : "B";
  return session === 1 ? "B" : "A";
};
const submissionId = (session) => `P${String(participant).padStart(2, "0")}-S${session}`;
const payload = (session) => ({
  schema_version: 1,
  submission_id: submissionId(session),
  participant_number: participant,
  session_index: session,
  condition: expectedCondition(session),
  responses: {
    smoke_test: true,
    test_case: `synthetic-session-${session}`
  }
});

let failures = 0;
async function check(name, expectedStatus, request, expectedStored) {
  try {
    const headers = new Headers(request?.headers ?? {});
    headers.set(
      "x-vercel-trusted-oidc-idp-token",
      process.env.VERCEL_OIDC_TOKEN
    );

    const response = await fetch(endpoint, {
      ...request,
      headers,
      redirect: "manual"
    });
    let body;
    try { body = await response.json(); }
    catch { body = null; }
    const statusOk = response.status === expectedStatus;
    const storedOk = expectedStored === undefined || body?.stored === expectedStored;
    if (!statusOk || !storedOk) {
      failures++;
      console.error(`FAIL ${name}: expected HTTP ${expectedStatus}${expectedStored === undefined ? "" : ` and stored=${expectedStored}`}; received HTTP ${response.status}, body=${JSON.stringify(body)}`);
      return;
    }
    console.log(`PASS ${name} (HTTP ${response.status})`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: network/request error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function post(body, bearer = token, idempotencyKey = body.submission_id) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${bearer}`,
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(body)
  };
}

for (const session of [1, 2]) {
  const item = payload(session);
  await check(`valid session ${session} submission`, 200, post(item), true);
  await check(`session ${session} duplicate retry`, 200, post(item), true);
}

const valid = payload(1);
await check("invalid schema version", 400, post({ ...valid, schema_version: 99 }), false);
await check("invalid A/B condition assignment", 400,
  post({ ...valid, condition: valid.condition === "A" ? "B" : "A" }), false);
await check("mismatched idempotency key", 400,
  post(valid, token, "not-the-submission-id"), false);
await check("invalid participant token", 401,
  post(valid, "invalid-test-token"), false);
await check("method other than POST", 405, { method: "GET" }, false);

if (failures > 0) {
  console.error(`\n${failures} smoke test(s) failed.`);
  process.exit(1);
}
console.log("\nAll API smoke tests passed.");
