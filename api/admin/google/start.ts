import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const COOKIE_NAME = "animal_agent_drive_oauth_state";

function constantTimeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function fail(res: VercelResponse, status: number, message: string) {
  return res.status(status).json({ error: message });
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, "Method not allowed.");
  }

  const setupSecret = process.env.ADMIN_SETUP_SECRET;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!setupSecret || !clientId || !clientSecret || !redirectUri) {
    return fail(res, 503, "Drive setup is not configured. Set ADMIN_SETUP_SECRET, Google OAuth client credentials, and GOOGLE_REDIRECT_URI.");
  }

  const suppliedSecret = typeof req.body?.setup_secret === "string"
    ? req.body.setup_secret
    : "";
  if (!constantTimeStringEqual(setupSecret, suppliedSecret)) {
    return fail(res, 401, "Administrator setup key was not accepted.");
  }

  const state = randomBytes(32).toString("hex");
  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authorizationUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    scope: [DRIVE_FILE_SCOPE],
    state
  });

  res.setHeader("Set-Cookie",
    `${COOKIE_NAME}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/admin/google; Max-Age=600`);
  return res.status(200).json({ authorization_url: authorizationUrl });
}
