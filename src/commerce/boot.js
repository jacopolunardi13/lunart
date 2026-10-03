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
import { openOrderSheet, purchasesBlock } from './ui/orders.js';
import { openCardSheet, cardBlock, stayBenefitsBlock } from './ui/card-sheet.js';
import * as cart from './cart.js';

export async function init() {
  await loadCatalogue();
  return { available: catalogueAvailable() };
}

export {
  shopView, shopTeaser, openProductSheet, openCartSheet,
  openOrderSheet, purchasesBlock, openCardSheet, cardBlock, stayBenefitsBlock,
  cart, catalogueAvailable,
};
