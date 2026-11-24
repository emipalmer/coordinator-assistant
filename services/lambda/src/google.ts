import { createHash } from 'node:crypto';
import { decryptSecret, encryptSecret, PARAMS, signLink, verifyLink } from '@app/core';
import { getSecret } from './secrets.js';
import { requireEnv } from './env.js';
import type { Collections, GoogleConnection } from './db.js';

export type { GoogleConnection };

export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

// Personal-assistant scopes: read and edit events on all of the owner's calendars, list them,
// read mail, write drafts, and manage Google Tasks. There is deliberately no gmail.send / gmail.modify:
// it can never send or delete mail.
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  TASKS_SCOPE,
];

const connections = (c: Collections) => c.googleConnections;

async function clientCreds() {
  return JSON.parse(await getSecret(PARAMS.googleClient)) as { id: string; secret: string };
}
const tokenKey = () => getSecret(PARAMS.tokenKey);
const stateSecret = () => getSecret(PARAMS.stateSecret);
export const redirectUri = () => requireEnv('GOOGLE_REDIRECT_URI');

/** Opaque, so the OAuth state (visible in URLs) never carries a phone number. */
export const ownerRef = (phone: string) => `g:${createHash('sha256').update(phone).digest('base64url').slice(0, 16)}`;

export async function authUrl(owner: string): Promise<string> {
  const { id } = await clientCreds();
  const state = signLink(await stateSecret(), ownerRef(owner), new Date(Date.now() + 15 * 60_000));
  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // guarantees a refresh token even on reconnect
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function verifyState(state: string | undefined): Promise<string | null> {
  return verifyLink(await stateSecret(), state);
}

/** Exchange the callback code and store the encrypted refresh token for this owner. */
export async function completeConnection(c: Collections, owner: string, code: string): Promise<GoogleConnection> {
  const { id, secret } = await clientCreds();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
  });
  const tok = (await res.json()) as { refresh_token?: string; id_token?: string; scope?: string; error?: string };
  if (!res.ok || !tok.refresh_token) throw new Error(`token exchange failed: ${tok.error ?? res.status}`);
  // id_token comes straight from Google's token endpoint over TLS, so decoding (not verifying) is sufficient here.
  const email = tok.id_token ? (JSON.parse(Buffer.from(tok.id_token.split('.')[1]!, 'base64url').toString()) as { email?: string }).email : undefined;
  const conn: GoogleConnection = {
    _id: owner,
    email: email ?? 'your Google account',
    refreshTokenSealed: encryptSecret(await tokenKey(), tok.refresh_token),
    scopes: (tok.scope ?? '').split(' ').filter(Boolean),
    connectedAt: new Date(),
  };
  await connections(c).replaceOne({ _id: owner }, conn, { upsert: true });
  accessCache.delete(owner);
  return conn;
}

// An expired connection keeps its record but no longer counts as connected.
export const getConnection = (c: Collections, owner: string) => connections(c).findOne({ _id: owner, expiredAt: { $exists: false } });

/** Scopes the user didn't tick on Google's consent screen (it lets them untick individual ones). */
export const missingScopes = (conn: GoogleConnection) => GOOGLE_SCOPES.filter((s) => s.startsWith('https://') && !conn.scopes.includes(s));

export async function disconnect(c: Collections, owner: string) {
  const conn = await getConnection(c, owner);
  if (!conn) return false;
  const refresh = decryptSecret(await tokenKey(), conn.refreshTokenSealed);
  // Revoke at Google too, so the grant disappears from their account, not just our database.
  await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresh }) }).catch(() => {});
  await connections(c).deleteOne({ _id: owner });
  accessCache.delete(owner);
  return true;
}

const accessCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(c: Collections, owner: string): Promise<string> {
  const hit = accessCache.get(owner);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const conn = await getConnection(c, owner);
  if (!conn) throw new GoogleNotConnected();
  const { id, secret } = await clientCreds();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: decryptSecret(await tokenKey(), conn.refreshTokenSealed), grant_type: 'refresh_token' }),
  });
  const tok = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !tok.access_token) {
    // invalid_grant = revoked, or (in Testing status) the 7-day refresh token expired. Ask to reconnect.
    if (tok.error === 'invalid_grant') await connections(c).updateOne({ _id: owner }, { $set: { expiredAt: new Date() }, $unset: { refreshTokenSealed: '' } });
    throw new GoogleNotConnected(tok.error);
  }
  accessCache.set(owner, { token: tok.access_token, expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000 });
  return tok.access_token;
}

export class GoogleNotConnected extends Error {
  constructor(reason?: string) {
    super(reason === 'invalid_grant' ? 'Google access expired or was revoked; reconnect with connect_google.' : 'Google is not connected; use connect_google.');
  }
}

/** Authenticated JSON call to a Google API on the owner's behalf. */
export async function googleApi<T>(c: Collections, owner: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${await accessToken(c, owner)}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Google API ${res.status}: ${json.error?.message ?? 'request failed'}`);
  return json;
}
