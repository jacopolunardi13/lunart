/**
 * Where the emails are read from.
 *
 * The ingestion pipeline takes `{ subject, from, body, messageId }`. Anything that
 * can produce that is a mailbox: Gmail's API, an IMAP connection, a forwarding
 * webhook, a folder of `.eml` files. Keeping that boundary this thin is what lets
 * the parser and the reservation model be tested without a mailbox existing at all.
 *
 * Nothing is connected. LunArt has given no mail credentials, so the only mailbox
 * registered is the in-memory one the tests and the preview use, and the Gmail
 * adapter is a described seam that reports itself unconfigured rather than a stub
 * that pretends. `/api/health` prints which is which.
 */

const sources = new Map();

/**
 * @typedef {object} MailboxAdapter
 * @property {string} id
 * @property {boolean} configured
 * @property {() => Promise<object[]>} fetchMessages  newest-last, already normalised
 * @property {(messageId: string) => Promise<void>} [markProcessed]
 */

export const registerMailbox = (id, factory) => sources.set(id, factory);
export const mailboxSources = () => [...sources.entries()].map(([id, factory]) => {
  const probe = factory({});
  return { id, configured: Boolean(probe.configured) };
});

/** A mailbox fed by hand. The preview uses it; so do the tests. */
export function createMemoryMailbox(initial = []) {
  let queue = [...initial];
  return {
    id: 'memory',
    configured: true,
    async fetchMessages() {
      const batch = queue;
      queue = [];
      return batch;
    },
    push(...messages) { queue.push(...messages); },
    pending: () => queue.length,
  };
}
registerMailbox('memory', () => createMemoryMailbox());

/**
 * Gmail, as a seam.
 *
 * What it needs is written down rather than guessed at: an OAuth client, a refresh
 * token for the mailbox that receives the QuoVai notifications, and a query to find
 * them with. Until those exist this reports `configured: false` and every call
 * refuses, which is the honest state — an adapter that invented an empty inbox
 * would make a silent failure look like a quiet morning.
 */
export function createGmailMailbox(settings = {}) {
  const { gmailClientId, gmailClientSecret, gmailRefreshToken, gmailQuery } = settings;
  const configured = Boolean(gmailClientId && gmailClientSecret && gmailRefreshToken);
  return {
    id: 'gmail',
    configured,
    requires: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_QUERY'],
    query: gmailQuery ?? 'from:quovai newer_than:7d',
    async fetchMessages() {
      if (!configured) {
        throw Object.assign(new Error('gmail mailbox is not configured'), { code: 'source-not-configured' });
      }
      // The call itself is deliberately absent: writing it against credentials that
      // do not exist would be writing it twice. What the rest of the system needs
      // from here is the shape above, and that is already agreed.
      throw Object.assign(new Error('gmail mailbox adapter is not implemented yet'), { code: 'not-implemented' });
    },
  };
}
registerMailbox('gmail', (settings) => createGmailMailbox(settings));

/** Pick the mailbox the configuration asks for. */
export function createMailbox(settings = {}) {
  const chosen = settings.mailboxSource ?? '';
  const factory = sources.get(chosen);
  if (!factory) return null;
  return factory(settings);
}

/** Read whatever is waiting and hand it to the pipeline. */
export async function pollMailbox({ store, mailbox, ingest, now = new Date() }) {
  if (!mailbox) return { ok: false, reason: 'no-mailbox-configured' };
  if (!mailbox.configured) return { ok: false, reason: 'source-not-configured', source: mailbox.id };

  let messages;
  try {
    messages = await mailbox.fetchMessages();
  } catch (error) {
    return { ok: false, reason: error.code ?? 'fetch-failed', message: error.message, source: mailbox.id };
  }

  const outcome = await ingest({ store, messages, now });
  if (mailbox.markProcessed) {
    for (const message of messages) {
      if (message.messageId) await mailbox.markProcessed(message.messageId);
    }
  }
  return { ok: true, source: mailbox.id, ...outcome };
}
