/**
 * The operational half: scheduling the guest email, working the queues, and the
 * notification channel.
 *
 * Three rules are worth proving because getting them wrong is expensive rather than
 * ugly: an email that goes out after the guest arrives, a cancelled stay whose email
 * still goes, and a cancel button that quietly refunds money — or quietly does not.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../server/store.js';
import { createMockStripe } from '../server/stripe.js';
import { createApp, handleStripeEvent } from '../server/app.js';
import {
  sendTimeFor, scheduleGuideEmail, cancelGuideEmail, sendDueGuideEmails,
  renderGuideEmail, createSimulatedMailer, guideUrl, mailProviders, DELIVERY_STATUS,
  GUIDE_EMAIL_LEAD_DAYS,
} from '../server/delivery.js';
import {
  queueOf, staffOrderView, orderQueues, dashboard, syncOverview,
  setFulfilment, requestSubstitution, assignOrder, cancelOrder, refundOrder,
  createManualReservation, editReservation, cancelReservationByStaff, guideLinkFor,
  STAFF_QUEUES, isExpress,
} from '../server/staff.js';
import { createPushAdapter, notifyStaff, registerSubscription, buildNotification } from '../server/push.js';
import { createGoogleCalendarAdapter, providerCalendars } from '../server/calendar/google.js';
import { ingestEvent } from '../server/ingest/index.js';
import { buildReservation } from '../server/reservations.js';
import { propertyDate, propertyTimeToInstant, addDays } from '../commerce/time.js';
import { PAYMENT_STATUS, FULFILMENT_STATUS, canFulfilmentMove } from '../commerce/schema.js';
import { applyPriceOverrides } from '../commerce/prices.js';
import { DEV_PRICES } from '../commerce/prices.dev.js';

const store = () => createStore();

const reservationEvent = (over = {}) => ({
  kind: 'new', source: 'quovai', booking_reference: 'BK-1',
  first_name: 'Marta', last_name: 'Venturi', guest_email: 'marta@example.invalid',
  check_in: '2026-10-12', check_out: '2026-10-15', adults: 2, room: '303',
  message_id: `<${Math.random()}@q>`, ...over,
});

/* ── When the guide email goes out ───────────────────────────────────────── */

test('the guide email is scheduled three days before arrival, at a civil hour', () => {
  const reservation = buildReservation({ check_in: '2026-10-12', check_out: '2026-10-15' });
  const when = sendTimeFor(reservation, { now: new Date('2026-09-20T08:00:00Z') });
  assert.equal(when.toISOString(), propertyTimeToInstant('2026-10-09', '10:00').toISOString());
  assert.equal(GUIDE_EMAIL_LEAD_DAYS, 3);
});

test('a booking made inside three days goes out as soon as it can', () => {
  const reservation = buildReservation({ check_in: '2026-10-12', check_out: '2026-10-15' });
  const now = new Date('2026-10-11T23:30:00Z');
  const when = sendTimeFor(reservation, { now });
  assert.equal(when.getTime(), now.getTime(), 'not tomorrow morning: now');
});

test('scheduling is one delivery per reservation, moved rather than duplicated', async () => {
  const db = store();
  const { reservation } = await ingestEvent({ store: db, event: reservationEvent(), now: new Date('2026-09-20T08:00:00Z') });

  const all = await db.deliveries.list({});
  assert.equal(all.length, 1);
  assert.equal(all[0].status, DELIVERY_STATUS.scheduled);
  assert.equal(all[0].to, 'marta@example.invalid');
  assert.equal(all[0].send_at, propertyTimeToInstant('2026-10-09', '10:00').toISOString());

  // The dates move; the delivery moves with them, and there is still one.
  await ingestEvent({
    store: db,
    event: reservationEvent({ kind: 'modified', check_in: '2026-10-20', check_out: '2026-10-23' }),
    now: new Date('2026-09-21T08:00:00Z'),
  });
  const after = await db.deliveries.list({});
  assert.equal(after.length, 1);
  assert.equal(after[0].send_at, propertyTimeToInstant('2026-10-17', '10:00').toISOString());

  // And the link is the same one, so an email already sent still works.
  const current = await db.reservations.get(reservation.id);
  assert.equal(current.guide_token, reservation.guide_token);
});

test('a cancellation unschedules an email that has not gone out', async () => {
  const db = store();
  await ingestEvent({ store: db, event: reservationEvent(), now: new Date('2026-09-20T08:00:00Z') });
  await ingestEvent({ store: db, event: reservationEvent({ kind: 'cancelled' }), now: new Date('2026-09-21T08:00:00Z') });

  const [delivery] = await db.deliveries.list({});
  assert.equal(delivery.status, DELIVERY_STATUS.cancelled);
});

test('an email already sent is never unsent, and never sent twice', async () => {
  const db = store();
  const mailer = createSimulatedMailer();
  await ingestEvent({ store: db, event: reservationEvent(), now: new Date('2026-10-09T09:00:00Z') });

  const sent = await sendDueGuideEmails({ store: db, mailer, origin: 'https://g.example', now: new Date('2026-10-09T09:00:00Z') });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, DELIVERY_STATUS.simulated, 'nothing really left');

  const again = await sendDueGuideEmails({ store: db, mailer, origin: 'https://g.example', now: new Date('2026-10-09T10:00:00Z') });
  assert.equal(again.length, 0, 'it is no longer due');
  assert.equal(mailer.outbox().length, 1);

  // A later cancellation does not rewrite history.
  const reservation = await db.reservations.findByBooking('quovai', 'BK-1');
  await cancelGuideEmail({ store: db, reservation });
  const [delivery] = await db.deliveries.list({});
  assert.equal(delivery.status, DELIVERY_STATUS.simulated);
});

test('nothing is sent for a reservation with no address, and it says so', async () => {
  const db = store();
  const mailer = createSimulatedMailer();
  await ingestEvent({ store: db, event: reservationEvent({ guest_email: '' }), now: new Date('2026-10-09T09:00:00Z') });
  const [delivery] = await db.deliveries.list({});
  assert.equal(delivery.status, DELIVERY_STATUS.unsendable);

  const sent = await sendDueGuideEmails({ store: db, mailer, origin: 'https://g.example', now: new Date('2026-10-09T09:00:00Z') });
  assert.equal(sent.length, 0);
  assert.equal(mailer.outbox().length, 0);
});

test('an email due for a stay that has since been cancelled is dropped at send time', async () => {
  const db = store();
  const mailer = createSimulatedMailer();
  const { reservation } = await ingestEvent({ store: db, event: reservationEvent(), now: new Date('2026-10-09T09:00:00Z') });
  // Cancel the reservation without touching the delivery, as a race would.
  await db.reservations.update(reservation.id, { status: 'cancelled' });

  const results = await sendDueGuideEmails({ store: db, mailer, origin: 'https://g.example', now: new Date('2026-10-09T09:00:00Z') });
  assert.equal(results[0].status, DELIVERY_STATUS.cancelled);
  assert.equal(mailer.outbox().length, 0);
});

test('the email is bilingual, carries the link, and nothing else identifying', () => {
  const reservation = buildReservation({
    first_name: 'Marta', last_name: 'Venturi', check_in: '2026-10-12', check_out: '2026-10-15', room: '303',
  });
  for (const lang of ['it', 'en']) {
    const mail = renderGuideEmail({ reservation, origin: 'https://g.example', lang });
    assert.ok(mail.subject.length > 0, lang);
    assert.ok(mail.text.includes(`https://g.example/g/${reservation.guide_token}`), lang);
    assert.ok(mail.html.includes(reservation.guide_token), lang);
    assert.ok(mail.text.includes('Marta'), 'the first name is a greeting, not a secret');
    assert.equal(mail.text.includes('Venturi'), false, 'the surname is not needed in an email body');
  }
  const it = renderGuideEmail({ reservation, lang: 'it' });
  const en = renderGuideEmail({ reservation, lang: 'en' });
  assert.notEqual(it.subject, en.subject);
  assert.match(en.html, /Open your LunArt Guest Guide/);
});

test('with no mail provider configured, nothing can leave', () => {
  const mailer = createSimulatedMailer();
  assert.equal(mailer.configured, false);
  assert.equal(mailer.id, 'simulated');
  assert.equal(mailProviders().some((provider) => provider.configured), false);
});

test('the guide link is the token and nothing else', () => {
  const reservation = buildReservation({ check_in: '2026-10-12', check_out: '2026-10-15' });
  assert.equal(guideUrl('https://g.example/', reservation), `https://g.example/g/${reservation.guide_token}`);
});

/* ── Order queues ────────────────────────────────────────────────────────── */

const order = (over = {}) => ({
  id: 'ord_1',
  status: PAYMENT_STATUS.paid,
  fulfilment_status: FULFILMENT_STATUS['not-required'],
  amount: 6900,
  currency: 'EUR',
  payment_mode: 'instant',
  customer: { name: 'Marta', room: '303', phone: '+39348', email: 'm@example.invalid' },
  lines: [{ product_id: 'brunch', title: 'Brunch', quantity: 1, amount: 6900, date: '2026-10-13', slot_id: 'b-0900', room: '303', fields: {}, options: {} }],
  provider: { status: 'not-required' },
  events: [],
  ...over,
});

test('a queue is derived from the order, not stored on it', () => {
  assert.equal(queueOf(order()), 'new', 'paid and untouched is work to do');
  assert.equal(queueOf(order({ fulfilment_status: FULFILMENT_STATUS['awaiting-confirmation'], status: PAYMENT_STATUS.authorized })), 'awaiting');
  assert.equal(queueOf(order({ fulfilment_status: FULFILMENT_STATUS['in-preparation'] })), 'preparing');
  assert.equal(queueOf(order({ fulfilment_status: FULFILMENT_STATUS['substitution-requested'] })), 'preparing');
  assert.equal(queueOf(order({ fulfilment_status: FULFILMENT_STATUS.completed })), 'completed');
  assert.equal(queueOf(order({ fulfilment_status: FULFILMENT_STATUS.delivered })), 'completed');
  assert.equal(queueOf(order({ status: PAYMENT_STATUS.cancelled })), 'cancelled');
  assert.equal(queueOf(order({ status: PAYMENT_STATUS.refunded })), 'cancelled');
  assert.equal(queueOf(order({ status: PAYMENT_STATUS.pending })), 'cancelled', 'checkout never finished');
  assert.deepEqual(STAFF_QUEUES, ['new', 'awaiting', 'preparing', 'completed', 'cancelled']);
});

test('a staff view carries what staff need and not the guest’s own key', () => {
  const view = staffOrderView(order({ access_token: 'secret-token' }));
  assert.equal(view.customer.phone, '+39348');
  assert.equal(view.lines[0].title, 'Brunch');
  assert.equal(JSON.stringify(view).includes('secret-token'), false, 'the guest access token stays out');
  assert.ok(view.lines[0].cancellable_until, 'a screen can say how long is left');
});

test('fulfilment moves forwards, and refuses the moves that are wrong', async () => {
  const db = store();
  const saved = await db.orders.create(order());

  const preparing = await setFulfilment({ store: db, order: saved, to: FULFILMENT_STATUS['in-preparation'] });
  assert.equal(preparing.ok, true);
  const done = await setFulfilment({ store: db, order: preparing.order, to: FULFILMENT_STATUS.completed });
  assert.equal(done.ok, true);

  const back = await setFulfilment({ store: db, order: done.order, to: FULFILMENT_STATUS['in-preparation'] });
  assert.equal(back.ok, false);
  assert.equal(back.reason, 'transition-not-allowed');
  assert.equal(canFulfilmentMove('cancelled', 'in-preparation'), false);
});

test('an unavailable bottle is a conversation, not a silent substitution', async () => {
  const db = store();
  const saved = await db.orders.create(order({
    lines: [{ product_id: 'wine-in-room', title: 'Wine', variant_id: 'brunello', quantity: 1, amount: 8900, date: '2026-10-13', slot_id: 'w-1900', room: '303', fields: {}, options: {} }],
  }));
  const result = await requestSubstitution({ store: db, order: saved });
  assert.equal(result.ok, true);
  assert.equal(result.order.fulfilment_status, FULFILMENT_STATUS['substitution-requested']);
  assert.equal(result.order.status, PAYMENT_STATUS.paid, 'the money has not moved');
  assert.ok(result.order.events.at(-1).note.includes('ospite'));
});

test('an order can be assigned to the person actually doing it', async () => {
  const db = store();
  const saved = await db.orders.create(order());
  const result = await assignOrder({ store: db, order: saved, assignee: 'Diego' });
  assert.equal(result.order.provider.assignee, 'Diego');
});

test('cancelling an authorised order releases the hold and charges nothing', async () => {
  const stripe = createMockStripe();
  const db = store();
  const session = await stripe.createCheckoutSession({
    mode: 'payment', currency: 'eur', line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 9000, product_data: { name: 'Transfer' } } }],
    payment_intent_data: { capture_method: 'manual' },
    success_url: 'https://x/ok', cancel_url: 'https://x/no',
  });
  const completed = await stripe.completeSession(session.id);
  const saved = await db.orders.create(order({
    status: PAYMENT_STATUS.authorized,
    fulfilment_status: FULFILMENT_STATUS['awaiting-confirmation'],
    stripe_payment_intent_id: completed.payment_intent,
    amount: 9000,
  }));

  const result = await cancelOrder({ store: db, stripe, order: saved });
  assert.equal(result.ok, true);
  assert.equal(result.released, true);
  assert.equal(result.order.status, PAYMENT_STATUS.cancelled);
  assert.equal(result.order.fulfilment_status, FULFILMENT_STATUS.cancelled);
});

test('cancelling a paid order says the refund is still outstanding rather than doing it', async () => {
  const db = store();
  const saved = await db.orders.create(order());
  const result = await cancelOrder({ store: db, stripe: createMockStripe(), order: saved });
  assert.equal(result.ok, true);
  assert.equal(result.refund_outstanding, true, 'said out loud, not done silently');
  assert.equal(result.order.status, PAYMENT_STATUS.paid, 'the money is where it was');
});

test('a refund is its own decision, and only from paid', async () => {
  const stripe = createMockStripe();
  const db = store();
  const session = await stripe.createCheckoutSession({
    mode: 'payment', currency: 'eur', line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 6900, product_data: { name: 'Brunch' } } }],
    success_url: 'https://x/ok', cancel_url: 'https://x/no',
  });
  const completed = await stripe.completeSession(session.id);
  const saved = await db.orders.create(order({ stripe_payment_intent_id: completed.payment_intent }));

  const refunded = await refundOrder({ store: db, stripe, order: saved });
  assert.equal(refunded.ok, true);
  assert.equal(refunded.order.status, PAYMENT_STATUS.refunded);

  const twice = await refundOrder({ store: db, stripe, order: refunded.order });
  assert.equal(twice.ok, false);
  assert.equal(twice.reason, 'not-refundable');
});

test('an express wine order is recognised for what it is', () => {
  assert.equal(isExpress(order({ amount: 9000, lines: [{ product_id: 'wine-in-room', title: 'Wine' }] })), true);
  assert.equal(isExpress(order({ amount: 4300, lines: [{ product_id: 'wine-in-room', title: 'Wine' }] })), false);
  assert.equal(isExpress(order({ amount: 12000 })), false, 'a brunch is never express');
});

/* ── Reservations by hand ────────────────────────────────────────────────── */

test('a reservation typed in by staff behaves like any other', async () => {
  const db = store();
  const result = await createManualReservation({
    store: db,
    input: { first_name: 'Diego', last_name: 'Prova', check_in: '2026-10-12', check_out: '2026-10-14', room: '301', guest_email: 'd@example.invalid' },
    now: new Date('2026-10-01T08:00:00Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.reservation.source, 'manual');
  assert.ok(result.reservation.booking_reference.startsWith('MAN-'), 'given a reference of its own');
  assert.ok(result.reservation.guide_token);
  const [delivery] = await db.deliveries.list({});
  assert.equal(delivery.status, DELIVERY_STATUS.scheduled, 'and an email on the schedule');
});

test('editing a reservation moves the email and keeps the link', async () => {
  const db = store();
  const { reservation } = await createManualReservation({
    store: db,
    input: { first_name: 'Diego', last_name: 'Prova', check_in: '2026-10-20', check_out: '2026-10-22', guest_email: 'd@example.invalid' },
    now: new Date('2026-10-01T08:00:00Z'),
  });
  const edited = await editReservation({
    store: db, reservation, patch: { check_in: '2026-10-25', check_out: '2026-10-27', room: '305' },
    now: new Date('2026-10-02T08:00:00Z'),
  });

  assert.equal(edited.reservation.check_in, '2026-10-25');
  assert.equal(edited.reservation.room, '305');
  assert.equal(edited.reservation.guide_token, reservation.guide_token);
  const [delivery] = await db.deliveries.list({});
  assert.equal(delivery.send_at, propertyTimeToInstant('2026-10-22', '10:00').toISOString());
});

test('a staff cancellation stops the email too', async () => {
  const db = store();
  const { reservation } = await createManualReservation({
    store: db,
    input: { first_name: 'Diego', last_name: 'Prova', check_in: '2026-10-20', check_out: '2026-10-22', guest_email: 'd@example.invalid' },
    now: new Date('2026-10-01T08:00:00Z'),
  });
  await cancelReservationByStaff({ store: db, reservation, reason: 'ospite ha disdetto' });
  const [delivery] = await db.deliveries.list({});
  assert.equal(delivery.status, DELIVERY_STATUS.cancelled);
});

test('the link can be handed over, and rotated when it has gone astray', async () => {
  const db = store();
  const { reservation } = await createManualReservation({
    store: db, input: { first_name: 'A', last_name: 'B', check_in: '2026-10-20', check_out: '2026-10-22' },
  });
  const plain = await guideLinkFor({ store: db, reservation, origin: 'https://g.example' });
  assert.equal(plain.link, `https://g.example/g/${reservation.guide_token}`);
  assert.equal(plain.rotated, false);

  const rotated = await guideLinkFor({ store: db, reservation, origin: 'https://g.example', rotate: true });
  assert.equal(rotated.rotated, true);
  assert.notEqual(rotated.link, plain.link);
});

/* ── Dashboard and sync ──────────────────────────────────────────────────── */

test('the dashboard counts the queues and today’s arrivals', async () => {
  const db = store();
  const today = propertyDate();
  await db.orders.create(order());
  await db.orders.create(order({ id: 'ord_2', status: PAYMENT_STATUS.authorized, fulfilment_status: FULFILMENT_STATUS['awaiting-confirmation'] }));
  await ingestEvent({ store: db, event: reservationEvent({ check_in: today, check_out: addDays(today, 2) }) });

  const view = await dashboard({ store: db });
  assert.equal(view.orders.new, 1);
  assert.equal(view.orders.awaiting, 1);
  assert.equal(view.arrivals.length, 1);
  assert.equal(view.inHouse, 1);
});

test('the sync screen says what has happened to each reservation', async () => {
  const db = store();
  const today = propertyDate();
  await ingestEvent({ store: db, event: reservationEvent({ check_in: addDays(today, 5), check_out: addDays(today, 8) }) });
  await ingestEvent({ store: db, event: reservationEvent({ booking_reference: 'BK-2', guest_email: '', room: '', check_in: addDays(today, 6), check_out: addDays(today, 9) }) });

  const view = await syncOverview({ store: db });
  assert.equal(view.counts.reservations, 2);
  assert.equal(view.counts.needs_review, 1, 'the one with no address and no room');
  const problem = view.rows.find((row) => row.needs_review);
  assert.ok(problem.problems.includes('no-guest-email'));
  assert.ok(problem.problems.includes('no-room'));
  assert.ok(view.rows.every((row) => row.guide_created));
});

/* ── Notifications ───────────────────────────────────────────────────────── */

test('with no VAPID keys the app works and says push is not configured', async () => {
  const db = store();
  const push = createPushAdapter({});
  assert.equal(push.configured, false);

  await registerSubscription({ store: db, subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } }, label: 'iPhone' });
  const result = await notifyStaff({ store: db, push, event: 'order-new', data: { orderId: 'o1', title: 'Wine in your room', room: '303', amount: '110,00 €', when: '18:30', express: true } });

  assert.equal(result.ok, true);
  assert.equal(result.simulated, true, 'nothing actually went');
  assert.equal(result.devices, 1, 'but the device is registered for when keys exist');
  assert.match(result.payload.title, /^EXPRESS — /);
  assert.match(result.payload.body, /Camera 303/);
});

test('a device registered before the keys exist is kept, and not duplicated', async () => {
  const db = store();
  const subscription = { endpoint: 'https://push.example/same', keys: { p256dh: 'k', auth: 'a' } };
  const first = await registerSubscription({ store: db, subscription });
  const second = await registerSubscription({ store: db, subscription, label: 'renamed' });
  assert.equal(first.existing, false);
  assert.equal(second.existing, true);
  assert.equal((await db.subscriptions.list({})).length, 1);
});

test('a nonsense subscription is refused', async () => {
  const result = await registerSubscription({ store: store(), subscription: { endpoint: 'javascript:alert(1)' } });
  assert.equal(result.ok, false);
});

test('the notification wording is built from the event, not the caller', () => {
  const awaiting = buildNotification('order-awaiting', { orderId: 'o2', title: 'Private transfer' });
  assert.equal(awaiting.title, 'Private transfer');
  assert.match(awaiting.body, /conferma/);
  const reservation = buildNotification('reservation-new', { reservationId: 'r1', guest: 'Marta Venturi', room: '303', check_in: '2026-10-12', check_out: '2026-10-15' });
  assert.match(reservation.body, /Marta Venturi · Camera 303 · 2026-10-12 → 2026-10-15/);
  assert.equal(buildNotification('nonsense', {}), null);
});

/* ── The provider calendar ───────────────────────────────────────────────── */

test('the hair calendar is a described seam, not a stub that invents slots', async () => {
  const calendar = createGoogleCalendarAdapter({});
  assert.equal(calendar.configured, false);
  assert.ok(calendar.requires.includes('GOOGLE_CALENDAR_ID'));
  assert.equal(calendar.writeCalendar, 'LunArt Hair Bookings');
  await assert.rejects(() => calendar.freeBusy({ from: '2026-10-01', to: '2026-10-07' }), /not configured/);

  const event = calendar.eventFor({ variantId: 'men-cut', date: '2026-10-12', time: '10:00', room: '303', guestName: 'Marta', serviceTitle: 'Taglio' });
  assert.equal(event.minutes, 60, 'the internal duration, for blocking out time');
  assert.match(event.summary, /camera 303/);
  assert.match(event.description, /Marta/);

  const written = await calendar.createEvent({ variantId: 'men-cut', date: '2026-10-12', time: '10:00', room: '303' });
  assert.equal(written.ok, false);
  assert.equal(written.reason, 'source-not-configured');
  assert.equal(providerCalendars({}).some((entry) => entry.configured), false);
});

test('a paid hair booking records that it has not reached a calendar', async () => {
  applyPriceOverrides(DEV_PRICES);
  const db = store();
  const app = await createApp({
    store: db, stripe: createMockStripe(), allowPlaceholderPrices: true,
    cardSigningKey: 'staff-test', staffToken: '', mode: 'development', seed: false,
    useDevPrices: false,
  });

  const saved = await db.orders.create(order({
    lines: [{
      product_id: 'hair-service', variant_id: 'men-cut', title: 'Private Hair Service',
      variant_title: 'Taglio', quantity: 1, amount: 4900, date: '2026-10-12', time: '10:00',
      room: '303', fulfillment_type: 'provider', fields: { guestName: 'Marta', phone: '+39348' }, options: {},
    }],
    status: PAYMENT_STATUS.pending,
    stripe_payment_intent_id: 'pi_test',
  }));

  await handleStripeEvent({
    id: 'evt_hair_1', type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_test', metadata: { order_id: saved.id } } },
  }, { store: db, stripe: app.stripe, settings: app.settings, push: app.push, providerCalendar: app.providerCalendar });

  const after = await db.orders.get(saved.id);
  assert.equal(after.status, PAYMENT_STATUS.paid);
  assert.equal(after.calendar.results[0].ok, false);
  assert.equal(after.calendar.results[0].reason, 'source-not-configured');
  assert.ok(after.events.some((entry) => entry.type === 'calendar-write'));
  applyPriceOverrides({});
});
