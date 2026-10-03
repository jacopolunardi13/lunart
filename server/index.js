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

const warnings = configWarnings();
if (warnings.length > 0) {
  console.log('');
  for (const warning of warnings) console.log(`  ! ${warning}`);
}
console.log('');
