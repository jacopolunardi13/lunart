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

/* ── The card has to look like a card ──────────────────────────────────────
   The artwork used to be set through an inline custom property, which resolves a
   relative url() against the stylesheet rather than the element — so it silently
   fetched the wrong path, this server answered it with HTML and a 200, and the
   card drew an empty layer for weeks. Checking the CSS is not enough: this checks
   that the bytes arrived and that they were an image. */
const plate = await page.evaluate(async () => {
  const el = document.querySelector('[data-pass]');
  const url = getComputedStyle(el, '::before').backgroundImage.match(/url\("([^"]+)"/)?.[1];
  if (!url) return { url: null };
  const res = await fetch(url);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob).catch(() => null);
  return { url, status: res.status, type: res.headers.get('content-type'), w: bitmap?.width ?? 0 };
});
step('the Pass has a plate behind it', Boolean(plate.url), plate.url ?? 'no background-image');
/**
 * And it says whose card it is.
 *
 * The painting that preceded this one had the LA lock-up at its centre, so the card
 * deliberately did not repeat it. "Il movimento e la stratificazione di Firenze" is
 * an abstract and carries no mark, so without this the card is a beautiful rectangle
 * with a stranger's name on it.
 */
const mark = await page.evaluate(() => {
  const img = document.querySelector('[data-pass] .pass__mark');
  return img ? { src: img.getAttribute('src'), decoded: img.naturalWidth > 0 } : null;
});
step('and the LunArt mark on it', mark?.decoded === true, mark?.src ?? 'absent');
/** Whatever the artwork is, every other card face has to be wearing the same one. */
const STANDARD_PLATE = plate.url?.match(/[^/]+\.webp/)?.[0] ?? '';
step('and the plate is a real image, not the server’s fallback page',
  plate.w > 0 && /image\//.test(plate.type ?? ''), `${plate.status} ${plate.type} ${plate.w}px`);

/* ── Tapping it opens something useful ─────────────────────────────────── */
await page.locator('[data-pass]').click();
await page.waitForTimeout(900);
const sheet = await page.evaluate(() => ({
  open: Boolean(document.querySelector('.sheet[data-open="true"]')),
  title: document.querySelector('.sheet__title')?.textContent.trim() ?? '',
  facts: [...document.querySelectorAll('.pass-facts__row')].map((r) => r.innerText.replace(/\s+/g,' ').trim()),
  cardInSheet: document.querySelectorAll('.sheet [data-pass]').length,
  benefits: document.querySelectorAll('.sheet .benefit').length,
  partners: document.querySelectorAll('.sheet .partner').length,
  labels: [...document.querySelectorAll('.sheet .pass__label')].map((e) => e.textContent.trim()),
  locked: document.querySelectorAll('.sheet .partner[data-access="locked"]').length,
  available: document.querySelectorAll('.sheet .partner[data-access="available"]').length,
  headlines: [...document.querySelectorAll('.sheet .benefit__headline')].map((e) => e.textContent.trim()),
  text: document.querySelector('.sheet')?.innerText ?? '',
  hash: location.hash,
}));
step('tapping the Pass opens a view of its own', sheet.open && sheet.cardInSheet===1, sheet.title);
step('it names the holder, the room and the validity',
  sheet.facts.length>=3 && /305|30\d/.test(sheet.facts.join(' ')), sheet.facts.join(' · ').slice(0,90));
step('and lists what the Pass is good for', sheet.benefits>0, `${sheet.benefits}`);
step('with a URL the back button can close', sheet.hash==='#/pass', sheet.hash);

/* ── What a standard-Pass guest sees of Privilege ──────────────────────────
   This guest has not upgraded. The benefits reserved for Privilege are real and
   are not theirs, and the thing being checked is that they can still be found:
   shown, dimmed, named as an upgrade, with the ordinary product sheet as the way
   to get them. Hiding them would make the Privilege tile in the shop an
   abstraction, and nobody buys an abstraction.

   On its own reservation, because the one above arrives in a month: a Pass that
   has not started is correctly "nothing is claimable yet", which is a different
   screen and is checked further down. The guest who needs to discover Privilege is
   the one standing in Florence tonight. */
step('the Pass sheet separates what comes with the stay from what Privilege adds',
  sheet.labels.length===2, sheet.labels.join(' | '));
step('a Pass that has not started yet offers nothing as claimable today',
  sheet.locked===0 && sheet.available===0, `${sheet.locked} locked, ${sheet.available} available`);
step('the benefit is what the eye lands on, not the venue',
  ['10% di sconto','€15 MAX + DRINK','20% OFF'].every((h)=>sheet.headlines.includes(h)),
  sheet.headlines.join(' · '));
step('Blue Velvet is one venue with two benefits', sheet.partners===3 && sheet.benefits===4,
  `${sheet.partners} venues, ${sheet.benefits} benefits`);
step('the "show your card" sentence is said once for the section, not per venue',
  (sheet.text.match(/Mostra la tua LunArt Privilege/g)??[]).length<=1);
await page.screenshot({path:'tools/.qa-screens/pass-sheet.png'});

console.log('');
const today = await post('/api/staff/reservations',{first_name:'Live',last_name:`L${Date.now().toString(36).slice(-4)}`,guest_email:'l@example.invalid',check_in:inDays(0),check_out:inDays(2),room:'304',adults:2,booking_reference:`LIVE-${Date.now()}`});
const liveLink = (await post(`/api/staff/reservations/${today.reservation.id}/link`)).link;

/**
 * Open `#/pass` at a given width and read the partner blocks out of it.
 *
 * Its own context each time, in Italian, because the copy under test is Italian and
 * a desktop default would read the English strings. The link is opened first and the
 * hash set afterwards: navigating straight to `#/pass` races the guest context, and
 * a route that finds no Pass correctly rewrites itself back to the guide.
 */
async function passSheetAt(width, url = liveLink) {
  const probeCtx = await b.newContext({ viewport: { width, height: 900 }, locale: 'it-IT', deviceScaleFactor: 2 });
  const probe = await probeCtx.newPage();
  probe.once('close', () => probeCtx.close().catch(() => {}));
  await probe.goto(url, { waitUntil: 'networkidle' });
  await probe.waitForSelector('[data-pass]', { timeout: 15000 });
  await probe.waitForTimeout(1200);
  await probe.evaluate(() => { location.hash = '#/pass'; });
  await probe.waitForSelector('.sheet .partner', { timeout: 15000 });
  await probe.waitForTimeout(400);
  const read = await probe.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    const cards = [...sheet.querySelectorAll('.partner')];
    const room = (sheet.querySelector('.sheet__body') ?? sheet).getBoundingClientRect();
    const labels = [...sheet.querySelectorAll('.pass__label')].map((e) => e.textContent.trim());
    // Everything between the Privilege *benefits* heading and the next one is its
    // section. By its own hook, not by matching "privilege" — the card section's
    // heading says Privilege too.
    const head = sheet.querySelector('.pass__label[data-section="privilege-benefits"]');
    const section = [];
    for (let n = head?.nextElementSibling; n && !n.classList.contains('pass__label'); n = n.nextElementSibling) section.push(n);
    const inSection = (sel) => section.flatMap((n) => [...n.querySelectorAll(sel)]);
    return {
      labels,
      state: document.querySelector('[data-pass]')?.dataset.state ?? '',
      partners: cards.length,
      benefits: sheet.querySelectorAll('.benefit').length,
      locked: sheet.querySelectorAll('.partner[data-access="locked"]').length,
      available: sheet.querySelectorAll('.partner[data-access="available"]').length,
      unavailable: sheet.querySelectorAll('.partner[data-access="unavailable"]').length,
      lockWords: [...sheet.querySelectorAll('.partner__lock')].map((e) => e.textContent.trim()),
      buy: sheet.querySelectorAll('[data-product="privilege-card"]').length,
      lead: sheet.querySelector('[data-privilege-lead]')?.textContent.trim() ?? '',
      cardLabel: labels.find((l) => /privilege card/i.test(l)) ?? '',
      cardLine: sheet.querySelector('[data-card-state]')?.textContent.trim() ?? '',
      cardState: sheet.querySelector('[data-card-state]')?.dataset.cardState ?? '',
      cardAction: sheet.querySelector('[data-card]')?.innerText.trim() ?? '',
      cardActions: sheet.querySelectorAll('[data-card]').length,
      headlines: [...sheet.querySelectorAll('.benefit__headline')].map((e) => e.textContent.trim()),
      privilegeVenues: inSection('.partner').length,
      privilegeText: section.map((n) => n.innerText).join(' '),
      directions: inSection('.partner__directions').map((a) => a.getAttribute('href')),
      overflowing: cards.filter((c) => c.getBoundingClientRect().right > room.right + 1).length,
      clipped: [...sheet.querySelectorAll('.benefit__headline, .partner__meta, .partner__lock')]
        .filter((e) => e.scrollWidth > e.clientWidth + 1).length,
      pageScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      text: sheet.innerText,
    };
  });
  return { probe, read };
}

/* ── A guest whose stay has not started ────────────────────────────────────
   The screen Irene actually had. Checked before the upgrade and after it, because
   the reported bug was that the two looked the same. */
{
  const { probe, read } = await passSheetAt(390, link);
  step('before arrival a standard Pass has no card section', read.cardActions===0 && !read.cardLabel,
    read.cardLabel || 'none');
  step('and the Privilege partners are still offered, marked as an upgrade',
    read.lockWords.length===2 && read.unavailable===3,
    `${read.lockWords.length} marked, ${read.unavailable} not usable yet`);
  step('with the purchase reachable before arrival, not only on the day',
    read.buy===1, `${read.buy} button(s)`);
  await probe.close();
}

{
  const { probe, read } = await passSheetAt(390);
  step('a guest in-house has an active Pass', read.state==='active', read.state);
  step('what comes with the stay is usable with no upgrade at all', read.available>=1,
    `${read.available} available`);
  step('and the Privilege partners are still discovered, locked', read.locked===2,
    `${read.locked} locked, ${read.unavailable} unavailable`);
  step('each one marked as an upgrade rather than removed',
    read.lockWords.length===2 && read.lockWords.every((w)=>/Disponibile con LunArt Privilege/.test(w)),
    read.lockWords.join(' | '));
  step('with one line saying what Privilege is, instead of a pitch per venue',
    /si sbloccano con LunArt Privilege/.test(read.lead), read.lead.slice(0,64));
  step('and the way to get it is the ordinary product sheet, not a second checkout',
    read.buy===1, `${read.buy} button(s)`);
  step('a standard guest keeps the stay first and Privilege under it',
    /soggiorno/i.test(read.labels[0]??''), read.labels.join(' | '));
  step('Opera Caffè is never drawn inside the Privilege section',
    read.privilegeVenues===2 && !/opera/i.test(read.privilegeText),
    `${read.privilegeVenues} venues under Privilege`);
  step('each Privilege venue has one set of directions, built from its address',
    read.directions.length===2
      && new Set(read.directions).size===2
      && read.directions.every((h)=>h.startsWith('https://www.google.com/maps/dir/?api=1&destination=')),
    read.directions.map((h)=>h.slice(-30)).join(' | '));
  await probe.screenshot({path:'tools/.qa-screens/pass-privilege-locked.png', fullPage:true});
  await probe.close();
}

/* ── The partner blocks at every width a guest holds ───────────────────────
   Four widths because the copy is real: "Via del Castello d'Altafronte 14R–16R,
   Firenze" is a long line on a 360px phone, and a benefit headline that wraps off
   the edge of its card is the failure this catches. 820 is in because the Pass is
   already part of the tablet QA. */
for (const width of [360, 390, 430, 820]) {
  const { probe, read } = await passSheetAt(width);
  step(`at ${width}px the partner cards fit and nothing is clipped`,
    read.partners===3 && read.overflowing===0 && read.clipped===0 && !read.pageScroll,
    `${read.partners} cards, ${read.overflowing} overflowing, ${read.clipped} clipped${read.pageScroll?', page scrolls sideways':''}`);
  if (width===360 || width===820) {
    await probe.screenshot({path:`tools/.qa-screens/pass-partners-${width}.png`, fullPage:true});
  }
  await probe.close();
}

/* ── The same stay, upgraded ───────────────────────────────────────────────
   One reservation walked through all three states, because the states are about
   the stay and not about three different guests: in-house without the upgrade,
   in-house with it, then called off. */
async function buyPrivilege(guideLink) {
  const token = guideLink.split('/g/')[1];
  const ctxJson = await (await fetch(`${B}/api/guide/${token}`)).json();
  const option = ctxJson.cardOptions?.[0];
  const order = await post('/api/checkout', {
    guideToken: token,
    lang: 'it',
    customer: { name: 'QA Ospite', email: 'qa@example.invalid' },
    lines: [{
      productId: 'privilege-card',
      variantId: option?.variantId,
      quantity: 1,
      date: option?.startDates?.[0],
      fields: { holderName: 'QA Ospite' },
    }],
  });
  if (!order.accessToken) return order;
  const session = new URL(order.checkoutUrl, B).searchParams.get('session');
  await post('/mock-checkout/pay', { session });
  // Opening the order is what settles it, exactly as a returning guest would.
  await fetch(`${B}/api/orders/${order.accessToken}`);
  return order;
}

{
  const order = await buyPrivilege(liveLink);
  step('Privilege can be bought on a stay that is already under way', Boolean(order.accessToken),
    order.error ?? '');
  const { probe, read } = await passSheetAt(390);
  step('and then all three benefits are unlocked, with nothing locked',
    read.available===3 && read.locked===0 && read.benefits===4,
    `${read.available} available, ${read.locked} locked, ${read.benefits} benefits`);
  step('a guest who paid for it is shown Privilege first', /privilege/i.test(read.labels[0]??''),
    read.labels.join(' | '));
  step('told once, for the section, how to use them',
    /Mostra la tua LunArt Privilege attiva/.test(read.lead), read.lead.slice(0,60));
  step('with nothing left to buy', read.buy===0, `${read.buy} button(s)`);
  // `innerText` carries the rendered case, and the venue line is uppercased.
  step('and the Privilege Card has a section of its own in the Pass',
    /Privilege Card/i.test(read.cardLabel) && read.cardActions===1,
    `${read.cardLabel} · ${read.cardActions} action(s)`);
  step('whose button offers the code, because this card is live now',
    read.cardState==='active' && /codice/i.test(read.cardAction),
    `${read.cardState} · ${read.cardAction}`);
  step('and Opera Caffè still on the stay side of the line',
    /opera caff/i.test(read.text) && !/opera/i.test(read.privilegeText),
    `in the sheet: ${/opera caff/i.test(read.text)}, inside Privilege: ${/opera/i.test(read.privilegeText)}`);
  await probe.screenshot({path:'tools/.qa-screens/pass-privilege-unlocked.png', fullPage:true});
  await probe.close();
}

/* ── A Pass that is over, or was called off ────────────────────────────────
   Nothing on this screen may read as usable, and a cancelled booking is not a
   sales opportunity — so the buy button goes away with it. Checked on an upgraded
   Pass, which is the harder case: the entitlement is real and still buys nothing. */
await post(`/api/staff/reservations/${today.reservation.id}/cancel`,{reason:'QA'});
{
  const { probe, read } = await passSheetAt(390);
  step('a cancelled booking makes every benefit unmistakably not usable',
    read.unavailable===3 && read.available===0 && read.locked===0,
    `${read.unavailable} unavailable, ${read.available} available`);
  step('and is not treated as a sales opportunity', read.buy===0, `${read.buy} button(s)`);
  step('with one honest line instead of a promise',
    /I vantaggi valgono mentre la tua Pass è attiva/.test(read.lead), read.lead.slice(0,64));
  await probe.screenshot({path:'tools/.qa-screens/pass-partners-cancelled.png', fullPage:true});
  await probe.close();
}
console.log('');

/* ── The type has to survive the artwork ───────────────────────────────────
   Text over a photograph cannot be checked from CSS colours: the backdrop is
   pixels, and it is pixels produced by four stacked gradients over a plate. So this
   does not model the scrim — modelling it would only test the model. It hides the
   type, photographs the card as the browser actually painted it, and measures each
   line against the *lightest* pixel inside its own box: the worst case, which is
   the one a guest reads a letter against.

   It caught the brand mark at 1.1:1 over bright sky, and the status line being
   pushed past the bottom edge of the card. */
/**
 * Measure every line on the card against the pixels actually behind it.
 *
 * A function rather than a block because it has to run twice: the Privilege plate is
 * gold, and the tier chip only exists there — which is exactly where a gold-on-gold
 * chip went unmeasured and came out invisible.
 */
async function measureCard(target, tier, selector = '.sheet [data-pass]') {
  const colours = await target.evaluate((sel) => {
    const root = document.querySelector(sel);
    const box = root.getBoundingClientRect();
    return ['.pass__holder', '.pass__line', '.pass__state', '.pass__tier',
      '.privilege-card__holder', '.privilege-card__guests', '.privilege-card__dates',
      '.privilege-card__number', '.privilege-card__kind']
      .map((sel) => {
        const el = root.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        // An element with its own opaque fill is read against that fill, not against
        // the plate behind it — the tier chip is a filled badge, and measuring its
        // text against the artwork it covers would be measuring the wrong thing.
        const fill = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)?.[1].split(',').map(Number) ?? [];
        const opaque = fill.length >= 3 && (fill[3] === undefined || fill[3] >= 0.95);
        return {
          sel,
          color: style.color,
          own: opaque ? fill.slice(0, 3) : null,
          // Relative to the card, because that is what gets photographed.
          x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height,
        };
      }).filter(Boolean);
  }, selector);

  const hidden = await target.addStyleTag({
    content: `${selector} .pass__face *, ${selector} > * { visibility: hidden !important; }`,
  });
  await target.waitForTimeout(250);
  const shot = (await target.locator(selector).screenshot()).toString('base64');
  await target.evaluate((el) => el.remove(), hidden);

  const results = await target.evaluate(async ({ png, lines, sel }) => {
    const srgb = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
    const parse = (css) => css.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);

    const bytes = Uint8Array.from(atob(png), (ch) => ch.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx2 = canvas.getContext('2d', { willReadFrequently: true });
    ctx2.drawImage(bitmap, 0, 0);

    // The screenshot is in device pixels; the rects were measured in CSS pixels.
    const scale = bitmap.width / document.querySelector(sel).getBoundingClientRect().width;

    return lines.map(({ sel, color, own, x, y, w, h }) => {
      if (own) {
        const [hi, lo] = [lum(parse(color)), lum(own)].sort((a, b) => b - a);
        return { sel, ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2), backdrop: own, onOwnFill: true };
      }
      const px = ctx2.getImageData(
        Math.max(0, Math.round(x * scale)), Math.max(0, Math.round(y * scale)),
        Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)),
      ).data;

      /**
       * The worst pixel, whichever direction the type runs.
       *
       * This used to take the lightest pixel, which is the worst case only for light
       * type on a dark ground. The Pass is now dark ink on a pale watercolour, where
       * the dangerous pixel is the darkest one — the Duomo's cupola, a cypress. So
       * the contrast is computed against every pixel and the lowest answer kept,
       * which is correct for either and needs no flag saying which this is.
       */
      const ink = lum(parse(color));
      let worst = Infinity; let backdrop = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) {
        const rgb = [px[i], px[i + 1], px[i + 2]];
        const [hi, lo] = [ink, lum(rgb)].sort((a, b) => b - a);
        const ratio = (hi + 0.05) / (lo + 0.05);
        if (ratio < worst) { worst = ratio; backdrop = rgb; }
      }
      return { sel, ratio: +worst.toFixed(2), backdrop };
    });
  }, { png: shot, lines: colours, sel: selector });

  for (const { sel, ratio, backdrop, onOwnFill } of results) {
    // The holder's name is large type, which AA puts at 3:1; everything else is 4.5:1.
    const need = sel === '.pass__holder' ? 3 : 4.5;
    step(`${tier}: ${sel.replace('.pass__','')} reads over ${onOwnFill ? 'its own fill' : 'the artwork'}`,
      ratio >= need, `${ratio}:1 (needs ${need}) over rgb(${backdrop.join(',')})`);
  }

  /* And it has to fit: the status line used to be pushed past the card's bottom edge
     by a `margin-top: auto` layout on a box with a fixed aspect ratio. */
  const fits = await target.evaluate((sel) => {
    const box = document.querySelector(sel).getBoundingClientRect();
    return [...document.querySelectorAll(`${sel} p, ${sel} span`)]
      .every((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
      });
  }, selector);
  step(`${tier}: every line of it is inside the card`, fits);
}

/* ── The type has to survive the artwork ───────────────────────────────────
   Text over a photograph cannot be checked from CSS colours: the backdrop is
   pixels, and it is pixels produced by four stacked gradients over a plate. So this
   does not model the scrim — modelling it would only test the model. It hides the
   type, photographs the card as the browser actually painted it, and measures each
   line against the *lightest* pixel inside its own box: the worst case, which is the
   one a guest reads a letter against.

   It caught the brand mark at 1.1:1 over bright sky, the status line being pushed
   past the bottom edge of the card, the Privilege chip at gold-on-gold, and — once
   the card became dark ink on the voucher's pale watercolour — the fact that the
   worst pixel is now the darkest one rather than the lightest. */
await measureCard(page, 'Pass');

/* Back out, so the screens that follow start from the home. */
await page.goBack(); await page.waitForTimeout(700);

/* ── A checkout that was started and abandoned ─────────────────────────────
   On staging these had piled up and were crowding out the order that is actually
   coming. They are kept — a guest who thinks they paid must be able to find out
   that they did not — but they are not purchases and must not read as any. */
const guideToken = link.split('/g/')[1];
const started = await (await fetch(`${B}/api/checkout`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    lines: [{ productId: 'light-breakfast', quantity: 1, date: inDays(31), slotId: 'b-0900', room: '303' }],
    customer: { name: 'QA', email: 'qa@example.com', room: '303' },
    lang: 'it',
    guideToken,
  }),
})).json();
// Deliberately never paid: that is the whole point of this case.

await page.goto(link, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const split = await page.evaluate(() => ({
  main: document.querySelectorAll('.purchases:not(.purchases--muted) .purchase').length,
  mainText: [...document.querySelectorAll('.purchases:not(.purchases--muted) .purchase')].map((e) => e.innerText).join(' '),
  aside: document.querySelectorAll('.purchases-aside').length,
  asideOpen: document.querySelector('.purchases-aside')?.open ?? null,
  asideRows: document.querySelectorAll('.purchases--muted .purchase').length,
  asideLabel: document.querySelector('.purchases-aside__summary')?.innerText.replace(/\s+/g,' ').trim() ?? '',
}));
step('an abandoned checkout is kept, not deleted', split.aside===1 && split.asideRows>0, `${split.asideRows} row(s)`);
step('but it is folded away rather than leading the list', split.asideOpen===false);
step('and it is named for what it is', /non completati|not completed/i.test(split.asideLabel), split.asideLabel);
step('what was actually paid for leads', split.main>0 && !/in attesa di pagamento|waiting for payment/i.test(split.mainText), `${split.main} purchase(s)`);
step('the abandoned order is still reachable', Boolean(started.accessToken));
await page.screenshot({path:'tools/.qa-screens/pass-purchases-split.png'});

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
    step('Opera stays under what the stay includes, even on an upgraded Pass',
      /opera caff/i.test(after.section), after.section.replace(/\s+/g,' ').slice(0,90));

    /* The upgrade has to be visibly an upgrade — same card, gold. Scrolled to, so
       the screenshot is of the card and not of the top of the page. */
    await up.locator('[data-pass]').scrollIntoViewIfNeeded();
    await up.waitForTimeout(400);
    const tier = await up.evaluate(() => {
      const el = document.querySelector('[data-pass]');
      return {
        plate: getComputedStyle(el, '::before').backgroundImage.match(/[^/]+\.webp/)?.[0] ?? '',
        chip: document.querySelector('.pass__tier')?.textContent.trim() ?? '',
        border: getComputedStyle(el).borderTopColor,
        ring: getComputedStyle(document.querySelector('.pass__face'), '::before').borderTopWidth,
      };
    });
    /**
     * One artwork, two tiers.
     *
     * Privilege used to have a plate of its own, which made it a different card
     * rather than the same card upgraded. It now shares whatever the standard Pass
     * wears and is marked by the edge and the chip alone — so the check compares the
     * two rather than naming a file, and survives the artwork being changed.
     */
    step('Privilege shares the standard plate: one artwork, one family',
      tier.plate === STANDARD_PLATE, `${tier.plate} vs ${STANDARD_PLATE}`);
    step('and is marked by a gold edge rather than a different picture',
      /rgb\(20[0-9], 1[0-9]{2}, 1[0-9]{2}\)/.test(tier.border) || tier.ring === '1px',
      `border ${tier.border}, inner ring ${tier.ring}`);
    step('with the tier said on the card itself', tier.chip.length > 0, tier.chip);
    await up.screenshot({ path: 'tools/.qa-screens/pass-privilege.png' });

    await up.locator('[data-pass]').click();
    await up.waitForTimeout(900);
    const privSheet = await up.evaluate(() => {
      const labels = [...document.querySelectorAll('.sheet .pass__label')].map((e) => e.textContent.trim());
      const first = document.querySelector('.sheet .pass__label[data-section="privilege-benefits"]');
      // Everything under the Privilege benefits heading, up to the next one.
      const privilegeBlock = [];
      for (let node = first?.nextElementSibling; node && !node.classList.contains('pass__label'); node = node.nextElementSibling) {
        privilegeBlock.push(node);
      }
      const within = (sel) => privilegeBlock.flatMap((n) => [...n.querySelectorAll(sel)]);
      return {
        labels,
        privilegeVenues: within('.partner').length,
        privilegeText: privilegeBlock.map((n) => n.innerText).join(' '),
        locked: document.querySelectorAll('.sheet .partner[data-access="locked"]').length,
        available: document.querySelectorAll('.sheet .partner[data-access="available"]').length,
        allRows: document.querySelectorAll('.sheet .benefit').length,
        buy: document.querySelectorAll('.sheet [data-product="privilege-card"]').length,
        howTo: document.querySelector('.sheet [data-privilege-lead]')?.textContent.trim() ?? '',
        hasQrAction: document.querySelectorAll('.sheet [data-card]').length,
        cardLabel: labels.find((l) => /privilege card/i.test(l)) ?? '',
        cardLine: document.querySelector('.sheet [data-card-state]')?.textContent.trim() ?? '',
        cardState: document.querySelector('.sheet [data-card-state]')?.dataset.cardState ?? '',
        cardAction: document.querySelector('.sheet [data-card]')?.innerText.trim() ?? '',
      };
    });
    step('the Privilege sheet keeps the card, what it unlocks and what the stay gives apart',
      privSheet.labels.length === 3, privSheet.labels.join(' | '));
    step('a guest who paid for it is shown the card first of all',
      /Privilege Card/i.test(privSheet.labels[0] ?? ''), privSheet.labels[0]);
    /**
     * This stay is a month away, so nothing is claimable tonight — and that is the
     * point of the check. A Privilege Pass is not a licence that begins when the
     * money moves; it begins when the stay does, and the one date engine says so.
     */
    step('a Privilege Pass bought ahead of the stay claims nothing yet',
      privSheet.available === 0 && privSheet.locked === 0 && privSheet.allRows === 4,
      `${privSheet.available} available, ${privSheet.locked} locked, ${privSheet.allRows} benefits`);
    step('and says so in one line rather than inviting the guest to a door',
      /I vantaggi valgono mentre la tua Pass è attiva/.test(privSheet.howTo), privSheet.howTo.slice(0, 60));
    step('with nothing left to buy', privSheet.buy === 0, `${privSheet.buy} button(s)`);
    step('Opera Caffè is never drawn inside the Privilege section',
      privSheet.privilegeVenues === 2 && !/opera/i.test(privSheet.privilegeText),
      `${privSheet.privilegeVenues} venues under Privilege`);
    /* ── The bug this file now guards ──────────────────────────────────────
       A guest who had bought Privilege weeks before her stay opened her Pass and
       found no way at all to look at the card she had paid for: the only
       affordance was a button at the foot of the sheet, under three partner
       blocks, promising a code that would not exist until November. */
    step('the card she paid for has a section of its own, not a button at the foot',
      /Privilege Card/i.test(privSheet.cardLabel) && privSheet.hasQrAction === 1,
      `${privSheet.cardLabel} · ${privSheet.hasQrAction} action(s)`);
    step('saying plainly that it is not active yet, and from when',
      privSheet.cardState === 'not-started'
        && /Non ancora attiva/.test(privSheet.cardLine) && /\bda\b/.test(privSheet.cardLine),
      privSheet.cardLine);
    step('and the button offers to open it, not to show a code that does not exist',
      /Apri la card/i.test(privSheet.cardAction) && !/codice/i.test(privSheet.cardAction),
      privSheet.cardAction);
    await up.screenshot({ path: 'tools/.qa-screens/pass-privilege-sheet.png' });

    // The gold plate is the harder of the two to read over, and it carries the one
    // element that exists only here.
    await measureCard(up, 'Privilege');

    /* ── The card a venue is shown ─────────────────────────────────────────
       Same tessera, so it has to look like one. It used to be a dark card with a
       CSS-drawn monogram: a second design for what the guest experiences as one
       object. */
    await up.locator('.sheet [data-card]').click();
    await up.waitForTimeout(1800);
    const venue = await up.evaluate(() => {
      const el = document.querySelector('.privilege-card');
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        plate: getComputedStyle(el, '::before').backgroundImage.match(/[^/]+\.webp/)?.[0] ?? '',
        ink: style.color,
        border: style.borderTopColor,
        ratio: +(el.getBoundingClientRect().width / el.getBoundingClientRect().height).toFixed(3),
        // A card that has not started shows when it will instead of a code. Both are
        // correct; what would be wrong is neither.
        qr: document.querySelectorAll('.card-qr').length,
        notice: document.querySelectorAll('.sheet .notice').length,
        noticeText: document.querySelector('.sheet .notice')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
        pill: document.querySelector('.sheet .status-pill')?.textContent.trim() ?? '',
        face: el.innerText.replace(/\s+/g, ' ').trim(),
        mark: document.querySelectorAll('.privilege-card .pass__mark').length,
      };
    });
    step('the venue card wears the same painting', venue?.plate === STANDARD_PLATE, `${venue?.plate} vs ${STANDARD_PLATE}`);
    step('in the same ink, with the same gold edge',
      venue?.ink === 'rgb(21, 18, 11)' && venue?.border === 'rgb(201, 168, 109)', `${venue?.ink} / ${venue?.border}`);
    step('and the same proportions as the Pass', Math.abs((venue?.ratio ?? 0) - 85 / 55) < 0.02, `${venue?.ratio}`);
    step('the venue card carries the LunArt mark, since the artwork does not',
      venue?.mark === 1, `${venue?.mark} mark(s)`);
    // The venue card has its own type over the same painting, and its own wash — which
    // is exactly the copy that was missed when the washes were raised.
    await measureCard(up, 'Venue card', '.privilege-card');
    step('with either its code or the date it starts, never neither',
      (venue?.qr ?? 0) + (venue?.notice ?? 0) > 0, `qr ${venue?.qr}, notice ${venue?.notice}`);

    /* ── A card that is owned and not yet usable ───────────────────────────
       An information state, not an authorisation one. The guest gets the real card
       — her name, the dates, the number — and a sentence saying when the code
       appears. What she does not get, and what the server would refuse to issue,
       is a code. */
    step('a card bought ahead of the stay shows no QR at all', venue?.qr === 0, `${venue?.qr} QR`);
    step('and says when it starts and when the code will appear',
      /Diventa attiva/.test(venue?.noticeText ?? '') && /QR sarà disponibile/.test(venue?.noticeText ?? ''),
      (venue?.noticeText ?? '').slice(0, 96));
    step('with the state said as a word as well', /Non ancora attiva/.test(venue?.pill ?? ''), venue?.pill);
    step('and the real card underneath it: holder, dates and number',
      /Flow/.test(venue?.face ?? '') && /N\./.test(venue?.face ?? '') && /nov/.test(venue?.face ?? ''),
      venue?.face);
    await up.screenshot({ path: 'tools/.qa-screens/pass-venue-card.png' });
    await upgradeCtx.close();
  }
} else {
  /**
   * The rail: no card partner, no Privilege on sale.
   *
   * This used to be the expected branch — production shipped with no card partner,
   * so the upgrade was withheld and a demo venue was the only way to walk the flow.
   * Le Firme and Blue Velvet reserve real benefits for it now, so reaching here
   * means the register lost them, which is a failure and not a configuration.
   */
  step('Privilege is on sale, because real partners stand behind it', false,
    `catalogue says purchasable=${cardProduct?.purchasable}`);
}

// Tidy up after ourselves.
for (const id of spent) await post(`/api/staff/reservations/${id}/cancel`,{reason:'QA'});
await post(`/api/staff/reservations/${made.reservation.id}/cancel`,{reason:'QA'});

await b.close();
console.log(failures===0 ? '\nALL PASS/COMMERCE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures===0?0:1);
