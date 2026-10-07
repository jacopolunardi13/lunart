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
 * Start the clock-driven work.
 *
 * Each job only runs when its own configuration says so; the scheduler reports what
 * it started, and `/api/health` reports what has happened since.
 */
const schedule = app.scheduler.start();
const live = schedule.filter((job) => job.enabled);
if (live.length > 0) {
  console.log(`  schedule: ${live.map((job) => `${job.id} every ${job.intervalMinutes}m`).join(', ')}`);
} else {
  console.log('  schedule: nothing runs on a timer (every interval is 0)');
}

console.log(`  reservations: ${app.mailbox ? `${app.mailbox.id}${app.mailbox.configured ? '' : ' (not configured)'}` : 'no mailbox'}`);
console.log(`  guest email: ${app.mailer.id}${app.mailer.configured ? '' : ' (nothing is sent)'}`);
console.log(`  staff push: ${app.push.configured ? 'configured' : 'not configured'}`);
console.log(`  staff app:  ${config.publicUrl}/staff`);

if (app.previewSeed?.links?.length) {
  console.log('\n  preview guest links (invented reservations):');
  for (const entry of app.previewSeed.links) {
    console.log(`    ${entry.guest} · camer${entry.rooms > 1 ? 'e' : 'a'} ${entry.room}\n      ${entry.link}`);
  }
}

const warnings = configWarnings();
if (warnings.length > 0) {
  console.log('');
  for (const warning of warnings) console.log(`  ! ${warning}`);
}
console.log('');
