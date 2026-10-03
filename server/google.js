/**
 * Talking to Google: the two ways in, and nothing else.
 *
 * Three integrations need Google — the mailbox that receives QuoVai's
 * notifications, the account that sends the guide email, and the hair
 * professional's calendar. They need two different credentials, so both are here
 * rather than copied into three files:
 *
 *   installed app     a client id, a secret and a refresh token, for a mailbox
 *                     somebody consented to once. This is how Gmail works, because
 *                     a personal Gmail account cannot be reached by a service
 *                     account.
 *   service account   an email and a private key, signing a JWT assertion. This is
 *                     how a calendar shared with that account works, with no
 *                     consent screen and nobody's password.
 *
 * Access tokens are cached until a minute before they expire, because every call
 * here is a round trip and Google's are not fast.
 *
 * `fetchImpl` is injected everywhere so all of this is testable with a function
 * instead of a network — which is the only honest way to test an integration whose
 * credentials do not exist yet.
 */

import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Refresh a minute early: a token that expires mid-flight is a failed poll. */
const EARLY_MS = 60_000;

export class GoogleError extends Error {
  constructor(message, { status = 0, code = 'google-error', body = null } = {}) {
    super(message);
    this.name = 'GoogleError';
    this.status = status;
    this.code = code;
    this.body = body;
    /** A 5xx or a dropped connection is worth retrying; a 401 is not. */
    this.retryable = status === 0 || status === 429 || status >= 500;
  }
}

const base64url = (input) => Buffer.from(input).toString('base64url');

/**
 * One request, with a timeout and an error that says what happened.
 *
 * Google answers errors as JSON with a shape of its own; the useful part is lifted
 * out so a log line reads `invalid_grant` rather than a wall of JSON.
 */
export async function googleFetch(url, { method = 'GET', headers = {}, body, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { method, headers, body, signal: controller.signal });
  } catch (error) {
    throw new GoogleError(`request to ${hostOf(url)} failed: ${error.message}`, { code: 'network' });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 400) }; }

  if (!response.ok) {
    const detail = payload?.error?.message ?? payload?.error_description ?? payload?.error ?? response.statusText;
    throw new GoogleError(`${hostOf(url)} responded ${response.status}: ${detail}`, {
      status: response.status,
      code: payload?.error?.status ?? payload?.error ?? 'http-error',
      body: payload,
    });
  }
  return payload;
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url); } };

/**
 * An access token from a refresh token.
 *
 * The refresh token is the long-lived thing and never leaves the environment; this
 * exchanges it for the short-lived one Google actually accepts.
 */
export function createOauthClient({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  let cached = null;

  const configured = Boolean(clientId && clientSecret && refreshToken);

  async function accessToken({ force = false } = {}) {
    if (!configured) {
      throw new GoogleError('google oauth is not configured', { code: 'source-not-configured' });
    }
    if (!force && cached && cached.expiresAt > Date.now() + EARLY_MS) return cached.token;

    const payload = await googleFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      fetchImpl,
    });

    cached = {
      token: payload.access_token,
      expiresAt: Date.now() + (Number(payload.expires_in ?? 3600) * 1000),
    };
    return cached.token;
  }

  /**
   * A call to a Google API, with the token handled.
   *
   * A 401 is retried exactly once with a fresh token, because the usual cause is a
   * token that expired between being fetched and being used.
   */
  async function call(url, options = {}) {
    const token = await accessToken();
    try {
      return await googleFetch(url, { ...options, headers: { authorization: `Bearer ${token}`, ...options.headers }, fetchImpl });
    } catch (error) {
      if (error.status !== 401) throw error;
      const fresh = await accessToken({ force: true });
      return googleFetch(url, { ...options, headers: { authorization: `Bearer ${fresh}`, ...options.headers }, fetchImpl });
    }
  }

  return { configured, accessToken, call, forget: () => { cached = null; } };
}

/**
 * An access token from a service account, for the calendar.
 *
 * A signed JWT asserting "this account wants these scopes", exchanged for a token.
 * `subject` is there for the day LunArt has a Workspace domain and wants the
 * service account to act as a person in it; with a shared personal calendar it
 * stays empty.
 */
export function createServiceAccountClient({ email, privateKey, scopes = [], subject = '', fetchImpl = fetch }) {
  let cached = null;
  const configured = Boolean(email && privateKey);

  function assertion() {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({
      iss: email,
      scope: scopes.join(' '),
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
      ...(subject ? { sub: subject } : {}),
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    // The key arrives from an environment variable, where real newlines rarely
    // survive; both shapes are accepted so nobody has to debug a PEM at midnight.
    const pem = String(privateKey).includes('\\n') ? String(privateKey).replace(/\\n/g, '\n') : String(privateKey);
    return `${header}.${claims}.${signer.sign(pem, 'base64url')}`;
  }

  async function accessToken({ force = false } = {}) {
    if (!configured) {
      throw new GoogleError('google service account is not configured', { code: 'source-not-configured' });
    }
    if (!force && cached && cached.expiresAt > Date.now() + EARLY_MS) return cached.token;

    const payload = await googleFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: assertion(),
      }).toString(),
      fetchImpl,
    });

    cached = { token: payload.access_token, expiresAt: Date.now() + (Number(payload.expires_in ?? 3600) * 1000) };
    return cached.token;
  }

  async function call(url, options = {}) {
    const token = await accessToken();
    try {
      return await googleFetch(url, { ...options, headers: { authorization: `Bearer ${token}`, ...options.headers }, fetchImpl });
    } catch (error) {
      if (error.status !== 401) throw error;
      const fresh = await accessToken({ force: true });
      return googleFetch(url, { ...options, headers: { authorization: `Bearer ${fresh}`, ...options.headers }, fetchImpl });
    }
  }

  return { configured, accessToken, call, forget: () => { cached = null; } };
}
