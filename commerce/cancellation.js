/**
 * What can still be called off, and what that is worth.
 *
 * The catalogue is the only source of truth here. Every product carries a
 * `cancellation` rule — `none`, `dayBefore` at an hour, `hoursBefore` by so many
 * hours — and this module turns that rule, plus the date on the line, plus the
 * clock, into one answer: can this be cancelled now, until when, and how much comes
 * back. Nothing is read from the order about the policy itself, because an order is
 * a record of a purchase and not a record of the terms; terms that were copied into
 * a row in September are terms nobody can correct in October.
 *
 * It is shared rather than duplicated. The browser uses it to decide whether to
 * offer a cancel button and to say until when; the server uses the same functions
 * to decide whether to honour one. That is the only way those two can agree, and
 * the browser's answer is never the one that counts — `server/cancellation.js` runs
 * this again from the stored order before any money moves.
 *
 * Two things it deliberately does not do. It does not decide what has already been
 * refunded: that is in the order's own ledger, and it is passed in. And it does not
 * talk to Stripe, which is why it can be tested by arithmetic.
 */

import { getProduct, cancellableUntil } from './ordering.js';
import { PAYMENT_STATUS, FULFILMENT_STATUS } from './schema.js';

/** Why a line cannot be called off. One of these, never a bare `false`. */
export const BLOCKED = {
  /** The product is sold outright: the Privilege Card, the welcome gift. */
  'policy-none': 'policy-none',
  /** The window closed. */
  'past-deadline': 'past-deadline',
  /** Every unit of it is already cancelled. */
  'already-cancelled': 'already-cancelled',
  /** It has gone up, gone out, or been delivered. */
  'already-fulfilled': 'already-fulfilled',
  /** The order as a whole is not in a state where anything can be given back. */
  'order-closed': 'order-closed',
  /** Nothing was ever taken, so there is nothing to call off. */
  'nothing-committed': 'nothing-committed',
};

/** Fulfilment states past which a thing has happened and cannot be un-happened. */
const DONE = new Set([
  FULFILMENT_STATUS['in-preparation'],
  FULFILMENT_STATUS.delivered,
  FULFILMENT_STATUS.completed,
]);

/** Order states where nothing is left to give back. */
const CLOSED = new Set([
  PAYMENT_STATUS.cancelled,
  PAYMENT_STATUS.refunded,
  PAYMENT_STATUS.failed,
]);

/**
 * Money states and what calling something off actually does to them.
 *
 *   paid / confirmed  money was taken, so it is given back: a refund
 *   authorized        money is held, not taken: the hold shrinks, or is released
 *   pending           checkout never finished, so there is nothing to undo
 *
 * The distinction matters to the guest, because "rimborsato" and "non addebitato"
 * are different sentences and only one of them involves waiting for a bank.
 */
export function settlementFor(order) {
  if (order?.status === PAYMENT_STATUS.paid || order?.status === PAYMENT_STATUS.confirmed) return 'refund';
  if (order?.status === PAYMENT_STATUS.authorized) return 'release';
  return 'none';
}

/** The line, as the cancellation rules want to read it. */
const asCartLine = (line) => ({ date: line.date, time: line.time, slotId: line.slot_id });

/**
 * How much of one line has already been given back, and how much is left.
 *
 * Integer eurocents throughout, and the last unit is special: it gets whatever
 * remains rather than its own share, so cancelling three units one at a time returns
 * exactly the line total and never a cent more or less.
 */
export function refundableFor(line, quantity) {
  const total = Number(line.amount ?? 0);
  const units = Math.max(1, Number(line.quantity ?? 1));
  const already = Number(line.refunded_amount ?? 0);
  const cancelled = Number(line.cancelled_quantity ?? 0);
  const asked = Math.max(0, Math.min(Math.trunc(quantity), units - cancelled));
  if (asked === 0) return { quantity: 0, amount: 0, remainingAfter: units - cancelled };

  const lastUnits = cancelled + asked >= units;
  const amount = lastUnits
    // Whatever is left of the line, so the arithmetic closes exactly.
    ? Math.max(0, total - already)
    : Math.round((total * asked) / units);

  return {
    quantity: asked,
    amount: Math.max(0, Math.min(amount, total - already)),
    remainingAfter: units - cancelled - asked,
  };
}

/**
 * One line's cancellation state.
 *
 * `index` travels with it because that is how the guest's request names a line: the
 * position in the order. Nothing about a product id or an amount comes from the
 * request, so there is nothing in it to tamper with.
 */
export function lineCancellation(order, index, { now = new Date() } = {}) {
  const line = order?.lines?.[index];
  if (!line) return null;

  const product = getProduct(line.product_id);
  const policy = product?.cancellation ?? { kind: 'none' };
  const window = cancellableUntil(product, asCartLine(line));
  const units = Math.max(1, Number(line.quantity ?? 1));
  const cancelled = Number(line.cancelled_quantity ?? 0);
  const remaining = Math.max(0, units - cancelled);
  const settlement = settlementFor(order);

  /**
   * Order of these matters, and the first two are the ones that look alike.
   *
   * A line whose last unit has already gone reports `already-cancelled` even though
   * the order it is on may by then be closed *because of* that cancellation. "You
   * already did this" is the right answer to a second tap; "this order is over"
   * belongs to a line that still has units on an order that ended some other way.
   */
  let blocked = null;
  if (remaining === 0) blocked = BLOCKED['already-cancelled'];
  else if (CLOSED.has(order.status)) blocked = BLOCKED['order-closed'];
  else if (policy.kind === 'none') blocked = BLOCKED['policy-none'];
  else if (DONE.has(order.fulfilment_status)) blocked = BLOCKED['already-fulfilled'];
  else if (settlement === 'none') blocked = BLOCKED['nothing-committed'];
  else if (window.deadline && now > window.deadline) blocked = BLOCKED['past-deadline'];

  const value = refundableFor(line, remaining);

  return {
    index,
    title: line.title,
    variant_title: line.variant_title ?? null,
    date: line.date ?? null,
    time: line.time ?? null,
    quantity: units,
    cancelled_quantity: cancelled,
    remaining_quantity: remaining,
    /** The rule itself, so a screen can say it rather than paraphrase it. */
    policy: { kind: policy.kind, hours: policy.hours ?? null, hour: policy.hour ?? null },
    deadline: window.deadline ? window.deadline.toISOString() : null,
    cancellable: blocked === null,
    blocked,
    /** What calling it off would do, and for how much. */
    settlement: blocked === null ? settlement : 'none',
    refundable_amount: blocked === null ? value.amount : 0,
    refunded_amount: Number(line.refunded_amount ?? 0),
  };
}

/** Every line of one order, and whether there is anything at all to offer. */
export function orderCancellation(order, { now = new Date() } = {}) {
  const lines = (order?.lines ?? []).map((_, index) => lineCancellation(order, index, { now }));
  return {
    lines,
    anyCancellable: lines.some((line) => line?.cancellable),
    refunded_amount: Number(order?.refunded_amount ?? 0),
    cancelled_amount: Number(order?.cancelled_amount ?? 0),
  };
}

/**
 * The policy as a sentence, before anything is bought.
 *
 * Derived from the same rule the cancellation itself will read, so what the guest
 * was told at the point of sale and what happens three days later cannot disagree.
 * Returned as data — a kind and a number — rather than as prose, so the two
 * languages live with the rest of the copy.
 */
export function policyOf(product) {
  const rule = product?.cancellation;
  if (!rule || rule.kind === 'none') return { kind: 'none' };
  if (rule.kind === 'dayBefore') return { kind: 'dayBefore', hour: rule.hour ?? 12 };
  if (rule.kind === 'hoursBefore') return { kind: 'hoursBefore', hours: rule.hours ?? 0 };
  return { kind: rule.kind };
}
