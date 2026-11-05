import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const COOKIE = "animal_agent_drive_oauth_state";

function cookieValue(header: string | undefined): string | null {
  for (const part of (header ?? "").split(";")) {
    const bits = part.trim().split("=");
    if (bits.shift() === COOKIE) return bits.join("=");
  }
  return null;
}
function escapeHtml(value: string): string {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
  return value.replace(/[&<>\"']/g, (c) => entities[c] ?? c);
}
function messagePage(message: string): string {
  return "<!doctype html><html lang='en'><meta charset='utf-8'><title>Drive setup</title><body style='font:16px system-ui;max-width:700px;margin:4rem auto;padding:0 1rem'><h1>Animal Agent Drive setup</h1><p>" + escapeHtml(message) + "</p></body></html>";
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send(messagePage("Method not allowed."));
  }
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_PICKER_API_KEY, GOOGLE_CLOUD_PROJECT_NUMBER } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !GOOGLE_PICKER_API_KEY || !GOOGLE_CLOUD_PROJECT_NUMBER) {
    return res.status(503).send(messagePage("Setup configuration is incomplete. Configure the OAuth client, redirect URI, Picker API key, and Cloud project number."));
  }
  const cookieState = cookieValue(req.headers.cookie);
  const queryState = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const oauthError = typeof req.query.error === "string" ? req.query.error : "";
  res.setHeader("Set-Cookie", COOKIE + "=; HttpOnly; Secure; SameSite=Lax; Path=/api/admin/google; Max-Age=0");
  if (oauthError) return res.status(400).send(messagePage("Google authorization was cancelled or denied."));
  if (!cookieState || !queryState || cookieState !== queryState || !code) {
    return res.status(400).send(messagePage("OAuth state validation failed or the authorization code is missing. Restart setup."));
  }
  try {
    const oauth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    const result = await oauth.getToken(code);
    const tokens = result.tokens;
    if (!tokens.access_token || !tokens.refresh_token) {
      return res.status(400).send(messagePage("Google did not return both access and refresh tokens. Revoke the previous grant and retry with offline access."));
    }
    if (tokens.scope && !tokens.scope.split(" ").includes(SCOPE)) {
      return res.status(400).send(messagePage("The grant does not include drive.file. Revoke the previous grant and retry."));
    }
    const access = JSON.stringify(tokens.access_token).replace(/</g, "\\u003c");
    const refresh = JSON.stringify(tokens.refresh_token).replace(/</g, "\\u003c");
    const apiKey = JSON.stringify(GOOGLE_PICKER_API_KEY).replace(/</g, "\\u003c");
    const appId = JSON.stringify(GOOGLE_CLOUD_PROJECT_NUMBER).replace(/</g, "\\u003c");
    const html = "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Select study folder</title></head><body style='font:16px system-ui;max-width:760px;margin:3rem auto;padding:0 1rem'>" +
      "<h1>Select the dedicated study folder</h1><p>Choose the empty Drive folder for participant JSON submissions. The app will create new files there; this does not grant access to unrelated Drive files.</p>" +
      "<button id='choose' disabled>Loading Google Picker...</button><p id='status' role='status'></p><section id='result' hidden><h2>Vercel configuration</h2><p>Copy these values into the Preview environment for branch test. Treat the refresh token as a secret. Never commit it or put it in the participant package.</p>" +
      "<label>GOOGLE_REFRESH_TOKEN<br><textarea id='refresh' rows='4' style='width:100%' readonly></textarea></label><p><label>GOOGLE_DRIVE_FOLDER_ID<br><input id='folder' style='width:100%' readonly></label></p><button id='copy'>Copy configuration JSON</button><pre id='config' style='white-space:pre-wrap;overflow-wrap:anywhere'></pre><p>After saving and verifying these variables, remove the temporary setup page and OAuth routes.</p></section>" +
      "<script>const ACCESS=" + access + ", REFRESH=" + refresh + ", API_KEY=" + apiKey + ", APP_ID=" + appId + ";" +
      "const statusNode=document.getElementById('status'),choose=document.getElementById('choose');" +
      "function selected(data){if(data.action==='cancel'){statusNode.textContent='Selection cancelled.';return;}if(data.action!=='picked'||!data.docs||!data.docs.length){statusNode.textContent='No folder selected.';return;}const f=data.docs[0];if(f.mimeType!=='application/vnd.google-apps.folder'){statusNode.textContent='Please select a folder.';return;}document.getElementById('refresh').value=REFRESH;document.getElementById('folder').value=f.id;const cfg={GOOGLE_REFRESH_TOKEN:REFRESH,GOOGLE_DRIVE_FOLDER_ID:f.id};document.getElementById('config').textContent=JSON.stringify(cfg,null,2);document.getElementById('result').hidden=false;statusNode.textContent='Selected '+(f.name||'folder')+'. Save the values in Vercel.';choose.disabled=true;}" +
      "function openPicker(){const view=new google.picker.DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder');const picker=new google.picker.PickerBuilder().setAppId(APP_ID).setDeveloperKey(API_KEY).setOAuthToken(ACCESS).addView(view).setTitle('Select Animal Agent study folder').setCallback(selected).build();picker.setVisible(true);}" +
      "choose.addEventListener('click',openPicker);document.getElementById('copy').addEventListener('click',async()=>{const cfg={GOOGLE_REFRESH_TOKEN:REFRESH,GOOGLE_DRIVE_FOLDER_ID:document.getElementById('folder').value};try{await navigator.clipboard.writeText(JSON.stringify(cfg,null,2));statusNode.textContent='Configuration copied.';}catch{statusNode.textContent='Clipboard unavailable; copy manually.';}});" +
      "function loadPicker(){gapi.load('picker',{callback:()=>{choose.disabled=false;choose.textContent='Select Google Drive folder';}});}" +
      "</script><script async defer src='https://apis.google.com/js/api.js' onload='loadPicker()'></script></body></html>";
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline' https://apis.google.com; style-src 'unsafe-inline'; connect-src https://www.googleapis.com; frame-src https://docs.google.com https://drive.google.com; img-src data: https://*.googleusercontent.com; base-uri 'none'; form-action 'none'");
    return res.status(200).send(html);
  } catch (error) {
    console.error("Google Drive OAuth callback failed", error);
    return res.status(502).send(messagePage("Google authorization could not be completed. Check Vercel function logs and restart setup."));
  }
}
