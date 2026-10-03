/**
 * Where the emails are read from.
 *
 * The ingestion pipeline takes `{ subject, from, body, messageId }`. Anything that
 * can produce that is a mailbox: Gmail's API, an IMAP connection, a forwarding
 * webhook, a folder of `.eml` files. Keeping that boundary this thin is what lets
 * the parser and the reservation model be tested without a mailbox existing at all.
 *
 * Two are registered. `memory` is fed by hand, which is what the tests and the
 * preview use. `gmail` is the real one — implemented, waiting only on the one-time
 * consent that produces a refresh token. It reports `configured: false` until those
 * exist and refuses every call rather than quietly returning an empty inbox, which
 * would make a silent failure look like a quiet morning.
 */

import { createGmailMailbox } from './gmail.js';

const sources = new Map();

/**
 * @typedef {object} MailboxAdapter
 * @property {string} id
 * @property {boolean} configured
 * @property {() => Promise<object[]>} fetchMessages  newest-last, already normalised
 * @property {(messageId: string) => Promise<void>} [markProcessed]
 */

export const registerMailbox = (id, factory) => sources.set(id, factory);
export const mailboxSources = (settings = {}) => [...sources.entries()].map(([id, factory]) => {
  const probe = factory(settings);
  return {
    id,
    implemented: probe.implemented !== false,
    configured: Boolean(probe.configured),
    requires: probe.requires ?? [],
  };
});

/** A mailbox fed by hand. The preview uses it; so do the tests. */
export function createMemoryMailbox(initial = []) {
  let queue = [...initial];
  return {
    id: 'memory',
    configured: true,
    implemented: true,
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

  /**
   * Ingest first, mark second.
   *
   * The order is the whole point: a message marked before it was ingested is a
   * reservation nobody will ever see again. Only the ones the pipeline actually
   * accepted are marked, and a message it refused stays unmarked on purpose, so
   * the next poll brings it back.
   */
  const outcome = await ingest({ store, messages, now });
  if (mailbox.markProcessed) {
    for (let i = 0; i < messages.length; i++) {
      const result = outcome.results?.[i];
      if (!result?.ok) continue;
      await mailbox.markProcessed(messages[i].messageId, { gmailId: messages[i].gmailId });
    }
  }
  return { ok: true, source: mailbox.id, skipped: mailbox.state?.().skipped ?? [], ...outcome };
}

export { createGmailMailbox };
