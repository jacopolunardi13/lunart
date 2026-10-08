/**
 * Return Pass — shared EUR 6,000 hard cap.
 *
 * Important: the original Stripe Payment Links MUST be deactivated before this
 * route is marketed. A static Payment Link bypasses this ledger entirely.
 *
 * All three tiers reserve against one persisted balance. Stripe uses card-only,
 * manual-capture Checkout: no charge is captured until the ledger has durably
 * marked its full value as "capturing". A crash conservatively holds capacity.
 *
 * One Render service with its shared persistent /var/data disk is assumed.
 * A mkdir-based file lock protects read-modify-write during overlapping deploys.
 */
import { mkdir, readFile, writeFile, rename, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const RETURN_PASS_CAMPAIGN = 'lunart_return_pass_2026_10';
export const RETURN_PASS_CAP_CENTS = 600000;
export const RETURN_PASS_TIERS = Object.freeze({
  '300': Object.freeze({ amount: 30000, credit: 360, privilegeDays: 0 }),
  '500': Object.freeze({ amount: 50000, credit: 600, privilegeDays: 0 }),
  '750': Object.freeze({ amount: 75000, credit: 900, privilegeDays: 2 }),
});
const ENDS_AT = Date.parse('2026-10-17T00:00:00+02:00');
const ACTIVE_SESSION_MS = 35 * 60000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createReturnPassCap({ stripe, origin, dataDir = '/var/data', clock = Date.now } = {}) {
  if (!stripe) throw new Error('Stripe adapter required');
  const path = join(dataDir, 'return-pass-cap-2026-10.json');
  const lock = path + '.lock';

  async function underLock(fn) {
    await mkdir(dataDir, { recursive: true });
    let acquired = false;
    for (let tries = 0; tries < 80; tries++) {
      try {
        await mkdir(lock);
        acquired = true;
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // Recover a lock left by a killed process; writes are fail-closed.
        const last = await stat(lock).catch(() => null);
        if (last && Date.now() - last.mtimeMs > 45000) {
          await rmdir(lock).catch(() => {});
        } else {
          await sleep(75);
        }
      }
    }
    if (!acquired) throw new Error('Return Pass ledger busy — try again');
    try {
      let state;
      try { state = JSON.parse(await readFile(path, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error; // Never silently erase a damaged ledger.
        state = { version: 1, reservations: {} };
      }
      if (state.version !== 1 || !state.reservations || typeof state.reservations !== 'object') {
        throw new Error('Return Pass ledger invalid — refusing sales');
      }
      const result = await fn(state);
      const temp = path + '.' + process.pid + '.' + randomUUID() + '.tmp';
      await writeFile(temp, JSON.stringify(state, null, 2));
      await rename(temp, path);
      return result;
    } finally {
      await rmdir(lock).catch(() => {});
    }
  }

  function usage(state, now, exclude = '') {
    let committed = 0;
    let held = 0;
    for (const [id, item] of Object.entries(state.reservations)) {
      if (id === exclude) continue;
      if (item.state === 'paid' || item.state === 'capturing') committed += item.amount;
      if (item.state === 'pending' && item.expires_at > now) held += item.amount;
    }
    return { committed, held };
  }

  async function status() {
    return underLock(async (state) => {
      const now = clock();
      const { committed, held } = usage(state, now);
      const remaining = Math.max(0, RETURN_PASS_CAP_CENTS - committed - held);
      const active = now < ENDS_AT;
      return {
        active, capEuro: 6000,
        allocatedEuro: committed / 100, reservedEuro: held / 100,
        remainingEuro: remaining / 100,
        tiers: Object.fromEntries(Object.entries(RETURN_PASS_TIERS).map(([tier, spec]) =>
          [tier, active && remaining >= spec.amount])),
      };
    });
  }

  async function reserve(tier) {
    tier = String(tier);
    const spec = RETURN_PASS_TIERS[tier];
    if (!spec) return { ok: false, error: 'invalid-tier' };
    return underLock(async (state) => {
      const now = clock();
      if (now >= ENDS_AT) return { ok: false, error: 'promotion-ended' };
      const { committed, held } = usage(state, now);
      if (committed + held + spec.amount > RETURN_PASS_CAP_CENTS) {
        return { ok: false, error: 'sold-out', remainingEuro: (RETURN_PASS_CAP_CENTS - committed - held) / 100 };
      }
      const id = randomUUID();
      state.reservations[id] = {
        tier, amount: spec.amount, state: 'pending',
        created_at: new Date(now).toISOString(),
        expires_at: now + ACTIVE_SESSION_MS,
      };
      return { ok: true, id, spec, expiresAt: now + ACTIVE_SESSION_MS };
    });
  }

  async function mark(id, patch, allowed) {
    return underLock(async (state) => {
      const current = state.reservations[id];
      if (!current || (allowed && !allowed.includes(current.state))) return false;
      Object.assign(current, patch);
      return true;
    });
  }

  async function startCheckout(tier) {
    if (stripe.mode === 'mock') return { ok: false, error: 'payments-not-configured' };
    const r = await reserve(tier);
    if (!r.ok) return r;
    const spec = r.spec;
    try {
      const session = await stripe.createCheckoutSession({
        mode: 'payment',
        currency: 'eur',
        payment_method_types: ['card'],
        customer_creation: 'always',
        name_collection: { individual: { enabled: true, optional: false } },
        phone_number_collection: { enabled: true },
        line_items: [{
          price_data: {
            currency: 'eur',
            unit_amount: spec.amount,
            product_data: {
              name: `LunArt Firenze Return Pass €${tier} → €${spec.credit} credito`,
              description: spec.privilegeDays ? 'Include 2 giorni di LunArt Privilege Card' : 'Valido per prenotazioni dirette, 12 mesi',
            },
          },
          quantity: 1,
        }],
        metadata: { campaign: RETURN_PASS_CAMPAIGN, return_pass_reservation: r.id, tier },
        payment_intent_data: {
          capture_method: 'manual',
          metadata: { campaign: RETURN_PASS_CAMPAIGN, return_pass_reservation: r.id, tier },
        },
        expires_at: Math.floor(clock() / 1000) + 1860,
        success_url: `${origin}/return-pass.html?success=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/return-pass.html?canceled=1`,
        locale: 'auto',
      }, { idempotencyKey: `return-pass-create:${r.id}` });
      if (!session?.id || !session?.url) throw new Error('Stripe checkout response incomplete');
      await mark(r.id, { stripe_session_id: session.id }, ['pending']);
      return { ok: true, checkoutUrl: session.url };
    } catch (error) {
      await mark(r.id, { state: 'failed', reason: 'checkout-creation-failed' }, ['pending']);
      throw error;
    }
  }

  /** Called ONLY after webhook signature verification. Never trust client-supplied session data. */
  async function completed(session) {
    const id = session?.metadata?.return_pass_reservation;
    if (session?.metadata?.campaign !== RETURN_PASS_CAMPAIGN || !id) return { ignored: true };
    const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!intentId || !session.id) throw new Error('Completed checkout without payment intent');
    const decision = await underLock(async (state) => {
      const item = state.reservations[id];
      if (!item) return 'unknown';
      if (item.state === 'paid') return 'paid';
      if (item.state === 'rejected') return 'rejected';
      if (item.state === 'failed' || item.state === 'expired') return 'rejected';
      if (item.state === 'capturing') return 'capture';
      if (item.state !== 'pending') return 'unknown';
      if (item.stripe_session_id && item.stripe_session_id !== session.id) return 'unknown';
      const { committed, held } = usage(state, clock(), id);
      if (committed + held + item.amount > RETURN_PASS_CAP_CENTS) {
        item.state = 'rejected';
        item.payment_intent_id = intentId;
        return 'rejected';
      }
      // Commit full capacity BEFORE requesting capture: crash/retry cannot oversell.
      item.state = 'capturing';
      item.payment_intent_id = intentId;
      item.stripe_session_id = session.id;
      return 'capture';
    });
    if (decision === 'unknown') throw new Error('Unknown or mismatched Return Pass reservation');
    if (decision === 'paid') return { ok: true, repeated: true };
    if (decision === 'rejected') {
      await stripe.cancelPaymentIntent(intentId, {}, { idempotencyKey: `return-pass-cancel:${id}` });
      return { ok: false, error: 'limit-reached-authorization-released' };
    }
    try {
      const payment = await stripe.capturePaymentIntent(intentId, {}, { idempotencyKey: `return-pass-capture:${id}` });
      if (payment.status !== 'succeeded') throw new Error('Stripe capture not succeeded');
    } catch (error) {
      // A lost capture response can happen. Fetch Stripe's true state before retry.
      const payment = await stripe.retrievePaymentIntent(intentId);
      if (payment.status !== 'succeeded') throw error; // Keep cap reserved and allow webhook retry.
    }
    await mark(id, { state: 'paid', paid_at: new Date(clock()).toISOString() }, ['capturing']);
    return { ok: true, captured: true, tier: session.metadata.tier };
  }

  async function expired(session) {
    const id = session?.metadata?.return_pass_reservation;
    if (session?.metadata?.campaign !== RETURN_PASS_CAMPAIGN || !id) return { ignored: true };
    await mark(id, { state: 'expired' }, ['pending']);
    return { ok: true };
  }

  return { status, reserve, startCheckout, completed, expired };
}
