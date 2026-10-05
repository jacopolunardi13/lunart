/**
 * Everything commerce, behind one dynamic import.
 *
 * The guide's first paint should not wait on the shop. A guest opening this in a
 * stairwell wants the door code, and the commerce half is a third of the
 * JavaScript — so it is fetched after the guide is already on screen, and the
 * guide re-renders once it arrives. Nothing before that moment depends on it.
 */

import { loadCatalogue, catalogueAvailable } from './api.js';
import { shopView, shopTeaser } from './ui/shop.js';
import { openProductSheet } from './ui/product-sheet.js';
import { openCartSheet } from './ui/cart-sheet.js';
import { openOrderSheet, purchasesBlock, settleCheckout } from './ui/orders.js';
import { passBlock, openPassSheet, loadPassArtwork } from './ui/pass.js';
import { featuredForGuest, momentOf } from '../../commerce/ranking.js';
import { openCardSheet, cardBlock, stayBenefitsBlock } from './ui/card-sheet.js';
import * as cart from './cart.js';

export async function init() {
  await loadCatalogue();
  // Looked for once, so the Pass wears the printed artwork the moment it exists.
  await loadPassArtwork();
  return { available: catalogueAvailable() };
}

/**
 * Settle whatever the guest went off to pay for.
 *
 * Separate from `init` because it has to run after the guest context has loaded —
 * the order it checks may well be the one that just turned the Pass into a
 * Privilege — and because a failure here must never stop the shop from working.
 */
export async function settle() {
  try {
    return await settleCheckout({ cart });
  } catch {
    return { settled: false };
  }
}

export {
  shopView, shopTeaser, openProductSheet, openCartSheet,
  openOrderSheet, purchasesBlock, openCardSheet, cardBlock, stayBenefitsBlock,
  passBlock, openPassSheet, featuredForGuest, momentOf,
  cart, catalogueAvailable,
};
