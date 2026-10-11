import { createHash } from 'node:crypto';
import { decryptSecret, encryptSecret, signLink, verifyLink } from '@app/core';
import { getSecret } from './secrets.js';
import { requireEnv } from './env.js';
import type { Collections } from './db.js';

// Least privilege: identify the account, write shift events, read busy/free only, write drafts (never send).
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/gmail.compose',
];

import type { GoogleConnection } from './db.js';
export type { GoogleConnection };

const connections = (c: Collections) => c.googleConnections;

async function clientCreds() {
  const raw = await getSecret('/coord/google-oauth-client');
  return JSON.parse(raw) as { id: string; secret: string };
}
const tokenKey = () => getSecret('/coord/token-key');
const stateSecret = () => getSecret(requireEnv('DASHBOARD_SECRET_PARAM'));
export const redirectUri = () => requireEnv('GOOGLE_REDIRECT_URI');

/** Opaque, so the OAuth state (visible in URLs) never carries a phone number. */
export const coordinatorRef = (phone: string) => `g:${createHash('sha256').update(phone).digest('base64url').slice(0, 16)}`;

export async function authUrl(coordinator: string): Promise<string> {
  const { id } = await clientCreds();
  const state = signLink(await stateSecret(), coordinatorRef(coordinator), new Date(Date.now() + 15 * 60_000));
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

/** Exchange the callback code and store the encrypted refresh token for this coordinator. */
export async function completeConnection(c: Collections, coordinator: string, code: string): Promise<GoogleConnection> {
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
    _id: coordinator,
    email: email ?? 'your Google account',
    refreshTokenSealed: encryptSecret(await tokenKey(), tok.refresh_token),
    scopes: (tok.scope ?? '').split(' ').filter(Boolean),
    connectedAt: new Date(),
  };
  await connections(c).replaceOne({ _id: coordinator }, conn, { upsert: true });
  accessCache.delete(coordinator);
  return conn;
}

export const getConnection = (c: Collections, coordinator: string) => connections(c).findOne({ _id: coordinator });

export async function disconnect(c: Collections, coordinator: string) {
  const conn = await getConnection(c, coordinator);
  if (!conn) return false;
  const refresh = decryptSecret(await tokenKey(), conn.refreshTokenSealed);
  // Revoke at Google too, so the grant disappears from their account, not just our database.
  await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresh }) }).catch(() => {});
  await connections(c).deleteOne({ _id: coordinator });
  accessCache.delete(coordinator);
  return true;
}

const accessCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(c: Collections, coordinator: string): Promise<string> {
  const hit = accessCache.get(coordinator);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const conn = await getConnection(c, coordinator);
  if (!conn) throw new GoogleNotConnected();
  const { id, secret } = await clientCreds();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: decryptSecret(await tokenKey(), conn.refreshTokenSealed), grant_type: 'refresh_token' }),
  });
  const tok = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !tok.access_token) {
    // invalid_grant = revoked, or a Testing-mode app's 7-day refresh token expired. Ask to reconnect.
    if (tok.error === 'invalid_grant') await connections(c).deleteOne({ _id: coordinator });
    throw new GoogleNotConnected(tok.error);
  }
  accessCache.set(coordinator, { token: tok.access_token, expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000 });
  return tok.access_token;
}

export class GoogleNotConnected extends Error {
  constructor(reason?: string) {
    super(reason === 'invalid_grant' ? 'Google access expired or was revoked; reconnect with connect_google.' : 'Google is not connected; use connect_google.');
  }
}

/** Authenticated JSON call to a Google API on the coordinator's behalf. */
export async function googleApi<T>(c: Collections, coordinator: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${await accessToken(c, coordinator)}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Google API ${res.status}: ${json.error?.message ?? 'request failed'}`);
  return json;
}
