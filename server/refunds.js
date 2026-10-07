/**
 * A refund that happened at the payment provider, reconciled into what LunArt holds.
 *
 * LunArt's own cancellations are the other direction and are not this file's
 * business: `server/cancellation.js` decides which line a guest may call off, how
 * much comes back and whether the money is refunded or a hold shrinks, and it
 * remains the authority for anything LunArt initiates. This is the reverse — money
 * has already moved somewhere else, and the records have to catch up.
 *
 * ── What went wrong ─────────────────────────────────────────────────────────
 *
 * A Privilege Card was bought for €15 while production was briefly pointed at a
 * different live Stripe account. The charge was refunded in full from the Stripe
 * dashboard; that account had no webhook pointing here, so nothing arrived. The
 * order still read `paid`, the card still issued a rotating QR, a venue would still
 * have honoured it, and the guest's home still showed Privilege. Fifteen euros is
 * nothing; a card that works after the money has gone back is not.
 *
 * And the gap was not the missing webhook. `charge.refunded` was handled — it moved
 * the money status and did nothing else. No `refunded_amount`, no revocation, no
 * difference between a full refund and a partial one. The same button inside the
 * Staff app had the same hole. So the fix is one function that both paths call, and
 * no path that writes a refund without going through it.
 *
 * ── Full against partial ────────────────────────────────────────────────────
 *
 * A full refund is unambiguous: nothing is owed, so nothing this order bought is
 * still owned, and anything digital it issued is revoked.
 *
 * A partial refund from a dashboard is the opposite of unambiguous. Stripe knows an
 * amount; it has no idea which LunArt line an operator had in mind, and guessing
 * would mean revoking a card because somebody refunded a breakfast. So the money
 * total is recorded, nothing is revoked, and a person is told. That is the whole
 * policy: the figure is a fact and the allocation is a judgement, and only one of
 * them can be made here.
 */

import { canTransition, appendEvent, orderReference } from './orders.js';
import { PAYMENT_STATUS } from '../commerce/schema.js';
import { revoke } from './card.js';
import { raiseAlert } from './ingest/index.js';

/** Where a reconciliation came from. Recorded, because the two differ in trust. */
export const REFUND_SOURCES = {
  /** Stripe told us, on an account whose webhook reaches here. */
  provider: 'provider-webhook',
  /** A person told us, having verified the refund at the provider themselves. */
  staff: 'staff-reconciliation',
};

/**
 * What a Stripe charge says has come back.
 *
 * `amount_refunded` is Stripe's own running total for the charge, not the size of
 * the latest refund — which is exactly what makes replaying an event harmless: the
 * figure is absolute, so applying it twice says the same thing once.
 */
export function refundFromCharge(charge = {}) {
  const charged = Math.max(0, Math.trunc(Number(charge.amount) || 0));
  const refunded = Math.max(0, Math.trunc(Number(charge.amount_refunded) || 0));
  return {
    charged,
    refunded,
    /** Stripe's own flag where it has one, and the arithmetic where it does not. */
    full: charge.refunded === true || (refunded > 0 && charged > 0 && refunded >= charged),
    reference: typeof charge.id === 'string' ? charge.id : null,
  };
}

/** States an external refund may be reconciled from. Anything else is a question. */
const RECONCILABLE = new Set([
  PAYMENT_STATUS.paid,
  PAYMENT_STATUS.confirmed,
  /** Already there: a second delivery, which must be allowed and change nothing. */
  PAYMENT_STATUS.refunded,
]);

/**
 * Bring an order into line with a refund that has already happened elsewhere.
 *
 * Idempotent by construction rather than by a flag. Every figure it writes is
 * absolute — the provider's running total, the full order amount, the card's
 * revoked state — so the second call computes the same end state, finds it already
 * there, and writes nothing. That matters more here than almost anywhere: Stripe
 * retries, and a reconciliation that revoked a card twice would rewrite the moment
 * a guest's entitlement ended.
 *
 * @param {number} amount    what the provider says it has given back, in total
 * @param {boolean} full     whether that is the whole charge
 * @param {string} reference the provider's own refund or charge id, when known
 * @param {string} source    one of `REFUND_SOURCES`
 */
export async function reconcileExternalRefund({
  store, order, amount = 0, full = false, reference = null,
  source = REFUND_SOURCES.provider, actor = '', reason = '', now = new Date(),
}) {
  if (!order) return { ok: false, reason: 'no-order' };
  if (!RECONCILABLE.has(order.status)) {
    return { ok: false, reason: 'not-reconcilable', status: order.status };
  }

  const charged = Math.max(0, Math.trunc(Number(order.amount) || 0));
  const claimed = Math.max(0, Math.trunc(Number(amount) || 0));

  /**
   * A refund we cannot put a figure on.
   *
   * The provider only raises a refund event when money has moved, so a total of
   * nothing means the payload could not be read — a shape that changed, a relayed
   * event that lost its fields. Neither silence nor a guess will do: doing nothing
   * quietly leaves a card working after a refund, and assuming "full" would revoke
   * one on no evidence. So nothing is written and a person is told, which is the
   * only honest answer to "something was refunded and we do not know how much".
   */
  if (claimed === 0 && !full) {
    await raiseAlert({
      store,
      key: `refund-unreadable:${order.id}`,
      kind: 'refund-amount-unreadable',
      severity: 'action',
      detail: {
        message: 'Rimborso segnalato dal provider senza un importo leggibile: controllare su Stripe.',
        order_id: order.id,
        reference: orderReference(order),
        order_amount: charged,
        provider_reference: reference,
        source,
        at: now.toISOString(),
      },
    });
    return {
      ok: true, action: 'unreadable', order, full: false,
      refunded_amount: Number(order.refunded_amount ?? 0), revoked: [], needsReview: true,
    };
  }
  /** The provider's total never goes backwards; a later event only ever knows more. */
  const held = Math.max(0, Math.trunc(Number(order.provider_refunded_amount) || 0));
  const providerTotal = Math.max(held, claimed);
  const whole = full || (providerTotal > 0 && charged > 0 && providerTotal >= charged);

  const patch = {};
  if (providerTotal !== held) patch.provider_refunded_amount = providerTotal;

  /**
   * The order-level figure, which has two sources that must not fight.
   *
   * `cancelOrderLine` computes it from what the lines account for; this knows what
   * the provider has actually returned. The larger is the honest answer, and taking
   * the larger means neither path can make the other look like less money came
   * back than did.
   */
  const refundedNow = Math.max(Math.trunc(Number(order.refunded_amount) || 0), providerTotal);
  if (refundedNow !== Number(order.refunded_amount ?? 0)) patch.refunded_amount = refundedNow;

  /**
   * The thing itself is deliberately left alone.
   *
   * `queueOf` already files a refunded order under `cancelled` whatever its
   * fulfilment state, so nobody is about to prepare it — and overwriting a
   * breakfast that really was delivered with "cancelled" would erase something that
   * happened in order to tidy something that did not.
   */
  const movingToRefunded = whole
    && order.status !== PAYMENT_STATUS.refunded
    && canTransition(order.status, PAYMENT_STATUS.refunded);
  if (movingToRefunded) patch.status = PAYMENT_STATUS.refunded;

  /* ── The entitlements, and only on a full refund ─────────────────────── */

  const revoked = [];
  if (whole) {
    for (const entitlement of order.entitlements ?? []) {
      const card = await store.cards.get(entitlement.id);
      if (!card) continue;
      // Already revoked: leave the moment it happened where it is.
      if (card.status === 'revoked') continue;
      const note = `rimborso completo dell'ordine ${orderReference(order)}${reference ? ` (${reference})` : ''}`;
      await store.cards.update(card.id, revoke(card, note));
      revoked.push(card.public_ref);
    }
  }

  /**
   * History, only where there is history to write.
   *
   * A retry that changed nothing must not leave a second line in a log staff read
   * to work out what happened: "rimborsato" twice is a question, not a record.
   */
  const changed = Object.keys(patch).length > 0 || revoked.length > 0;
  if (!changed) {
    return {
      ok: true, action: 'unchanged', order, full: whole,
      refunded_amount: refundedNow, revoked: [], needsReview: false,
    };
  }

  const detail = [
    `${(providerTotal / 100).toFixed(2).replace('.', ',')} €`,
    whole ? 'completo' : 'parziale',
    source,
    reference ? `rif. ${reference}` : null,
    actor ? `da ${actor}` : null,
    reason || null,
    revoked.length ? `revocate: ${revoked.join(', ')}` : null,
  ].filter(Boolean).join(' · ');

  const updated = await store.orders.update(order.id, {
    ...patch,
    events: appendEvent(order, whole ? 'refund-reconciled' : 'partial-refund-recorded', detail).events,
  });

  /**
   * And the one case a person has to settle.
   *
   * Keyed on the order, so Stripe delivering the same partial refund five times
   * raises one thing to look at rather than five. `raiseAlert` counts the sightings
   * on the row it already has.
   */
  const needsReview = !whole;
  if (needsReview) {
    await raiseAlert({
      store,
      key: `refund-partial:${order.id}`,
      kind: 'partial-refund-unallocated',
      severity: 'action',
      detail: {
        message: 'Rimborso parziale ricevuto dal provider: non è possibile sapere a quale riga si riferisce.',
        order_id: order.id,
        reference: orderReference(order),
        order_amount: charged,
        refunded_amount: providerTotal,
        provider_reference: reference,
        source,
        at: now.toISOString(),
      },
    });
  }

  return {
    ok: true,
    action: whole ? 'refunded' : 'recorded',
    order: updated,
    full: whole,
    refunded_amount: refundedNow,
    revoked,
    needsReview,
  };
}
