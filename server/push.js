/**
 * Telling staff something happened.
 *
 * The Staff app is a web app on two phones, so the notification channel is Web
 * Push: a subscription per device, a VAPID key pair for the server, and a payload
 * per event. All of that needs keys LunArt has not generated yet, so this module is
 * built the way the rest of the integrations are — the shape is real, the transport
 * is an adapter, and the unconfigured state is loud rather than silent.
 *
 * Degraded mode is the important part. With no keys:
 *
 *   - the Staff app still works, because it polls;
 *   - subscriptions are still accepted and stored, so devices are registered the
 *     moment keys exist;
 *   - every notification is recorded in the outbox and marked `simulated`, so the
 *     wording can be read and checked;
 *   - `/api/health` and the Staff app's own sync screen say push is not configured.
 *
 * What it must never do is look like it is working.
 */

const notifications = [];

/** The events worth a buzz. The wording is the notification, so it lives here. */
export const PUSH_EVENTS = {
  'order-new': {
    title: (data) => (data.express ? `EXPRESS — ${data.title}` : data.title),
    body: (data) => [
      data.room ? `Camera ${data.room}` : null,
      data.amount,
      data.when ? `Richiesto ${data.when}` : null,
    ].filter(Boolean).join(' · '),
    tag: (data) => `order:${data.orderId}`,
  },
  'order-awaiting': {
    title: (data) => data.title,
    body: () => 'In attesa di conferma del fornitore',
    tag: (data) => `order:${data.orderId}`,
  },
  'reservation-new': {
    title: () => 'Nuova prenotazione',
    body: (data) => [data.guest, data.room ? `Camera ${data.room}` : null, `${data.check_in} → ${data.check_out}`]
      .filter(Boolean).join(' · '),
    tag: (data) => `reservation:${data.reservationId}`,
  },
  'reconciliation': {
    title: () => 'Da verificare',
    body: (data) => data.message ?? 'Occupazione rilevata ma non sincronizzata',
    tag: (data) => `alert:${data.key}`,
  },
};

/** Build the payload a service worker will render. */
export function buildNotification(event, data = {}) {
  const shape = PUSH_EVENTS[event];
  if (!shape) return null;
  return {
    event,
    title: shape.title(data),
    body: shape.body(data),
    tag: shape.tag(data),
    url: data.url ?? '/staff',
    at: new Date().toISOString(),
  };
}

/**
 * The push adapter.
 *
 * `configured` is true only when there is a VAPID key pair and a subject to send
 * with. Everything else about the interface is the same either way, so no caller
 * has to branch on it.
 */
export function createPushAdapter(settings = {}) {
  const { vapidPublicKey, vapidPrivateKey, vapidSubject } = settings;
  const configured = Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject);

  return {
    id: configured ? 'web-push' : 'simulated',
    configured,
    publicKey: vapidPublicKey ?? '',
    requires: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],

    /**
     * Send one notification to one subscription.
     *
     * The real path needs encryption to the subscription's own key pair, which is
     * where a library belongs rather than a hand-rolled implementation of RFC 8291.
     * Unconfigured, it records and reports `simulated: true`.
     */
    async send(subscription, payload) {
      notifications.push({ endpoint: subscription?.endpoint ?? null, payload, simulated: !configured });
      if (!configured) return { simulated: true };
      throw Object.assign(
        new Error('web push transport is not wired yet: VAPID keys exist but no sender is configured'),
        { code: 'not-implemented' },
      );
    },

    outbox: () => [...notifications],
    clear: () => { notifications.length = 0; },
  };
}

/**
 * Notify every registered device.
 *
 * A subscription that the browser has dropped comes back as a 404 or a 410 from the
 * push service; it is removed rather than retried forever. Nothing here throws: a
 * notification failing must not fail the order it was about.
 */
export async function notifyStaff({ store, push, event, data = {} }) {
  const payload = buildNotification(event, data);
  if (!payload) return { ok: false, reason: 'unknown-event' };

  const subscriptions = await store.subscriptions.list({ limit: 50 });
  const results = [];

  for (const subscription of subscriptions) {
    try {
      const outcome = await push.send(subscription, payload);
      results.push({ endpoint: subscription.endpoint, ...outcome });
    } catch (error) {
      const gone = error.statusCode === 404 || error.statusCode === 410;
      if (gone) await store.subscriptions.remove(subscription.id);
      results.push({ endpoint: subscription.endpoint, error: String(error.message ?? error), removed: gone });
    }
  }

  return {
    ok: true,
    configured: push.configured,
    delivered: results.filter((r) => !r.error).length,
    simulated: !push.configured,
    devices: subscriptions.length,
    payload,
    results,
  };
}

/** Register a device. Accepted even with no keys, so nothing has to be redone later. */
export async function registerSubscription({ store, subscription, label = '' }) {
  const endpoint = String(subscription?.endpoint ?? '').trim();
  if (!endpoint.startsWith('https://')) return { ok: false, reason: 'invalid-subscription' };

  const existing = await store.subscriptions.findByEndpoint(endpoint);
  const record = {
    endpoint,
    keys: {
      p256dh: String(subscription?.keys?.p256dh ?? '').slice(0, 200),
      auth: String(subscription?.keys?.auth ?? '').slice(0, 100),
    },
    label: String(label ?? '').slice(0, 60),
  };
  const saved = existing
    ? await store.subscriptions.update(existing.id, record)
    : await store.subscriptions.create(record);
  return { ok: true, id: saved.id, existing: Boolean(existing) };
}
