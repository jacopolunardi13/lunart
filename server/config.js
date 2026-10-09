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
 *
 * And one more, for the shared preview: `LUNART_PREVIEW` is a one-way switch into
 * demonstration mode. It does not merely default things to safe values — it ignores
 * the dangerous ones outright. Paste a live Stripe key, a Gmail refresh token or a
 * calendar service account into a preview host by mistake and none of them is read.
 * A demo nobody can accidentally charge a card from is worth more than the
 * flexibility of a demo that could.
 */

import { randomBytes } from 'node:crypto';
import { parseFeedConfig } from './ingest/ical.js';

const bool = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const env = process.env;
const mode = env.NODE_ENV === 'production' ? 'production' : 'development';

/**
 * Demonstration mode: real server, real flows, nothing that reaches anybody.
 *
 * Everything below reads `preview` rather than the environment directly wherever a
 * credential could do something irreversible.
 */
const preview = bool(env.LUNART_PREVIEW, false);
/** In preview, a credential is not merely unused — it is never read. */
const unlessPreview = (value) => (preview ? '' : (value ?? ''));

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
  preview,
  /**
   * Where the guide answers.
   *
   * `RENDER_EXTERNAL_URL` is set by the host, so a preview service knows its own
   * address without anybody typing it in — which matters because the personal guide
   * links are built from it.
   */
  publicUrl: [env.PUBLIC_URL, env.RENDER_EXTERNAL_URL, `http://localhost:${Number(env.PORT ?? 4173)}`]
    // An empty variable is a variable nobody set, whatever the host thinks.
    .map((value) => String(value ?? '').trim())
    .find(Boolean)
    .replace(/\/$/, ''),

  stripe: {
    // Empty in preview whatever the host holds: no key, no charge, the built-in
    // stand-in instead.
    secretKey: unlessPreview(env.STRIPE_SECRET_KEY),
    publishableKey: unlessPreview(env.STRIPE_PUBLISHABLE_KEY),
    webhookSecret: unlessPreview(env.STRIPE_WEBHOOK_SECRET),
    apiVersion: env.STRIPE_API_VERSION ?? '2024-06-20',
    /** With no secret key the server runs its own checkout stand-in. */
    get enabled() { return Boolean(this.secretKey); },
    get testMode() { return this.secretKey.startsWith('sk_test_'); },
  },

  /** Sell things whose price is a placeholder. Off unless explicitly enabled. */
  allowPlaceholderPrices: preview || bool(env.ALLOW_PLACEHOLDER_PRICES, false),
  /** Fill the unpriced products with obviously-fake values so the flow is walkable. */
  useDevPrices: preview || bool(env.LUNART_DEV_PRICES, false),

  cardSigningKey,
  ephemeralCardKey,
  /** How long one Privilege Card code stays valid, in seconds. */
  cardCodePeriodSeconds: Number(env.CARD_CODE_PERIOD_SECONDS ?? 60),
  /** How many past periods a scan still accepts, for clock drift and typing time. */
  cardCodeGrace: Number(env.CARD_CODE_GRACE ?? 1),

  /** Where the file-backed store writes. Empty keeps everything in memory. */
  dataDir: env.LUNART_DATA_DIR ?? '',

  staffToken: env.STAFF_TOKEN ?? '',

  /**
   * The shared Staff console (one app for LunArt and Bella Vigna). All optional:
   * with none of these set, nothing changes.
   *
   * `serviceToken` is the credential the console — and only the console — uses on
   * this Staff API; it works alongside STAFF_TOKEN, so the switch happens without
   * stopping anybody. Once every person works from the console, STAFF_TOKEN_RETIRED
   * turns the shared token off and `/staff` sends people to the console instead.
   * `relayUrl`/`relaySecret` make every staff notification go to the console as
   * well, which pushes it to the phones of the people who work here.
   */
  console: {
    serviceToken: env.CONSOLE_SERVICE_TOKEN ?? '',
    url: String(env.CONSOLE_URL ?? '').trim().replace(/\/+$/, ''),
    relayUrl: String(env.CONSOLE_RELAY_URL ?? env.CONSOLE_URL ?? '').trim().replace(/\/+$/, ''),
    relaySecret: env.CONSOLE_RELAY_SECRET ?? '',
  },
  staffTokenRetired: bool(env.STAFF_TOKEN_RETIRED, false),

  /* ── Reservations ──────────────────────────────────────────────────────── */

  /** Which mailbox the QuoVai notifications are read from. Empty means none. */
  // A preview never reads a mailbox: no credentials, and the source is forced to
  // the in-memory one so the Staff app's button has something harmless to do.
  mailboxSource: preview ? 'memory' : (env.RESERVATION_MAILBOX ?? ''),
  gmailClientId: unlessPreview(env.GMAIL_CLIENT_ID),
  gmailClientSecret: unlessPreview(env.GMAIL_CLIENT_SECRET),
  gmailRefreshToken: unlessPreview(env.GMAIL_REFRESH_TOKEN),
  gmailQuery: env.GMAIL_QUERY ?? '',
  /** Label applied to a notification once it has been ingested. Optional. */
  gmailProcessedLabelId: env.GMAIL_PROCESSED_LABEL_ID ?? '',
  /** A ceiling per poll, so a first run against a full inbox cannot take all morning. */
  gmailMaxMessages: Number(env.GMAIL_MAX_MESSAGES ?? 50),
  /** How often to read it, in minutes. Zero turns polling off. */
  mailboxPollMinutes: Number(env.RESERVATION_POLL_MINUTES ?? 0),

  /** QuoVai's API or webhook, if it ever exists. */
  quovaiApiBase: unlessPreview(env.QUOVAI_API_BASE),
  quovaiApiKey: unlessPreview(env.QUOVAI_API_KEY),
  quovaiWebhookSecret: unlessPreview(env.QUOVAI_WEBHOOK_SECRET),

  /** `303:https://…ics,305:https://…ics` or a bare list of URLs. */
  icalFeeds: parseFeedConfig(unlessPreview(env.QUOVAI_ICAL_FEEDS)),
  icalPollMinutes: Number(env.ICAL_POLL_MINUTES ?? 0),

  /** How the guest email actually leaves. Empty means nothing is sent. */
  // Nothing leaves a preview: the mailer stays the simulated one, which renders the
  // email and keeps the body.
  mailProvider: unlessPreview(env.MAIL_PROVIDER),
  mailFrom: env.MAIL_FROM ?? 'lunartfirenze@gmail.com',
  mailReplyTo: env.MAIL_REPLY_TO ?? '',
  /** Zero turns the send loop off; the schedule is still written. */
  deliveryPollMinutes: Number(env.DELIVERY_POLL_MINUTES ?? 0),

  /* ── Staff notifications ───────────────────────────────────────────────── */

  vapidPublicKey: unlessPreview(env.VAPID_PUBLIC_KEY),
  vapidPrivateKey: unlessPreview(env.VAPID_PRIVATE_KEY),
  vapidSubject: unlessPreview(env.VAPID_SUBJECT),

  /* ── The hair professional's calendar ──────────────────────────────────── */

  providerCalendar: env.PROVIDER_CALENDAR ?? 'google-calendar',
  googleCalendarId: unlessPreview(env.GOOGLE_CALENDAR_ID),
  googleCalendarWriteId: unlessPreview(env.GOOGLE_CALENDAR_WRITE_ID),
  googleServiceAccountEmail: unlessPreview(env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
  googleServiceAccountKey: unlessPreview(env.GOOGLE_SERVICE_ACCOUNT_KEY),
  /** Only for a Workspace domain with delegation; empty for a shared calendar. */
  googleCalendarSubject: env.GOOGLE_CALENDAR_SUBJECT ?? '',
  /** How often finished stays are retired, in minutes. */
  housekeepingMinutes: Number(env.HOUSEKEEPING_MINUTES ?? 60),
};

/** Anything an operator needs to know before this is called live. */
export function configWarnings() {
  const warnings = [];
  if (config.preview) {
    warnings.push('LUNART_PREVIEW is on: demonstration mode. Payments are the built-in stand-in, no email leaves, no mailbox is read, no calendar is written, and any credentials in the environment are ignored.');
    if (!config.staffToken && !config.console.serviceToken) {
      warnings.push('A preview without STAFF_TOKEN leaves the Staff app open to anyone with the URL. Set one.');
    }
    return warnings;
  }
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
  if (config.staffTokenRetired && !config.console.serviceToken) {
    warnings.push('STAFF_TOKEN_RETIRED is on but CONSOLE_SERVICE_TOKEN is not set: nobody can reach the Staff API.');
  }
  if (!config.staffToken && !config.console.serviceToken) {
    warnings.push('STAFF_TOKEN is not set: the Staff app and the provider endpoints are open to anyone who can reach them.');
  }
  if (!config.mailboxSource) {
    warnings.push('RESERVATION_MAILBOX is not set: QuoVai notifications are not being read, so reservations have to be entered by hand.');
  } else if (config.mailboxSource === 'gmail' && !(config.gmailClientId && config.gmailClientSecret && config.gmailRefreshToken)) {
    warnings.push('RESERVATION_MAILBOX=gmail but the Gmail credentials are missing: the adapter is implemented and cannot authenticate.');
  } else if (config.mailboxPollMinutes <= 0) {
    warnings.push('RESERVATION_POLL_MINUTES is 0: the mailbox is configured but nothing reads it on a timer.');
  }
  if (!config.mailProvider) {
    warnings.push('MAIL_PROVIDER is not set: guest guide emails are scheduled and rendered but never sent.');
  } else if (config.mailProvider === 'gmail' && !(config.gmailClientId && config.gmailClientSecret && config.gmailRefreshToken)) {
    warnings.push('MAIL_PROVIDER=gmail but the Gmail credentials are missing: nothing can be sent, and sends fall back to simulated.');
  } else if (config.deliveryPollMinutes <= 0) {
    warnings.push('DELIVERY_POLL_MINUTES is 0: emails are scheduled but nothing sends them on a timer.');
  }
  if (config.icalFeeds.length === 0) {
    warnings.push('QUOVAI_ICAL_FEEDS is not set: there is no calendar to reconcile against.');
  }
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    warnings.push('VAPID keys are not set: the Staff app works, but nothing is pushed to a phone.');
  }
  if (!config.googleCalendarId) {
    warnings.push('GOOGLE_CALENDAR_ID is not set: hair appointments are not written to a provider calendar and availability stays manual.');
  }
  return warnings;
}
