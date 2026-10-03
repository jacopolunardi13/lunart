/**
 * Sending the guide email from LunArt's own address.
 *
 * Gmail's API rather than SMTP, for one reason: the credentials already exist for
 * reading the mailbox, so sending costs one more scope instead of a second account
 * and an app password. The message leaves from `lunartfirenze@gmail.com` and lands
 * in the guest's inbox with LunArt's own name on it, which matters when the
 * alternative is a transactional sender nobody recognises.
 *
 * The message itself is built here as RFC 5322 rather than handed to a library:
 * it is one multipart/alternative with a text part and an HTML part, and the whole
 * value of a library at this size is a dependency to keep up to date.
 *
 * Nothing about *when* to send lives here. The schedule, the one-delivery-per-
 * reservation rule and the cancellation handling are all in `delivery.js`; this is
 * only the transport, which is why swapping it for SMTP later changes one file.
 */

import { createOauthClient, GoogleError } from '../google.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/** A header value that is not plain ASCII has to say so, or it arrives as mojibake. */
export function encodeHeader(value) {
  const text = String(value ?? '');
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

const addressOf = (name, email) => (name ? `${encodeHeader(name)} <${email}>` : email);

/** Wrap base64 at 76 characters, as the standard asks and some servers insist. */
const chunk = (value) => (value.match(/.{1,76}/g) ?? []).join('\r\n');

/**
 * One message, as the bytes Gmail wants.
 *
 * Exported on its own so the construction can be read and tested without sending
 * anything — which is also how the simulated mailer shows a body to staff.
 */
export function buildMimeMessage({ to, from, fromName = 'LunArt Firenze', subject, text, html, replyTo = '' }) {
  const boundary = `lunart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const lines = [
    `From: ${addressOf(fromName, from)}`,
    `To: ${to}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    chunk(Buffer.from(text ?? '', 'utf8').toString('base64')),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    chunk(Buffer.from(html ?? '', 'utf8').toString('base64')),
    '',
    `--${boundary}--`,
    '',
  ];
  return lines.join('\r\n');
}

/**
 * The Gmail sender.
 *
 * Returns `{ simulated: false, id }` on success and throws on failure, which is
 * what `sendDueGuideEmails` expects: a throw records the delivery as `failed` with
 * the reason and leaves it to be retried on the next run. It never marks a delivery
 * sent on its own, so a transport failure cannot lose a guest their guide.
 */
export function createGmailMailer(settings = {}) {
  const {
    gmailClientId, gmailClientSecret, gmailRefreshToken,
    mailFrom = 'lunartfirenze@gmail.com', mailReplyTo = '',
    fetchImpl = fetch,
  } = settings;

  const client = createOauthClient({
    clientId: gmailClientId,
    clientSecret: gmailClientSecret,
    refreshToken: gmailRefreshToken,
    fetchImpl,
  });

  const state = { lastError: null, lastSuccessAt: null, sent: 0 };

  return {
    id: 'gmail',
    implemented: true,
    configured: client.configured,
    requires: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'MAIL_FROM'],
    scopes: [GMAIL_SEND_SCOPE],
    from: mailFrom,
    state: () => ({ ...state }),

    async send({ to, subject, text, html }) {
      if (!client.configured) {
        throw new GoogleError('gmail sender is not configured', { code: 'source-not-configured' });
      }
      const raw = buildMimeMessage({ to, from: mailFrom, subject, text, html, replyTo: mailReplyTo });
      try {
        const result = await client.call(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') }),
        });
        state.sent += 1;
        state.lastSuccessAt = new Date().toISOString();
        state.lastError = null;
        return { simulated: false, id: result.id, threadId: result.threadId ?? null };
      } catch (error) {
        state.lastError = error.message;
        throw error;
      }
    },

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
  };
}
