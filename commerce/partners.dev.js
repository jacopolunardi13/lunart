/**
 * Preview-only partners.
 *
 * Production ships with no card partner, so the Privilege Card is not on sale —
 * there is nothing yet that the card, specifically, gets you. The preview needs
 * one to walk the flow through, so it activates a single obviously-fake venue
 * whose name says exactly that.
 *
 * Loaded only by a server started with LUNART_DEV_PRICES.
 */

import { PARTNERS } from './partners.js';

export function devPartners() {
  return PARTNERS.map((partner) => (
    partner.partner_id === 'example-bar'
      ? {
        ...partner,
        active: true,
        name: 'Esempio — bar (demo)',
        area: { it: 'Partner di esempio, solo in preview', en: 'Example partner, preview only' },
        benefit: {
          ...partner.benefit,
          conditions: {
            it: 'Partner fittizio, presente solo nella preview per provare il flusso della card.',
            en: 'A made-up partner, present only in the preview so the card flow can be tried.',
          },
        },
      }
      : partner
  ));
}
