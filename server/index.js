#!/usr/bin/env node
/**
 * Boot.
 *
 * Serves the guide and the commerce API from one origin:
 *   node server/index.js
 *
 * With no Stripe key it runs the built-in mock checkout, so the whole purchase
 * works end to end without an account and without money moving.
 */

import { createApp } from './app.js';
import { config, configWarnings } from './config.js';

const app = await createApp();

app.listen(config.port);

console.log(`\n  LunArt — Guest Guide & Commerce`);
console.log(`  ${config.publicUrl}`);
console.log(`  payments: ${app.stripe.mode}${app.stripe.mode === 'mock' ? ' (no money moves)' : config.stripe.testMode ? ' (test keys)' : ' (LIVE KEYS)'}`);
console.log(`  prices:   ${config.allowPlaceholderPrices ? 'placeholders allowed' : 'confirmed only'}${config.useDevPrices ? ' + preview fixtures' : ''}`);

/**
 * The clock-driven work: reading the mailbox, sending what is due, reconciling the
 * calendars, retiring finished stays. Each interval only runs when its own
 * configuration exists, so an unconfigured server does nothing on a timer and says
 * so in the lines above.
 */
const minutes = (value) => Math.max(1, Number(value)) * 60_000;

if (config.mailboxPollMinutes > 0 || config.deliveryPollMinutes > 0 || config.icalPollMinutes > 0) {
  const every = Math.min(
    ...[config.mailboxPollMinutes, config.deliveryPollMinutes, config.icalPollMinutes].filter((n) => n > 0),
  );
  setInterval(() => {
    app.runScheduledWork().catch((error) => console.error('[schedule]', error.message));
  }, minutes(every)).unref?.();
  console.log(`  schedule: every ${every} min (mailbox ${config.mailboxPollMinutes || 'off'}, email ${config.deliveryPollMinutes || 'off'}, ical ${config.icalPollMinutes || 'off'})`);
}

console.log(`  reservations: ${app.mailbox ? `${app.mailbox.id}${app.mailbox.configured ? '' : ' (not configured)'}` : 'no mailbox'}`);
console.log(`  guest email: ${app.mailer.id}${app.mailer.configured ? '' : ' (nothing is sent)'}`);
console.log(`  staff push: ${app.push.configured ? 'configured' : 'not configured'}`);
console.log(`  staff app:  ${config.publicUrl}/staff`);

if (app.previewSeed?.links?.length) {
  console.log('\n  preview guest links (invented reservations):');
  for (const entry of app.previewSeed.links) {
    console.log(`    ${entry.guest} · camera ${entry.room}\n      ${entry.link}`);
  }
}

const warnings = configWarnings();
if (warnings.length > 0) {
  console.log('');
  for (const warning of warnings) console.log(`  ! ${warning}`);
}
console.log('');
