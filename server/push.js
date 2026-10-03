/**
 * Telling staff something happened.
 *
 * The Staff app is a web app on two phones, so the channel is Web Push: a
 * subscription per device, a VAPID key pair for the server, a payload per event.
 * The encryption that makes that work — ECDH to the subscription's own key pair,
 * HKDF, AES-GCM, a signed JWT for the push service — is implemented by `web-push`,
 * which is the library everyone uses and the one thing in this codebase it would be
 * irresponsible to write by hand.
 *
 * Degraded mode is the part worth reading. With no keys:
 *
 *   - the Staff app still works, because it polls;
 *   - subscriptions are still accepted and stored, so devices are registered the
 *     moment keys exist;
 *   - every notification is recorded and marked `simulated`, so the wording can be
 *     read and checked;
 *   - `/api/health` and the Staff app's sync screen say push is not configured.
 *
 * And in either mode, a notification that fails can never fail the thing it was
 * about: an order is paid whether or not a phone buzzed.
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
/**
 * Load `web-push` once, lazily.
 *
 * Lazily because the server must still boot where it is not installed — a static
 * preview, a checkout with `--omit=optional` — and once because setting the VAPID
 * details is global to the module.
 */
let transportPromise = null;
async function loadTransport({ publicKey, privateKey, subject }) {
  if (!transportPromise) {
    transportPromise = import('web-push')
      .then((module) => {
        const webpush = module.default ?? module;
        webpush.setVapidDetails(subject, publicKey, privateKey);
        return webpush;
      })
      .catch((error) => {
        transportPromise = null;
        throw Object.assign(new Error(`web-push is not available: ${error.message}`), { code: 'transport-missing' });
      });
  }
  return transportPromise;
}

/** For tests, and for a restart after the keys change. */
export const resetPushTransport = () => { transportPromise = null; };

/**
 * The push adapter.
 *
 * `configured` is true only with a key pair and a subject. Everything else about
 * the interface is identical either way, so no caller has to branch on it.
 */
export function createPushAdapter(settings = {}) {
  const { vapidPublicKey, vapidPrivateKey, vapidSubject, pushTransport = null } = settings;
  const configured = Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject);
  const state = { sent: 0, failed: 0, removed: 0, lastError: null, lastSuccessAt: null };

  return {
    id: configured ? 'web-push' : 'simulated',
    implemented: true,
    configured,
    publicKey: vapidPublicKey ?? '',
    requires: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
    state: () => ({ ...state }),

    /**
     * Send one notification to one subscription.
     *
     * The return value says what the caller has to do about the subscription:
     * `gone` means the browser dropped it and it should be deleted, anything else
     * means keep it and try again next time. A 404 or a 410 is the push service
     * saying the endpoint is dead; a 500 is the push service having a bad morning,
     * and deleting a device over that would be losing a phone for no reason.
     */
    async send(subscription, payload) {
      if (!configured) {
        notifications.push({ endpoint: subscription?.endpoint ?? null, payload, simulated: true });
        return { simulated: true };
      }

      const transport = pushTransport ?? await loadTransport({
        publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: vapidSubject,
      });

      try {
        const result = await transport.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.keys?.p256dh, auth: subscription.keys?.auth },
          },
          JSON.stringify(payload),
          { TTL: 60 * 60, urgency: 'high' },
        );
        state.sent += 1;
        state.lastSuccessAt = new Date().toISOString();
        notifications.push({ endpoint: subscription.endpoint, payload, simulated: false });
        return { simulated: false, status: result?.statusCode ?? 201 };
      } catch (error) {
        const status = error.statusCode ?? error.status ?? 0;
        state.failed += 1;
        state.lastError = `${status || 'network'}: ${error.message}`;
        if (status === 404 || status === 410) {
          state.removed += 1;
          return { simulated: false, gone: true, status };
        }
        return { simulated: false, error: error.message, status };
      }
    },

    outbox: () => [...notifications],
    clear: () => { notifications.length = 0; },

    async check() {
      if (!configured) return { ok: false, reason: 'credentials-missing' };
      try {
        await (pushTransport ? Promise.resolve(pushTransport) : loadTransport({
          publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: vapidSubject,
        }));
        return { ok: true };
      } catch (error) {
        state.lastError = error.message;
        return { ok: false, reason: error.code ?? 'unavailable', message: error.message };
      }
    },
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
      if (outcome.gone) await store.subscriptions.remove(subscription.id);
      results.push({ endpoint: subscription.endpoint, ...outcome, removed: Boolean(outcome.gone) });
    } catch (error) {
      // A throw from the transport is treated as temporary: the device stays.
      results.push({ endpoint: subscription.endpoint, error: String(error.message ?? error), removed: false });
    }
  }

  return {
    ok: true,
    configured: push.configured,
    delivered: results.filter((r) => !r.error && !r.gone).length,
    removed: results.filter((r) => r.removed).length,
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
