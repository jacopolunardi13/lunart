/**
 * The operational pass: what the two phones are told, and the one-off catch-up.
 *
 * Three different kinds of mistake are under test here, and none of them is a
 * crash. A notification that fires twice teaches staff to ignore the phone. A
 * notification that does not fire at all means a breakfast gets made for somebody
 * who cancelled it. And an email operation that cannot be previewed, or that is
 * not idempotent, is a thing nobody will dare press on the morning it matters.
 *
 * So these count: how many pushes, with which event, after which outcome; and how
 * many guests a catch-up would write to, how many it actually wrote to, and how
 * many it would write to if you pressed it again.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createApp, handleStripeEvent } from '../server/app.js';
import { createStore } from '../server/store.js';
import { orderReference } from '../server/orders.js';
import { staffOrderView } from '../server/staff.js';
import { createMockStripe } from '../server/stripe.js';
import { createPushAdapter, registerSubscription, buildNotification } from '../server/push.js';
import {
  DELIVERY_STATUS, scheduleGuideEmail, cancelGuideEmail, sendDueGuideEmails,
  sendTimeFor, GUIDE_EMAIL_LEAD_DAYS, GUIDE_EMAIL_HOUR,
} from '../server/delivery.js';
import { previewGuideCatchUp, runGuideCatchUp, maskEmail, CATCHUP_SKIP } from '../server/catchup.js';
import { buildReservation, RESERVATION_STATUS } from '../server/reservations.js';
import { applyPriceOverrides } from '../commerce/prices.js';
import { DEV_PRICES } from '../commerce/prices.dev.js';
import { propertyDate, propertyTimeToInstant, addDays } from '../commerce/time.js';

/* ── Harness ─────────────────────────────────────────────────────────────── */

const VAPID = {
  vapidPublicKey: 'BPublic', vapidPrivateKey: 'private', vapidSubject: 'mailto:lunartfirenze@gmail.com',
};

/**
 * A push transport that records, and can be told to explode.
 *
 * Counting is done here rather than through `push.outbox()`, which is a
 * module-level array shared by every adapter in the process and would make one
 * test's notifications show up in another's count.
 */
function countingTransport({ explode = false } = {}) {
  const sent = [];
  return {
    sent,
    /** How many notifications of one event went out. The number these tests are about. */
    count: (event) => sent.filter((entry) => entry.event === event).length,
    async sendNotification(target, payload) {
      if (explode) throw new Error('the push service exploded');
      sent.push({ endpoint: target.endpoint, event: JSON.parse(payload).event, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    },
  };
}

const SUBSCRIPTION = (endpoint) => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } });

/** A server with one registered device and a transport we can count. */
async function bootWithPush({ explode = false, staffToken = '', mode = 'development' } = {}) {
  const store = createStore();
  const transport = countingTransport({ explode });
  const app = await createApp({
    store,
    stripe: createMockStripe(),
    push: createPushAdapter({ ...VAPID, pushTransport: transport }),
    allowPlaceholderPrices: true,
    useDevPrices: false,
    cardSigningKey: 'operations-test-key',
    cardCodePeriodSeconds: 60,
    staffToken,
    mode,
    publicUrl: 'http://127.0.0.1',
  });

  await registerSubscription({ store, subscription: SUBSCRIPTION('https://push.example/jacopo') });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const api = async (path, { method, body, token } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  return { app, store, transport, api, close: () => server.close() };
}

const soon = (days) => addDays(propertyDate(), days);
const CUSTOMER = { name: 'Jacopo Lunardi', email: 'jacopo@example.invalid', room: '303' };

/** A breakfast, far enough ahead that the guest may still change their mind. */
const breakfast = (over = {}) => ({
  productId: 'light-breakfast', quantity: 2, date: soon(4), slotId: 'b-0900', room: '303', ...over,
});

/** A transfer: authorised at checkout, captured when a driver says yes. */
const transfer = () => ({
  productId: 'transfer-airport', variantId: 'to-airport', quantity: 1,
  date: soon(6), time: '09:30',
  fields: {
    passengerName: 'Jacopo Lunardi', passengers: '2',
    largeSuitcases: '2', trolleys: '1', personalBags: '1', phone: '+39392',
  },
});

async function buy(api, lines) {
  const { body: checkout } = await api('/api/checkout', { body: { lines, customer: CUSTOMER, lang: 'it' } });
  assert.ok(checkout.checkoutUrl, `checkout refused: ${JSON.stringify(checkout)}`);
  const session = new URL(checkout.checkoutUrl, 'http://127.0.0.1').searchParams.get('session');
  await api('/mock-checkout/complete', { body: { session } });
  return { ...checkout, session };
}

before(() => applyPriceOverrides(DEV_PRICES));
after(() => applyPriceOverrides({}));

/* ══ A. A guest calls something off ═══════════════════════════════════════ */

test('A cancellation that goes through buzzes the phones exactly once', async () => {
  const { api, transport, close } = await bootWithPush();
  try {
    const order = await buy(api, [breakfast()]);
    assert.equal(transport.count('order-new'), 1, 'the purchase itself');

    const { status, body } = await api(`/api/orders/${order.accessToken}/cancel`, {
      body: { line: 0, quantity: 2, reason: 'cambio programma' },
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);

    assert.equal(transport.count('order-cancelled'), 1, 'one cancellation, one notification');

    const note = transport.sent.find((entry) => entry.event === 'order-cancelled').payload;
    assert.equal(note.title, 'Annullamento ospite', 'it says who did it, at a glance');
    assert.match(note.body, /Breakfast|Colazione/i, 'and what');
    assert.match(note.body, /Camera 303/, 'and where');
    assert.match(note.body, /Rimborso /, 'and what happened to the money');
    assert.match(note.body, /×2/, 'and how many');
    assert.equal(note.url, '/staff', 'tapping it opens the Staff app');

    // The reference on the lock screen must be the one staff can look up: the
    // same eight characters the order sheet and the Staff app print.
    const sheet = await api(`/api/orders/${order.accessToken}`);
    assert.match(note.body, new RegExp(`Ordine ${sheet.body.reference}$`),
      `${note.body} must end with the order's own reference ${sheet.body.reference}`);
  } finally { close(); }
});

test('A one order has one reference, wherever it is printed', async () => {
  const { api, store, close } = await bootWithPush();
  try {
    const order = await buy(api, [breakfast()]);
    const stored = (await store.orders.list({})).at(-1);
    const sheet = await api(`/api/orders/${order.accessToken}`);

    assert.equal(sheet.body.reference, orderReference(stored));
    assert.equal(staffOrderView(stored).reference, sheet.body.reference,
      'the Staff app calls it what the guest does');
    assert.equal(sheet.body.reference, String(stored.id).slice(0, 8).toUpperCase());
  } finally { close(); }
});

test('A cancellation that is refused tells nobody anything', async () => {
  const { api, transport, close } = await bootWithPush();
  try {
    // A Privilege Card: bought, issued, and not refundable. The policy says no.
    const order = await buy(api, [{
      productId: 'privilege-card', variantId: '2d', quantity: 1,
      date: soon(1), fields: { holderName: 'Jacopo Lunardi' },
    }]);
    assert.equal(transport.count('order-new'), 1);

    const { status, body } = await api(`/api/orders/${order.accessToken}/cancel`, { body: { line: 0 } });
    assert.equal(status, 409, `expected a refusal, got ${JSON.stringify(body)}`);
    assert.equal(transport.count('order-cancelled'), 0, 'nothing happened, so nothing is announced');
    assert.equal(transport.sent.length, 1, 'still just the purchase');
  } finally { close(); }
});

test('A line that has already gone is not announced a second time', async () => {
  const { api, transport, close } = await bootWithPush();
  try {
    const order = await buy(api, [breakfast({ quantity: 1 })]);
    const first = await api(`/api/orders/${order.accessToken}/cancel`, { body: { line: 0 } });
    assert.equal(first.status, 200);
    assert.equal(transport.count('order-cancelled'), 1);

    const again = await api(`/api/orders/${order.accessToken}/cancel`, { body: { line: 0 } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'already-cancelled');
    assert.equal(transport.count('order-cancelled'), 1, 'still one');
  } finally { close(); }
});

test('A push service that is down does not stop a guest cancelling', async () => {
  const { api, store, transport, close } = await bootWithPush({ explode: true });
  try {
    const order = await buy(api, [breakfast()]);
    const { status, body } = await api(`/api/orders/${order.accessToken}/cancel`, { body: { line: 0, quantity: 2 } });

    assert.equal(status, 200, 'the cancellation stands');
    assert.equal(body.ok, true);
    assert.equal(body.outcome, 'refunded');
    assert.equal(transport.sent.length, 0, 'and nothing was delivered');

    const stored = (await store.orders.list({})).find((row) => row.access_token === order.accessToken);
    assert.equal(stored.lines[0].cancelled_quantity, 2, 'the record is written whatever the phones did');
    assert.ok(stored.lines[0].refunded_amount > 0);
  } finally { close(); }
});

/* ══ B. One checkout, one buzz ════════════════════════════════════════════ */

test('B an ordinary paid order sends exactly one order-new and no order-awaiting', async () => {
  const { api, transport, close } = await bootWithPush();
  try {
    await buy(api, [breakfast()]);
    assert.equal(transport.count('order-new'), 1);
    assert.equal(transport.count('order-awaiting'), 0);
    assert.equal(transport.sent.length, 1, 'one notification in total');
  } finally { close(); }
});

test('B an authorise-then-capture order sends exactly one order-awaiting, not two', async () => {
  const { api, store, transport, close } = await bootWithPush();
  try {
    await buy(api, [transfer()]);

    const order = (await store.orders.list({})).at(-1);
    assert.equal(order.payment_mode, 'authorize-then-capture', 'the branch under test');
    assert.equal(order.status, 'authorized');

    assert.equal(transport.count('order-awaiting'), 1, 'this is the bug: it used to be two');
    assert.equal(transport.count('order-new'), 0);
    assert.equal(transport.sent.length, 1);
  } finally { close(); }
});

test('B the same payment arriving twice under two event ids buzzes once', async () => {
  const { app, api, store, transport, close } = await bootWithPush();
  try {
    await buy(api, [breakfast()]);
    assert.equal(transport.sent.length, 1);

    const order = (await store.orders.list({})).at(-1);
    const session = await app.stripe.retrieveSession(order.stripe_session_id);

    // The webhook and the order page's reconciliation carry different ids on
    // purpose, so the event memory cannot be what saves us here.
    const ctx = {
      store, stripe: app.stripe, settings: app.settings, push: app.push, providerCalendar: app.providerCalendar,
    };
    const replay = await handleStripeEvent({
      id: `reconcile:checkout.session.completed:${session.id}`,
      type: 'checkout.session.completed',
      data: { object: session },
    }, ctx);

    assert.equal(replay.repeated, true, 'nothing moved');
    assert.equal(transport.sent.length, 1, 'and nothing was announced again');

    // And a genuine Stripe retry, which the event memory does cover.
    const retried = await handleStripeEvent({
      id: `evt_${randomUUID()}`, type: 'checkout.session.completed', data: { object: session },
    }, ctx);
    assert.ok(retried.repeated || retried.deduplicated);
    assert.equal(transport.sent.length, 1);
  } finally { close(); }
});

test('B the four staff events all render, and the cancellation is tagged per line', () => {
  const one = buildNotification('order-cancelled', {
    orderId: 'o1', line: 0, reference: '712713C9', title: 'Brunch — Opera',
    room: '303', quantity: 2, money: 'Rimborso 69,00 €', when: '8 nov 09:00',
  });
  const two = buildNotification('order-cancelled', { orderId: 'o1', line: 1, title: 'Vino' });

  assert.equal(one.title, 'Annullamento ospite');
  assert.equal(one.body, 'Brunch — Opera ×2 · Camera 303 · Rimborso 69,00 € · era per 8 nov 09:00 · Ordine 712713C9');
  assert.notEqual(one.tag, two.tag, 'two cancellations on one order are two things to know');
});

/* ══ C. The dry run ══════════════════════════════════════════════════════ */

const NOW = new Date('2026-10-06T08:00:00Z');
const today = propertyDate(NOW);

/**
 * The backlog as it will really look: eight reservations, six reasons to be left
 * out, and two people who have genuinely never been written to.
 */
async function backlog() {
  const db = createStore();
  const made = {};

  const add = async (key, over) => {
    made[key] = await db.reservations.create(buildReservation({
      source: 'quovai', booking_reference: key.toUpperCase(),
      first_name: 'Ospite', last_name: key, guest_email: `${key}@example.invalid`,
      check_in: addDays(today, 5), check_out: addDays(today, 8), room: '303',
      ...over,
    }));
    return made[key];
  };

  // Eligible: arriving in five days, T-3 already behind us, never written to.
  await add('futura', { check_in: addDays(today, 2), check_out: addDays(today, 5) });
  // Eligible: in the building right now and still without the guide.
  await add('inhouse', { check_in: addDays(today, -1), check_out: addDays(today, 2) });
  // Excluded, six ways.
  await add('annullata', { status: RESERVATION_STATUS.cancelled });
  await add('passata', { check_in: addDays(today, -6), check_out: addDays(today, -2) });
  await add('provvisoria', { provisional: true, guest_email: '' });
  await add('senzamail', { guest_email: '' });
  const done = await add('giafatta', {});
  /**
   * Simulated, and genuinely owed: arriving tomorrow, so T-3 went by two days ago.
   *
   * The dates matter now. A simulated row on a stay still weeks away is not
   * backlog at all — the scheduler will write to them at the proper hour — and
   * `test/catchup-due.test.mjs` holds that case. This one is the pair to it: the
   * row says simulated, the moment has passed, and nothing has reached the guest.
   */
  const simulata = await add('simulata', { check_in: addDays(today, 1), check_out: addDays(today, 4) });

  // One guest who really has had the email, and one whose "delivery" was a
  // staging simulation that never left the building.
  await db.deliveries.create({
    reservation_id: done.id, to: done.guest_email, lang: 'it',
    send_at: NOW.toISOString(), status: DELIVERY_STATUS.sent, attempts: 1,
    sent_at: NOW.toISOString(), provider: 'gmail', error: null,
  });
  await db.reservations.update(done.id, { guide_email_status: DELIVERY_STATUS.sent, guide_email_sent_at: NOW.toISOString() });

  await db.deliveries.create({
    reservation_id: simulata.id, to: simulata.guest_email, lang: 'it',
    send_at: NOW.toISOString(), status: DELIVERY_STATUS.simulated, attempts: 1,
    sent_at: NOW.toISOString(), provider: 'simulated', body: 'il testo, da leggere', error: null,
  });
  await db.reservations.update(simulata.id, { guide_email_status: DELIVERY_STATUS.simulated });

  return { db, made };
}

/** A mailer that works, and counts. */
function countingMailer() {
  const sent = [];
  return {
    id: 'gmail', configured: true, implemented: true,
    sent,
    async send(message) { sent.push(message); return { simulated: false, id: `m${sent.length}` }; },
    state: () => ({ sent: sent.length, lastError: null, lastSuccessAt: null }),
    check: async () => ({ ok: true }),
  };
}

test('C the dry run names who would be written to, and sends nothing', async () => {
  const { db, made } = await backlog();
  const mailer = countingMailer();

  const preview = await previewGuideCatchUp({ store: db, now: NOW });

  assert.equal(preview.dryRun, true);
  assert.equal(preview.considered, 8);
  assert.equal(preview.eligible, 3, 'futura, inhouse and the one only ever simulated');
  assert.equal(preview.excluded, 5);

  const names = preview.rows.map((row) => row.guest.replace('Ospite ', '')).sort();
  assert.deepEqual(names, ['futura', 'inhouse', 'simulata']);

  assert.deepEqual(preview.breakdown, {
    [CATCHUP_SKIP.alreadySent]: 1,
    [CATCHUP_SKIP.cancelled]: 1,
    [CATCHUP_SKIP.past]: 1,
    [CATCHUP_SKIP.notDueYet]: 0,
    [CATCHUP_SKIP.provisional]: 1,
    [CATCHUP_SKIP.noEmail]: 1,
    [CATCHUP_SKIP.noToken]: 0,
    [CATCHUP_SKIP.noDates]: 0,
    [CATCHUP_SKIP.other]: 0,
  });

  // Each row carries what staff need to recognise the person and check the state.
  const row = preview.rows.find((entry) => entry.reservation_id === made.futura.id);
  assert.equal(row.room, '303');
  assert.equal(row.check_in, addDays(today, 2));
  assert.equal(row.check_out, addDays(today, 5));
  assert.equal(row.reference, made.futura.staff_ref);
  assert.equal(row.delivery_status, 'none');
  assert.equal(row.guide_email_status, 'pending');
  assert.equal(row.email, 'fu••••@example.invalid', 'enough to check, not the whole mailbox');

  // The earliest arrival is first: the people it matters most to reach.
  assert.deepEqual(preview.rows.map((entry) => entry.check_in),
    [...preview.rows.map((entry) => entry.check_in)].sort());

  assert.equal(mailer.sent.length, 0, 'the preview never opened a mailer');
  assert.equal((await db.deliveries.list({})).length, 2, 'and wrote no delivery rows');
});

test('C a reservation with no guide token is excluded rather than sent a broken link', async () => {
  const db = createStore();
  const broken = await db.reservations.create(buildReservation({
    booking_reference: 'NOTOK', first_name: 'Senza', last_name: 'Token',
    guest_email: 'senza@example.invalid', check_in: addDays(today, 4), check_out: addDays(today, 6),
  }));
  await db.reservations.update(broken.id, { guide_token: '' });

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(preview.eligible, 0);
  assert.equal(preview.breakdown[CATCHUP_SKIP.noToken], 1);
});

test('C masking keeps the domain, because a typo in the domain is the one worth seeing', () => {
  assert.equal(maskEmail('marta.venturi@guest.booking.com'), 'ma•••••••••••@guest.booking.com');
  assert.equal(maskEmail('jo@example.com'), 'jo•@example.com');
  assert.equal(maskEmail(''), '');
  assert.equal(maskEmail('not-an-address'), '');
});

/* ══ D. The send ═════════════════════════════════════════════════════════ */

test('D without an explicit confirmation nothing is sent at all', async () => {
  const { db } = await backlog();
  const mailer = countingMailer();

  const refused = await runGuideCatchUp({ store: db, mailer, origin: 'https://g.example', now: NOW });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'not-confirmed');
  assert.equal(refused.dryRun, true);
  assert.equal(mailer.sent.length, 0);

  // And not with a truthy near-miss either.
  const nearly = await runGuideCatchUp({ store: db, mailer, origin: 'https://g.example', now: NOW, confirm: 'yes' });
  assert.equal(nearly.ok, false);
  assert.equal(mailer.sent.length, 0);
});

test('D the send writes to each eligible guest once, and a second run writes to nobody', async () => {
  const { db, made } = await backlog();
  const mailer = countingMailer();

  const first = await runGuideCatchUp({ store: db, mailer, origin: 'https://g.example', now: NOW, confirm: true });
  assert.equal(first.ok, true);
  assert.equal(first.dryRun, false);
  assert.equal(first.attempted, 3);
  assert.equal(first.sent, 3);
  assert.equal(first.simulated, 0);
  assert.equal(first.failed, 0);
  assert.equal(mailer.sent.length, 3);

  // Each one carries that guest's own link, and no two are the same.
  const links = mailer.sent.map((message) => message.text.match(/https:\/\/g\.example\/g\/\S+/)[0]);
  assert.equal(new Set(links).size, 3);

  // The record says sent, in both places that are asked about it.
  const delivery = await db.deliveries.findByReservation(made.futura.id);
  assert.equal(delivery.status, DELIVERY_STATUS.sent);
  assert.equal(delivery.provider, 'gmail');
  assert.equal(delivery.body, null, 'a real send keeps no copy of the body');
  assert.equal((await db.reservations.get(made.futura.id)).guide_email_status, DELIVERY_STATUS.sent);

  // One delivery row per reservation: the simulated one was reused, not doubled.
  const rows = await db.deliveries.list({});
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((row) => row.reservation_id === made.simulata.id).length, 1);

  // And now the part a nervous person will check.
  const second = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(second.eligible, 0);
  assert.equal(second.breakdown[CATCHUP_SKIP.alreadySent], 4);

  const again = await runGuideCatchUp({ store: db, mailer, origin: 'https://g.example', now: NOW, confirm: true });
  assert.equal(again.attempted, 0);
  assert.equal(mailer.sent.length, 3, 'nobody was written to twice');
});

test('D a send that fails leaves the guest in the backlog rather than marked done', async () => {
  const { db } = await backlog();
  const broken = {
    id: 'gmail', configured: true, implemented: true,
    async send() { throw new Error('Backend Error'); },
    state: () => ({ sent: 0 }), check: async () => ({ ok: false }),
  };

  const outcome = await runGuideCatchUp({ store: db, mailer: broken, origin: 'https://g.example', now: NOW, confirm: true });
  assert.equal(outcome.attempted, 3);
  assert.equal(outcome.failed, 3);
  assert.equal(outcome.sent, 0);

  const retry = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(retry.eligible, 3, 'still owed the email');
});

/* ══ E. Simulated is not sent ════════════════════════════════════════════ */

test('E with no provider configured nothing leaves, and nobody is marked as written to', async () => {
  const { db, made } = await backlog();
  const nothing = {
    id: 'simulated', configured: false, implemented: true,
    sent: [],
    async send(message) { this.sent.push(message); return { simulated: true, id: 'sim' }; },
    state: () => ({ sent: this?.sent?.length ?? 0 }), check: async () => ({ ok: false, reason: 'credentials-missing' }),
  };

  const outcome = await runGuideCatchUp({ store: db, mailer: nothing, origin: 'https://g.example', now: NOW, confirm: true });
  assert.equal(outcome.attempted, 3);
  assert.equal(outcome.simulated, 3);
  assert.equal(outcome.sent, 0);
  assert.equal(outcome.delivered, false, 'the word that stops this being read as success');

  const delivery = await db.deliveries.findByReservation(made.futura.id);
  assert.equal(delivery.status, DELIVERY_STATUS.simulated);
  assert.ok(delivery.body, 'the text is kept, so it can be read and checked');

  // And the whole point: they are still the backlog.
  const after = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(after.eligible, 3);
  assert.equal(after.breakdown[CATCHUP_SKIP.alreadySent], 1, 'only the one that really was sent');
});

test('E a guest marked sent on the reservation alone is still left alone', async () => {
  const db = createStore();
  const imported = await db.reservations.create(buildReservation({
    booking_reference: 'IMPORT', first_name: 'Gia', last_name: 'Scritta',
    guest_email: 'gia@example.invalid', check_in: addDays(today, 4), check_out: addDays(today, 6),
  }));
  // A record carried over without its delivery row. Production must not write twice.
  await db.reservations.update(imported.id, { guide_email_status: DELIVERY_STATUS.sent });

  const preview = await previewGuideCatchUp({ store: db, now: NOW });
  assert.equal(preview.eligible, 0);
  assert.equal(preview.breakdown[CATCHUP_SKIP.alreadySent], 1);
});

/* ══ F. The permanent rule is untouched ══════════════════════════════════ */

test('F the ordinary rule is still three days before arrival at ten, Florence time', async () => {
  assert.equal(GUIDE_EMAIL_LEAD_DAYS, 3);
  assert.equal(GUIDE_EMAIL_HOUR, '10:00');

  const reservation = buildReservation({ check_in: '2026-11-12', check_out: '2026-11-15' });
  assert.equal(
    sendTimeFor(reservation, { now: new Date('2026-10-20T08:00:00Z') }).toISOString(),
    propertyTimeToInstant('2026-11-09', '10:00').toISOString(),
  );

  // A booking taken inside the window goes as soon as it is due, not next year.
  const late = new Date('2026-11-11T22:30:00Z');
  assert.equal(sendTimeFor(reservation, { now: late }).getTime(), late.getTime());
});

test('F a modification moves the date and keeps the link; a cancellation stops it', async () => {
  const db = createStore();
  const reservation = await db.reservations.create(buildReservation({
    booking_reference: 'NORM', first_name: 'Marta', last_name: 'Venturi',
    guest_email: 'marta@example.invalid', check_in: '2026-11-12', check_out: '2026-11-15',
  }));
  await scheduleGuideEmail({ store: db, reservation, now: new Date('2026-10-20T08:00:00Z') });

  const [first] = await db.deliveries.list({});
  assert.equal(first.send_at, propertyTimeToInstant('2026-11-09', '10:00').toISOString());

  const moved = await db.reservations.update(reservation.id, { check_in: '2026-11-20', check_out: '2026-11-23' });
  await scheduleGuideEmail({ store: db, reservation: moved, now: new Date('2026-10-20T08:00:00Z') });

  const rows = await db.deliveries.list({});
  assert.equal(rows.length, 1, 'one delivery per reservation, moved rather than duplicated');
  assert.equal(rows[0].send_at, propertyTimeToInstant('2026-11-17', '10:00').toISOString());
  assert.equal(moved.guide_token, reservation.guide_token, 'the link is unchanged');

  const off = await db.reservations.update(reservation.id, { status: RESERVATION_STATUS.cancelled });
  await cancelGuideEmail({ store: db, reservation: off });
  assert.equal((await db.deliveries.findByReservation(reservation.id)).status, DELIVERY_STATUS.cancelled);
});

test('F the catch-up rewrites no schedule: the due email still goes out by itself', async () => {
  const db = createStore();
  const mailer = countingMailer();

  // Somebody arriving the day after tomorrow, already written to by the catch-up.
  const caught = await db.reservations.create(buildReservation({
    booking_reference: 'CATCH', first_name: 'Primo', last_name: 'Ospite',
    guest_email: 'primo@example.invalid', check_in: addDays(today, 1), check_out: addDays(today, 4),
  }));
  await runGuideCatchUp({ store: db, mailer, origin: 'https://g.example', now: NOW, confirm: true });
  assert.equal(mailer.sent.length, 1);

  // And somebody booked afterwards, whose T-3 falls due on the ordinary schedule.
  const later = await db.reservations.create(buildReservation({
    booking_reference: 'LATER', first_name: 'Secondo', last_name: 'Ospite',
    guest_email: 'secondo@example.invalid', check_in: addDays(today, 1), check_out: addDays(today, 4),
  }));
  await scheduleGuideEmail({ store: db, reservation: later, now: NOW });

  const due = await sendDueGuideEmails({ store: db, mailer, origin: 'https://g.example', now: NOW });
  assert.equal(due.length, 1, 'the new booking, and only it');
  assert.equal(due[0].reservation_id, later.id);
  assert.equal(due[0].status, DELIVERY_STATUS.sent);
  assert.equal(mailer.sent.length, 2);

  // The one the catch-up handled is not sent again by the scheduler.
  assert.equal((await db.deliveries.findByReservation(caught.id)).status, DELIVERY_STATUS.sent);
  assert.equal((await sendDueGuideEmails({ store: db, mailer, origin: 'https://g.example', now: NOW })).length, 0);
});

/* ══ G. Nobody but staff ═════════════════════════════════════════════════ */

test('G the catch-up endpoints refuse a missing or wrong staff token', async () => {
  const { api, close } = await bootWithPush({ staffToken: 'secret-staff-token', mode: 'production' });
  try {
    for (const call of [
      { path: '/api/staff/sync/guide-catchup' },
      { path: '/api/staff/sync/guide-catchup', method: 'POST', body: { confirm: true } },
      { path: '/api/staff/push/test', method: 'POST' },
    ]) {
      const missing = await api(call.path, { method: call.method, body: call.body });
      assert.equal(missing.status, 401, `${call.path} without a token`);
      assert.equal(missing.body.error, 'unauthorised');

      const wrong = await api(call.path, { ...call, token: 'not-the-token' });
      assert.equal(wrong.status, 401, `${call.path} with the wrong token`);
    }
  } finally { close(); }
});

test('G there is no guest route to the catch-up at all', async () => {
  const { api, close } = await bootWithPush({ staffToken: 'secret-staff-token', mode: 'production' });
  try {
    for (const path of ['/api/sync/guide-catchup', '/api/guide-catchup', '/api/orders/guide-catchup']) {
      const { status } = await api(path);
      assert.ok(status === 404 || status === 401, `${path} must not be a guest endpoint (got ${status})`);
    }
  } finally { close(); }
});

test('G with the right token the preview answers, and the send still needs a confirmation', async () => {
  const token = 'secret-staff-token';
  const { api, store, close } = await bootWithPush({ staffToken: token, mode: 'production' });
  try {
    await store.reservations.create(buildReservation({
      booking_reference: 'STAFF-1', first_name: 'Terzo', last_name: 'Ospite',
      guest_email: 'terzo@example.invalid', check_in: addDays(today, 2), check_out: addDays(today, 5),
    }));

    const preview = await api('/api/staff/sync/guide-catchup', { token });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.dryRun, true);
    assert.equal(preview.body.eligible, 1);
    assert.equal(preview.body.mailerConfigured, false, 'this preview has no mailer, and says so');

    const unconfirmed = await api('/api/staff/sync/guide-catchup', { method: 'POST', body: {}, token });
    assert.equal(unconfirmed.status, 422);
    assert.equal(unconfirmed.body.error, 'not-confirmed');

    const confirmed = await api('/api/staff/sync/guide-catchup', { method: 'POST', body: { confirm: true }, token });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.dryRun, false);
    assert.equal(confirmed.body.attempted, 1);
    assert.equal(confirmed.body.sent, 0, 'no provider, so nothing really left');
    assert.equal(confirmed.body.simulated, 1);
  } finally { close(); }
});

test('G neither answer carries a credential', async () => {
  const token = 'secret-staff-token';
  const { api, close } = await bootWithPush({ staffToken: token, mode: 'production' });
  try {
    const preview = await api('/api/staff/sync/guide-catchup', { token });
    const push = await api('/api/staff/push/test', { method: 'POST', token });
    const text = `${JSON.stringify(preview.body)}${JSON.stringify(push.body)}`;

    for (const secret of ['private', 'secret-staff-token', 'vapidPrivateKey', 'refresh_token', 'GMAIL_REFRESH_TOKEN']) {
      assert.ok(!text.includes(secret), `the answer must not carry ${secret}`);
    }
  } finally { close(); }
});
