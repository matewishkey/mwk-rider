// Google service-account auth — mint an OAuth access token from a service-account
// key, zero dependencies (built-in crypto signs the RS256 JWT). Used by the
// `google` check domain (Search Console + Analytics Admin APIs).
//
// The service-account key is resolved in order:
//   1. $GOOGLE_SERVICE_ACCOUNT_JSON    raw JSON (or base64 of it), single value
//   2. $GOOGLE_APPLICATION_CREDENTIALS path to the JSON key file (Google's own convention)
//
// Without a key it returns { skip: <reason> } so callers degrade gracefully.
// One-time operator setup (not in this repo): a GCloud project with the Search
// Console + Site Verification + Analytics Admin APIs enabled, a service account
// granted read access to the operator's GA account, its key stored as above.

import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// scopes: string | string[]. Returns { token, email } or { skip: '<reason>' }.
export async function getAccessToken(scopes) {
  const raw = resolveCreds();
  if (!raw) {
    return { skip: 'no Google service-account key — set $GOOGLE_SERVICE_ACCOUNT_JSON (the key JSON, raw or base64) or $GOOGLE_APPLICATION_CREDENTIALS (path to the key file)' };
  }
  let sa;
  try { sa = parseSA(raw); }
  catch { return { skip: 'Google service-account key is not valid JSON (expected the downloaded key file contents, raw or base64)' }; }
  if (!sa.client_email || !sa.private_key) {
    return { skip: 'Google service-account key is missing client_email / private_key' };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  let signature;
  try {
    signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  } catch (e) {
    return { skip: `could not sign the JWT with the service-account private key: ${e.message}` };
  }
  const assertion = `${unsigned}.${signature}`;

  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
  } catch (e) {
    return { skip: `network error reaching the Google token endpoint: ${e.message}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { skip: `Google token exchange failed (HTTP ${res.status})${body ? ': ' + body.slice(0, 180) : ''}` };
  }
  const json = await res.json().catch(() => null);
  if (!json?.access_token) return { skip: 'Google token endpoint returned no access_token' };
  return { token: json.access_token, email: sa.client_email };
}

function parseSA(raw) {
  let s = raw.trim();
  if (!s.startsWith('{')) s = Buffer.from(s, 'base64').toString('utf8'); // tolerate base64-wrapped JSON
  return JSON.parse(s);
}

const b64url = (s) => Buffer.from(s).toString('base64url');

function resolveCreds() {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) return inline;

  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path && existsSync(path)) {
    try { return readFileSync(path, 'utf8'); } catch { return null; }
  }
  return null;
}
