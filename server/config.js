/**
 * Configuration, all of it from the environment.
 *
 * Nothing secret is written down in this repository. The Stripe keys, the webhook
 * secret and the key the Privilege Card codes are signed with are read from the
 * environment and nowhere else; `.env.example` lists the names without the values.
 *
 * Two safety rails that matter more than they look:
 *
 *  - `allowPlaceholderPrices` is off unless asked for. A production server refuses
 *    to sell anything whose price LunArt has not confirmed.
 *  - `cardSigningKey` is generated at boot when it is missing, which is fine for a
 *    preview and useless in production — every restart invalidates every card — so
 *    production logs a loud warning and refuses to pretend otherwise.
 */

import { randomBytes } from 'node:crypto';

const bool = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const env = process.env;
const mode = env.NODE_ENV === 'production' ? 'production' : 'development';

let cardSigningKey = env.CARD_SIGNING_KEY ?? '';
let ephemeralCardKey = false;
if (!cardSigningKey) {
  cardSigningKey = randomBytes(32).toString('hex');
  ephemeralCardKey = true;
}

export const config = {
  mode,
  port: Number(env.PORT ?? 4173),
  /** Where the guide is reachable; used to build Stripe return URLs. */
  publicUrl: (env.PUBLIC_URL ?? `http://localhost:${Number(env.PORT ?? 4173)}`).replace(/\/$/, ''),

  stripe: {
    secretKey: env.STRIPE_SECRET_KEY ?? '',
    publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    apiVersion: env.STRIPE_API_VERSION ?? '2024-06-20',
    /** With no secret key the server runs its own checkout stand-in. */
    get enabled() { return Boolean(this.secretKey); },
    get testMode() { return this.secretKey.startsWith('sk_test_'); },
  },

  /** Sell things whose price is a placeholder. Off unless explicitly enabled. */
  allowPlaceholderPrices: bool(env.ALLOW_PLACEHOLDER_PRICES, false),
  /** Fill the unpriced products with obviously-fake values so the flow is walkable. */
  useDevPrices: bool(env.LUNART_DEV_PRICES, false),

  cardSigningKey,
  ephemeralCardKey,
  /** How long one Privilege Card code stays valid, in seconds. */
  cardCodePeriodSeconds: Number(env.CARD_CODE_PERIOD_SECONDS ?? 60),
  /** How many past periods a scan still accepts, for clock drift and typing time. */
  cardCodeGrace: Number(env.CARD_CODE_GRACE ?? 1),

  /** Where the file-backed store writes. Empty keeps everything in memory. */
  dataDir: env.LUNART_DATA_DIR ?? '',

  staffToken: env.STAFF_TOKEN ?? '',
};

/** Anything an operator needs to know before this is called live. */
export function configWarnings() {
  const warnings = [];
  if (!config.stripe.enabled) {
    warnings.push('STRIPE_SECRET_KEY is not set: checkout runs against the built-in mock, no money moves.');
  } else if (!config.stripe.testMode && config.mode !== 'production') {
    warnings.push('A live Stripe key is in use outside production. That will take real money.');
  }
  if (config.stripe.enabled && !config.stripe.webhookSecret) {
    warnings.push('STRIPE_WEBHOOK_SECRET is not set: incoming webhooks cannot be verified and will be refused.');
  }
  if (config.ephemeralCardKey) {
    warnings.push('CARD_SIGNING_KEY is not set: a random key was generated, so every restart invalidates every card.');
  }
  if (config.allowPlaceholderPrices && config.mode === 'production') {
    warnings.push('ALLOW_PLACEHOLDER_PRICES is on in production: unconfirmed prices can be charged.');
  }
  if (!config.staffToken) {
    warnings.push('STAFF_TOKEN is not set: the provider confirm/decline endpoints are open to anyone who can reach them.');
  }
  return warnings;
}
