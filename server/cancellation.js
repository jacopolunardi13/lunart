/**
 * Calling something off, and giving the money back.
 *
 * The guest can do this themselves. That is the whole point: a breakfast ordered for
 * Thursday and no longer wanted at nine on Wednesday evening should not require
 * finding somebody, and the rule that says whether it is still allowed is already
 * written down in the catalogue. What it must not become is a button that the
 * browser decides the meaning of.
 *
 * So every answer is recomputed here, from the stored order and the catalogue, at
 * the server's own clock:
 *
 *   the policy        from `commerce/catalog.js`, never from the order row
 *   the deadline      from that policy and the line's own date and slot
 *   the amount        from the line's stored amount, which the server priced
 *   the state         from the order's payment and fulfilment status
 *
 * The request contributes two things and nothing else: which line, and how many of
 * it. Not a price, not a date, not a product id, not a policy.
 *
 * Partial cancellation is the normal case, not an edge. An order holding a €49
 * brunch and a €15 Privilege Card is one payment and two entirely different
 * promises: the brunch can be called off until eight the evening before, the Card
 * cannot be called off at all, and refunding the brunch must leave the Card valid
 * and its entitlement untouched. That is why a cancellation is per line and why the
 * order's own status only moves to `refunded` when the last cent of it has gone
 * back.
 *
 * Idempotence comes from the ledger rather than from a lock. Each cancellation
 * writes how many units went and how much was returned; a second identical request
 * finds the units already gone and does nothing. The Stripe idempotency key carries
 * the same count, so a retry that reaches Stripe cannot refund twice either.
 */

import { PAYMENT_STATUS, FULFILMENT_STATUS } from '../commerce/schema.js';
import { lineCancellation, orderCancellation, refundableFor } from '../commerce/cancellation.js';
import { canTransition } from './orders.js';

export { lineCancellation, orderCancellation };

/** Who asked. Recorded on every entry, because it is the first thing anyone asks. */
export const ACTORS = { guest: 'guest', staff: 'staff' };

const clamp = (value, max) => Math.max(0, Math.min(Math.trunc(Number(value) || 0), max));

/**
 * Cancel some or all of one line, and settle the money for it.
 *
 * Returns `{ ok, order, outcome }` where `outcome` says what happened to the money
 * in the guest's terms — `refunded`, `released`, `reduced`, `nothing-to-settle` —
 * rather than in Stripe's.
 */
export async function cancelOrderLine({
  store, stripe, order, index, quantity = 0, actor = ACTORS.guest, reason = '', now = new Date(),
}) {
  const line = order?.lines?.[index];
  if (!line) return { ok: false, reason: 'no-such-line' };

  const state = lineCancellation(order, index, { now });
  if (!state.cancellable) return { ok: false, reason: state.blocked, line: state };

  const asked = clamp(quantity || state.remaining_quantity, state.remaining_quantity);
  if (asked === 0) return { ok: false, reason: 'already-cancelled', line: state };

  const value = refundableFor(line, asked);

  /**
   * The key that makes a retry harmless.
   *
   * It carries how many units had already gone before this request, so cancelling
   * one unit and then another are two different operations, while the same request
   * sent twice is one. Stripe refuses the second with the first one's result.
   */
  const alreadyGone = Number(line.cancelled_quantity ?? 0);
  const idempotencyKey = `cancel-line:${order.id}:${index}:${alreadyGone}:${asked}`;

  /* ── Settle ──────────────────────────────────────────────────────────── */

  const wouldLeave = remainingAfter(order, index, asked);
  let outcome = 'nothing-to-settle';
  let providerReference = null;

  if (state.settlement === 'refund' && value.amount > 0) {
    if (!order.stripe_payment_intent_id) {
      // No payment to refund against. Mock checkout and preview orders live here;
      // the ledger is still written so the state is honest either way.
      outcome = 'refunded-offline';
    } else {
      try {
        const refund = await stripe.createRefund(
          { payment_intent: order.stripe_payment_intent_id, amount: value.amount },
          { idempotencyKey },
        );
        providerReference = refund?.id ?? null;
        outcome = 'refunded';
      } catch (error) {
        // Nothing is written. The guest is told it did not happen, and the line is
        // still theirs to cancel — which is the only safe way for this to fail.
        return { ok: false, reason: 'refund-failed', message: error.message, line: state };
      }
    }
  } else if (state.settlement === 'release') {
    if (wouldLeave === 0 && order.stripe_payment_intent_id) {
      // Nothing is left of the order, so the hold on the card goes entirely.
      try {
        await stripe.cancelPaymentIntent(order.stripe_payment_intent_id, {}, { idempotencyKey });
        outcome = 'released';
      } catch (error) {
        return { ok: false, reason: 'release-failed', message: error.message, line: state };
      }
    } else {
      /**
       * A hold cannot be made smaller, only captured for less.
       *
       * So nothing is sent to Stripe now: the order's amount comes down, and the
       * capture — when the driver confirms — asks for the reduced figure. The guest
       * is never charged for what they called off, and no authorisation is dropped
       * and re-taken on a card that might then decline.
       */
      outcome = 'reduced';
    }
  }

  /* ── Write it down ───────────────────────────────────────────────────── */

  const entry = {
    at: now.toISOString(),
    quantity: asked,
    amount: value.amount,
    actor,
    reason: String(reason ?? '').slice(0, 300),
    outcome,
    /** Stripe's own reference, kept for reconciliation. Never shown to a guest. */
    provider_reference: providerReference,
  };

  const lines = order.lines.map((row, position) => {
    if (position !== index) return row;
    const cancelledQuantity = alreadyGone + asked;
    return {
      ...row,
      /** What it was, before anything was given back. Written once, never moved. */
      original_amount: Number(row.original_amount ?? row.amount ?? 0),
      cancelled_quantity: cancelledQuantity,
      cancelled_at: now.toISOString(),
      cancelled_by: actor,
      refunded_amount: Number(row.refunded_amount ?? 0) + (settles(outcome) ? value.amount : 0),
      cancellations: [...(row.cancellations ?? []), entry],
    };
  });

  const refundedTotal = lines.reduce((sum, row) => sum + Number(row.refunded_amount ?? 0), 0);
  const cancelledTotal = lines.reduce((sum, row) => {
    const units = Math.max(1, Number(row.quantity ?? 1));
    const gone = Number(row.cancelled_quantity ?? 0);
    return sum + (gone >= units
      ? Number(row.original_amount ?? row.amount ?? 0)
      : Math.round((Number(row.original_amount ?? row.amount ?? 0) * gone) / units));
  }, 0);

  const patch = {
    lines,
    /** Aggregates, so no screen has to add up a ledger to show a total. */
    refunded_amount: refundedTotal,
    cancelled_amount: cancelledTotal,
    events: [...(order.events ?? []), {
      at: now.toISOString(),
      type: `line-cancelled:${outcome}`,
      note: `${actor}: ${line.title}${asked > 1 ? ` ×${asked}` : ''}`
        + `${value.amount ? ` · ${(value.amount / 100).toFixed(2)} ${order.currency}` : ''}`,
    }],
  };

  /**
   * An authorisation that shrank is captured for less later, so the order's own
   * amount is what the capture will ask for. A refund does not move the amount:
   * the order was for that much, and `refunded_amount` says what came back.
   */
  if (outcome === 'reduced') patch.amount = Math.max(0, Number(order.amount ?? 0) - value.amount);

  /**
   * The order's own state moves only when nothing is left of it.
   *
   * This is the mixed-order rule in one place: refunding the brunch out of a
   * brunch-and-Card order leaves the order `paid`, because the Card is still owed
   * and still valid. Marking the whole order `refunded` would be the shortest route
   * to revoking an entitlement somebody paid for.
   */
  if (wouldLeave === 0) {
    if (outcome === 'released' || outcome === 'reduced' || state.settlement === 'none') {
      if (canTransition(order.status, PAYMENT_STATUS.cancelled)) patch.status = PAYMENT_STATUS.cancelled;
    } else if (refundedTotal >= Number(order.amount ?? 0)) {
      if (canTransition(order.status, PAYMENT_STATUS.refunded)) patch.status = PAYMENT_STATUS.refunded;
    }
    if (!keepsEntitlement(lines)) patch.fulfilment_status = FULFILMENT_STATUS.cancelled;
  }

  const updated = await store.orders.update(order.id, patch);
  return { ok: true, order: updated, outcome, amount: value.amount, quantity: asked, settlement: state.settlement };
}

/** True when this outcome actually returned money, as opposed to arranging not to take it. */
const settles = (outcome) => outcome === 'refunded' || outcome === 'refunded-offline';

/** How many units of the whole order would still stand after this cancellation. */
function remainingAfter(order, index, asked) {
  return order.lines.reduce((sum, row, position) => {
    const units = Math.max(1, Number(row.quantity ?? 1));
    const gone = Number(row.cancelled_quantity ?? 0) + (position === index ? asked : 0);
    return sum + Math.max(0, units - gone);
  }, 0);
}

/**
 * Does anything on this order still entitle the guest to something?
 *
 * A Privilege Card cannot be cancelled, so a fully-cancelled order that contains one
 * is a contradiction that cannot arise — but the check is here rather than assumed,
 * because the day a second non-cancellable product is added is the day an assumption
 * like that quietly revokes a card.
 */
const keepsEntitlement = (lines) => lines.some((row) => (
  row.fulfillment_type === 'digital-entitlement'
  && Number(row.cancelled_quantity ?? 0) < Math.max(1, Number(row.quantity ?? 1))
));
