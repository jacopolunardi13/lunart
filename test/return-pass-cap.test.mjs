import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReturnPassCap, RETURN_PASS_CAMPAIGN } from '../server/return-pass-cap.js';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'return-pass-cap-'));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  let now = Date.parse('2026-10-09T12:00:00+02:00');
  const sessions = [];
  let captures = 0;
  let throwCapture = false;
  const stripe = {
    mode: 'live',
    async createCheckoutSession(request) {
      const session = {
        id: 'cs_test_' + (sessions.length + 1),
        url: 'https://checkout.stripe.com/pay/test_' + (sessions.length + 1),
        metadata: request.metadata,
        payment_intent: 'pi_test_' + (sessions.length + 1),
      };
      sessions.push({ request, session });
      return session;
    },
    async capturePaymentIntent() {
      captures++;
      if (throwCapture) throw new Error('capture timed out');
      return { status: 'succeeded' };
    },
    async retrievePaymentIntent() { return { status: 'requires_capture' }; },
    async cancelPaymentIntent() { return { status: 'canceled' }; },
  };
  const cap = createReturnPassCap({ stripe, origin: 'https://example.org', dataDir, clock: () => now });
  return {
    cap, stripe, sessions, dataDir,
    setNow(value) { now = value; },
    failCapture(v) { throwCapture = v; },
    captures() { return captures; },
  };
}

test('20 concurrent checkouts cannot reserve more than EUR 6,000', async (t) => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 20 }, () => f.cap.reserve('750')));
  assert.equal(results.filter((r) => r.ok).length, 8);
  assert.equal(results.filter((r) => !r.ok && r.error === 'sold-out').length, 12);
  const s = await f.cap.status();
  assert.equal(s.allocatedEuro, 0);
  assert.equal(s.reservedEuro, 6000);
  assert.equal(s.remainingEuro, 0);
  assert.equal(s.tiers['300'], false);
});

test('all three tiers spend the same account-wide capacity', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) {
    assert.equal((await f.cap.reserve('500')).ok, true);
  }
  assert.equal((await f.cap.reserve('750')).ok, true);
  assert.equal((await f.cap.reserve('300')).ok, false);
  assert.equal((await f.cap.status()).remainingEuro, 250);
});

test('Stripe checkout uses card-only manual capture and campaign metadata', async (t) => {
  const f = await fixture(t);
  const s = await f.cap.startCheckout('300');
  assert.equal(s.ok, true);
  assert.match(s.checkoutUrl, /checkout.stripe.com/);
  const request = f.sessions[0].request;
  assert.deepEqual(request.payment_method_types, ['card']);
  assert.equal(request.payment_intent_data.capture_method, 'manual');
  assert.equal(request.metadata.campaign, RETURN_PASS_CAMPAIGN);
  assert.equal(request.line_items[0].price_data.unit_amount, 30000);
});

test('payment captured once, recorded once; replay is safe', async (t) => {
  const f = await fixture(t);
  await f.cap.startCheckout('500');
  const session = f.sessions[0].session;
  assert.equal((await f.cap.completed(session)).captured, true);
  assert.equal((await f.cap.completed(session)).repeated, true);
  assert.equal(f.captures(), 1);
  const s = await f.cap.status();
  assert.equal(s.allocatedEuro, 500);
  assert.equal(s.reservedEuro, 0);
});

test('capture uncertainty holds capacity fail-closed, even across restart', async (t) => {
  const f = await fixture(t);
  f.failCapture(true);
  await f.cap.startCheckout('750');
  const session = f.sessions[0].session;
  await assert.rejects(f.cap.completed(session), /capture timed out/);
  const restarted = createReturnPassCap({
    stripe: f.stripe, origin: 'https://example.org',
    dataDir: f.dataDir, clock: () => Date.parse('2026-10-09T12:02:00+02:00'),
  });
  assert.equal((await restarted.status()).allocatedEuro, 750);
  f.failCapture(false);
  await restarted.completed(session);
  assert.equal((await restarted.status()).allocatedEuro, 750);
});

test('expired incomplete checkout releases capacity, never an already paid one', async (t) => {
  const f = await fixture(t);
  await f.cap.startCheckout('750');
  const session = f.sessions[0].session;
  assert.equal((await f.cap.status()).reservedEuro, 750);
  await f.cap.expired(session);
  assert.equal((await f.cap.status()).reservedEuro, 0);
  await f.cap.startCheckout('300');
  const paidSession = f.sessions[1].session;
  await f.cap.completed(paidSession);
  await f.cap.expired(paidSession);
  assert.equal((await f.cap.status()).allocatedEuro, 300);
});

test('promotion refuses new sales after 16 October, existing ledger remains', async (t) => {
  const f = await fixture(t);
  await f.cap.reserve('300');
  f.setNow(Date.parse('2026-10-17T00:01:00+02:00'));
  assert.equal((await f.cap.reserve('500')).error, 'promotion-ended');
  assert.equal((await f.cap.status()).active, false);
});

test('corrupted ledger fails closed rather than resetting to zero', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.dataDir, 'return-pass-cap-2026-10.json'), '{not json');
  await assert.rejects(f.cap.reserve('300'));
});
