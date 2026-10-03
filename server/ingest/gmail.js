/**
 * The mailbox QuoVai writes to.
 *
 * Gmail's REST API, reached with the account's own OAuth credentials: a personal
 * Gmail inbox cannot be read by a service account, so the one-time consent that
 * produces a refresh token is the only way in. What that buys is the thing the
 * whole reservation half has been waiting for — notifications arriving by
 * themselves instead of being forwarded by hand.
 *
 * Four properties matter more than the API calls:
 *
 *   nothing is lost        a message is only marked processed after it has been
 *                          ingested. A crash, a 500 or a parse failure leaves it
 *                          exactly where it was, and the next poll sees it again.
 *   nothing is doubled     ingestion is idempotent on the Gmail message id, so
 *                          seeing it again is free. The marking is an optimisation,
 *                          not the correctness mechanism.
 *   one bad message        does not stop the batch. It is reported and retried next
 *                          time, because the other four in the inbox are somebody's
 *                          arrival tomorrow.
 *   the whole thing        is driven through an injected `fetch`, so every path —
 *                          pagination, a 500, a malformed body — is testable
 *                          without credentials and without a network.
 */

import { createOauthClient, GoogleError } from '../google.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Gmail's scopes, narrowest first. Read, and label what has been handled. */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

const headerOf = (payload, name) =>
  payload?.headers?.find((header) => header.name?.toLowerCase() === name)?.value ?? '';

const decode = (data) => (data ? Buffer.from(String(data), 'base64url').toString('utf8') : '');

/**
 * Pull the text out of a MIME tree.
 *
 * Gmail hands back a nested structure; the plain-text and HTML parts can be at any
 * depth and either may be missing. Both are collected because the parser reads
 * either, and HTML is what these notifications usually are.
 */
export function extractBodies(payload) {
  let text = '';
  let html = '';

  const walk = (part) => {
    if (!part) return;
    const type = String(part.mimeType ?? '').toLowerCase();
    if (type === 'text/plain' && !text) text = decode(part.body?.data);
    else if (type === 'text/html' && !html) html = decode(part.body?.data);
    for (const child of part.parts ?? []) walk(child);
  };

  walk(payload);
  // A single-part message carries its body on the root with no mimeType match.
  if (!text && !html && payload?.body?.data) text = decode(payload.body.data);
  return { text, html };
}

/** One Gmail message, in the shape the ingestion pipeline takes. */
export function normaliseMessage(message) {
  const payload = message.payload ?? {};
  const { text, html } = extractBodies(payload);
  const received = Number(message.internalDate);

  return {
    /** The RFC Message-Id when there is one, else Gmail's own id. Either is stable. */
    messageId: headerOf(payload, 'message-id') || `gmail:${message.id}`,
    subject: headerOf(payload, 'subject'),
    from: headerOf(payload, 'from'),
    body: text || html,
    html,
    receivedAt: Number.isFinite(received) ? new Date(received).toISOString() : new Date().toISOString(),
    /** Kept so the message can be labelled afterwards. */
    gmailId: message.id,
    threadId: message.threadId ?? null,
  };
}

export function createGmailMailbox(settings = {}) {
  const {
    gmailClientId, gmailClientSecret, gmailRefreshToken,
    gmailQuery, gmailProcessedLabelId, gmailMaxMessages,
    fetchImpl = fetch,
  } = settings;

  const client = createOauthClient({
    clientId: gmailClientId,
    clientSecret: gmailClientSecret,
    refreshToken: gmailRefreshToken,
    fetchImpl,
  });

  const query = gmailQuery || 'from:quovai newer_than:7d';
  /** A ceiling, so a first run against a full inbox cannot take all morning. */
  const cap = Number(gmailMaxMessages ?? 50);

  const state = { lastError: null, lastSuccessAt: null, lastCount: 0, skipped: [] };

  return {
    id: 'gmail',
    configured: client.configured,
    implemented: true,
    requires: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'],
    scopes: GMAIL_SCOPES,
    query,
    state: () => ({ ...state }),

    /**
     * Everything matching the query, oldest first.
     *
     * Two calls per message: Gmail's list gives ids, and only a `get` carries the
     * body. A message whose `get` fails is left out of the batch entirely, which
     * means it is neither ingested nor marked — so it comes back next time.
     */
    async fetchMessages() {
      if (!client.configured) {
        throw new GoogleError('gmail mailbox is not configured', { code: 'source-not-configured' });
      }

      const ids = [];
      let pageToken = '';

      // Pagination. Gmail returns 100 at a time by default and a token for the rest.
      do {
        const params = new URLSearchParams({ q: query, maxResults: String(Math.min(100, cap)) });
        if (pageToken) params.set('pageToken', pageToken);
        const page = await client.call(`${API}/messages?${params}`);
        for (const message of page.messages ?? []) ids.push(message.id);
        pageToken = page.nextPageToken ?? '';
      } while (pageToken && ids.length < cap);

      const wanted = ids.slice(0, cap).reverse();   // oldest first: a NEW before its MODIFIED
      const messages = [];
      const skipped = [];

      for (const id of wanted) {
        try {
          const full = await client.call(`${API}/messages/${encodeURIComponent(id)}?format=full`);
          messages.push(normaliseMessage(full));
        } catch (error) {
          // One unreadable message must not cost us the other four.
          skipped.push({ id, reason: error.code ?? 'fetch-failed', message: error.message });
        }
      }

      state.lastSuccessAt = new Date().toISOString();
      state.lastError = null;
      state.lastCount = messages.length;
      state.skipped = skipped;
      return messages;
    },

    /**
     * Mark one message handled.
     *
     * Only ever called after the pipeline has accepted it. Without a label
     * configured this does nothing, and the store's own de-duplication carries the
     * whole weight — which it is designed to do, so a failure to label is never a
     * failure to ingest.
     */
    async markProcessed(messageId, { gmailId } = {}) {
      const id = gmailId ?? messageId;
      if (!client.configured || !gmailProcessedLabelId || !id || String(id).includes('@')) return false;
      try {
        await client.call(`${API}/messages/${encodeURIComponent(id)}/modify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ addLabelIds: [gmailProcessedLabelId], removeLabelIds: ['UNREAD'] }),
        });
        return true;
      } catch (error) {
        // Labelling is bookkeeping. Losing it changes nothing about what was read.
        state.lastError = `label failed: ${error.message}`;
        return false;
      }
    },

    /** For the health screen: can we actually get a token right now? */
    async check() {
      if (!client.configured) return { ok: false, reason: 'credentials-missing' };
      try {
        await client.accessToken({ force: true });
        return { ok: true };
      } catch (error) {
        state.lastError = error.message;
        return { ok: false, reason: error.code ?? 'unavailable', message: error.message };
      }
    },

    recordError(error) { state.lastError = String(error?.message ?? error); },
  };
}
