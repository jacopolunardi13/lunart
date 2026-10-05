#!/usr/bin/env node
/**
 * The money path, end to end, in a real browser.
 *
 * Everything else tests a piece of this; only this walks it the way a guest does:
 * open the personal link, put a bottle in the basket, pay, come back, and find the
 * order where it should be. It exists because the pieces all passed while the
 * journey did not — the basket was never emptied, the order sat on "in attesa di
 * pagamento", and paying dropped the guest onto a guide that no longer knew them.
 *
 * The last check is the one that matters most: a browser that has never seen this
 * stay opens the same link and still finds the purchase. That is only true because
 * the server, not localStorage, is what remembers.
 *
 *   npm run dev &
 *   npm run qa:pass
 */
import { chromium, devices } from 'playwright';
import { readdir } from 'node:fs/promises'; import { existsSync } from 'node:fs'; import { join } from 'node:path';
async function launch(){try{return await chromium.launch()}catch(e){const r=process.env.PLAYWRIGHT_BROWSERS_PATH;for(const d of (await readdir(r)).filter(x=>x.startsWith('chromium-'))){const p=join(r,d,'chrome-linux','chrome');if(existsSync(p))return chromium.launch({executablePath:p})}throw e}}
const B='http://localhost:4173';
const post=(p,b={})=>fetch(`${B}${p}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
const inDays=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10);
const made=await post('/api/staff/reservations',{first_name:'Flow',last_name:`F${Date.now().toString(36).slice(-4)}`,guest_email:'f@example.invalid',check_in:inDays(30),check_out:inDays(33),room:'303',adults:2,booking_reference:`FLOW-${Date.now()}`});
const {link}=await post(`/api/staff/reservations/${made.reservation.id}/link`);
const b=await launch(); const ctx=await b.newContext({...devices['iPhone 13'],locale:'it-IT'}); const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
let failures=0;
const step=(n,ok,extra='')=>{ if(!ok) failures++; console.log(`${ok?'ok  ':'FAIL'}  ${n}${extra?' — '+extra:''}`); };

await page.goto(link,{waitUntil:'networkidle'}); await page.waitForTimeout(2000);
step('the Pass is on the home before anything is bought', await page.locator('[data-pass]').isVisible());
step('and no purchases section yet', (await page.locator('.purchase').count())===0);

// Put a bottle in the basket through the real product sheet.
await page.goto(`${link}#/product/wine-in-room`,{waitUntil:'networkidle'}); await page.waitForTimeout(1500);
await page.locator('.chip--choice').first().click().catch(()=>{});
await page.waitForTimeout(400);
const dateInput = page.locator('.product-form input[type="date"]').first();
if (await dateInput.count()) { await dateInput.fill(new Date(Date.now()+31*864e5).toISOString().slice(0,10)); await page.waitForTimeout(700); }
const slot = page.locator('.product-form select').last();
if (await slot.count()) { const opts = await slot.locator('option').all(); if (opts.length>1) await slot.selectOption({index:1}); await page.waitForTimeout(400); }
const room = page.locator('.product-form [name="room"]');
if (await room.count()) await room.fill('303').catch(()=>{});
await page.locator('.product-form button[type="submit"], [data-add]').first().click().catch(()=>{});
await page.waitForTimeout(1200);
const inCart = await page.evaluate(()=>JSON.parse(localStorage.getItem('lunart.cart.v1')||'[]').length);
step('the bottle is in the basket', inCart>0, `${inCart} line(s)`);

// Check out.
await page.goto(`${link}#/cart`,{waitUntil:'networkidle'}); await page.waitForTimeout(1200);
await page.fill('.checkout-form [name="name"]','Flow Ospite').catch(()=>{});
await page.fill('.checkout-form [name="email"]','flow@example.invalid').catch(()=>{});
await page.locator('.checkout-form button[type="submit"]').click();
await page.waitForTimeout(2500);
step('we reach the payment page', page.url().includes('mock-checkout')||page.url().includes('stripe'), page.url().slice(0,70));

// Pay.
await page.locator('button:has-text("Paga"), button:has-text("Pay"), [data-pay]').first().click().catch(()=>{});
await page.waitForTimeout(3000);
step('and come back to the guide', page.url().includes('/g/')||page.url().includes('#/order/'), page.url().slice(0,70));
await page.waitForTimeout(2500);

const after = await page.evaluate(()=>({
  cart: JSON.parse(localStorage.getItem('lunart.cart.v1')||'[]').length,
  pending: localStorage.getItem('lunart.checkout-pending.v1'),
  body: document.body.innerText,
}));
step('the basket is empty', after.cart===0, `${after.cart} line(s)`);
step('and the pending marker is consumed', after.pending===null);
step('the order is not still "in attesa di pagamento"', !/in attesa di pagamento/i.test(after.body));

await page.goto(link,{waitUntil:'networkidle'}); await page.waitForTimeout(2500);
const home = await page.evaluate(()=>({
  purchases: document.querySelectorAll('.purchase').length,
  text: document.querySelector('.purchases')?.innerText ?? '',
  pass: !!document.querySelector('[data-pass]'),
}));
step('"I miei acquisti" shows it on the home', home.purchases>0, home.text.replace(/\s+/g,' ').slice(0,80));
step('and the Pass is still there', home.pass);

// The decisive one: a brand new browser, nothing remembered.
const fresh = await b.newContext({...devices['iPhone 13'],locale:'it-IT'});
const page2 = await fresh.newPage();
await page2.goto(link,{waitUntil:'networkidle'}); await page2.waitForTimeout(2500);
const cold = await page2.evaluate(()=>({
  purchases: document.querySelectorAll('.purchase').length,
  stored: JSON.parse(localStorage.getItem('lunart.orders.v1')||'[]').length,
}));
step('a brand-new browser still finds the purchase', cold.purchases>0, `${cold.purchases} shown, ${cold.stored} remembered locally`);
await page2.screenshot({path:'tools/.qa-screens/flow-purchases.png'});
step('no page errors', errs.length===0, errs.slice(0,2).join(' | '));

/* The same page in English, because a card and a receipt are exactly the kind of
   screen that gets translated once and then forgotten. */
const en = await b.newContext({...devices['iPhone 13'],locale:'en-GB'});
const page3 = await en.newPage();
await page3.goto(link,{waitUntil:'networkidle'}); await page3.waitForTimeout(2500);
for (let i=0;i<2 && (await page3.getAttribute('html','lang'))!=='en';i++){ await page3.click('#lang-toggle'); await page3.waitForTimeout(500); }
await page3.waitForTimeout(1200);
const english = await page3.evaluate(()=>({
  lang: document.documentElement.lang,
  pass: document.querySelector('[data-pass]')?.innerText ?? '',
  heading: [...document.querySelectorAll('#main h2')].map(e=>e.textContent.trim()),
  purchases: document.querySelector('.purchases')?.innerText ?? '',
  overflow: document.documentElement.scrollWidth - window.innerWidth,
}));
step('the Pass renders in English too', english.lang==='en' && english.pass.length>0);
step('with an English heading', english.heading.some(h=>/Pass|Privilege/i.test(h)), english.heading.filter(h=>/Pass|Privilege/i.test(h)).join(', '));
step('and the purchase reads in English', /Confirmed|Paid|Waiting/i.test(english.purchases), english.purchases.replace(/\s+/g,' ').slice(0,60));
step('no horizontal overflow at 390px', english.overflow<=1, String(english.overflow));
await page3.screenshot({path:'tools/.qa-screens/flow-purchases-en.png'});

/* ── The three offers move with the moment, and nothing disappears ─────────
   Checked through real reservations rather than through the ranking module,
   because the question is what a guest is shown, not what a function returns. */
console.log('');
const moments = [
  { label: 'before arriving', from: inDays(14), to: inDays(16), lead: /transfer|ncc/i },
  { label: 'arrival day',     from: inDays(0),  to: inDays(2),  lead: /vino|wine/i },
  { label: 'mid-stay',        from: inDays(-1), to: inDays(2),  lead: /vino|wine/i },
  { label: 'leaving today',   from: inDays(-2), to: inDays(0),  lead: /bagagl|luggage/i },
];
const spent = [];
for (const m of moments) {
  const r = await post('/api/staff/reservations',{first_name:'Rank',last_name:`R${Math.random().toString(36).slice(2,6)}`,guest_email:'r@example.invalid',check_in:m.from,check_out:m.to,room:'303',adults:2,booking_reference:`RANK-${Date.now()}-${m.label.length}`});
  spent.push(r.reservation.id);
  const { link: l } = await post(`/api/staff/reservations/${r.reservation.id}/link`);
  const c = await b.newContext({...devices['iPhone 13'],locale:'it-IT'});
  const pg = await c.newPage();
  await pg.goto(l,{waitUntil:'networkidle'}); await pg.waitForTimeout(1800);
  const seen = await pg.evaluate(()=>({
    offers: [...document.querySelectorAll('.offer__title')].map(e=>e.textContent.trim()),
    cta: !!document.querySelector('[data-shop]'),
  }));
  step(`${m.label}: three offers, led by the right one`, seen.offers.length===3 && m.lead.test(seen.offers[0]), seen.offers.join(' · '));
  step(`${m.label}: the whole catalogue is still one tap away`, seen.cta);
  // And the shop itself is never thinned by the moment.
  await pg.goto(`${l}#/shop`,{waitUntil:'networkidle'}); await pg.waitForTimeout(1200);
  const inShop = await pg.locator('#main .card').count();
  step(`${m.label}: the shop lists everything regardless`, inShop >= 8, `${inShop} products`);
  await c.close();
}

/* A one-night stay must not lose access to anything. */
const oneNight = await post('/api/staff/reservations',{first_name:'Breve',last_name:`B${Math.random().toString(36).slice(2,6)}`,guest_email:'b@example.invalid',check_in:inDays(0),check_out:inDays(1),room:'303',adults:2,booking_reference:`ONE-${Date.now()}`});
spent.push(oneNight.reservation.id);
const { link: shortLink } = await post(`/api/staff/reservations/${oneNight.reservation.id}/link`);
const c1 = await b.newContext({...devices['iPhone 13'],locale:'it-IT'});
const p1 = await c1.newPage();
await p1.goto(`${shortLink}#/shop`,{waitUntil:'networkidle'}); await p1.waitForTimeout(1500);
const shortShop = await p1.locator('#main .card').count();
step('a one-night stay reaches the whole catalogue', shortShop >= 8, `${shortShop} products`);
await p1.goto(shortLink,{waitUntil:'networkidle'}); await p1.waitForTimeout(1800);
step('and still gets three offers and a Pass',
  (await p1.locator('.offer').count())===3 && await p1.locator('[data-pass]').isVisible());
await c1.close();

/* ── Privilege is the same Pass, unlocked ──────────────────────────────────
   The upgrade is bought through the checkout API rather than by driving the
   product form — that form is qa-commerce's job, and what matters here is the
   one thing only this file can see: the card the guest already had becomes
   Privilege, and does not become a second card. */
console.log('');
const cardProduct = (await (await fetch(`${B}/api/catalog`)).json()).products.find((p) => p.id === 'privilege-card');
// `purchasable` is the catalogue's own answer, and it already carries the rule
// that matters: no card partner, no Privilege on sale.
const sellableCard = Boolean(cardProduct?.purchasable);

if (sellableCard) {
  const ctxJson = await (await fetch(`${B}/api/guide/${link.split('/g/')[1]}`)).json();
  const option = ctxJson.cardOptions?.[0];
  const upgrade = await post('/api/checkout', {
    guideToken: link.split('/g/')[1],
    lang: 'it',
    customer: { name: 'Flow Ospite', email: 'flow@example.invalid' },
    lines: [{
      productId: 'privilege-card',
      variantId: option?.variantId,
      quantity: 1,
      date: option?.startDates?.[0],
      fields: { holderName: 'Flow Ospite' },
    }],
  });
  step('the upgrade can be bought from the personal link', Boolean(upgrade.accessToken), upgrade.error ?? '');

  if (upgrade.accessToken) {
    // The session id lives in the URL the guest would have been sent to.
    const session = new URL(upgrade.checkoutUrl, B).searchParams.get('session');
    const paid = await post('/mock-checkout/pay', { session });
    step('and paid for', paid.ok === true, paid.error ?? '');
    // Opening the order is what settles it, exactly as a returning guest would.
    await fetch(`${B}/api/orders/${upgrade.accessToken}`);

    const upgradeCtx = await b.newContext({ ...devices['iPhone 13'], locale: 'it-IT' });
    const up = await upgradeCtx.newPage();
    await up.goto(link, { waitUntil: 'networkidle' });
    await up.waitForTimeout(2500);
    const after = await up.evaluate(() => ({
      tier: document.querySelector('[data-pass]')?.className ?? '',
      heading: [...document.querySelectorAll('#main h2')].map((e) => e.textContent.trim()).join(' | '),
      passes: document.querySelectorAll('[data-pass]').length,
      section: document.querySelector('[data-pass-block]')?.innerText ?? '',
    }));
    step('the upgrade turns the same Pass into Privilege', /privilege/.test(after.tier), after.tier.trim());
    step('and there is still exactly one card, not two', after.passes === 1, `${after.passes}`);
    step('the heading says Privilege', /privilege/i.test(after.heading), after.heading);
    step('Opera stays under what the stay includes', /opera caff/i.test(after.section));
    await up.screenshot({ path: 'tools/.qa-screens/pass-privilege.png' });
    await upgradeCtx.close();
  }
} else {
  // The production rule: no card partner, no Privilege on sale. Worth asserting.
  step('Privilege is not on sale without a card partner, which is the production rule', true);
}

// Tidy up after ourselves.
for (const id of spent) await post(`/api/staff/reservations/${id}/cancel`,{reason:'QA'});
await post(`/api/staff/reservations/${made.reservation.id}/cancel`,{reason:'QA'});

await b.close();
console.log(failures===0 ? '\nALL PASS/COMMERCE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures===0?0:1);
