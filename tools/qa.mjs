#!/usr/bin/env node
/**
 * Mobile and accessibility QA, driven through a real browser.
 *
 * Checks the things that were actually broken before: the navigation leaving the
 * viewport on a phone, horizontal overflow, tap targets too small to hit, images
 * without alt text, and the Concierge answering "avete biscotti?" with anything at
 * all. Screenshots land in tools/.qa-screens/ for a look by eye.
 *
 * Needs the preview server running:
 *   node tools/serve.mjs &
 *   npm install --no-save playwright && node tools/qa.mjs
 */
import { chromium, devices } from 'playwright';
import { mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = new URL('.qa-screens/', import.meta.url).pathname;
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/';
await mkdir(OUT, { recursive: true });
/**
 * The container ships a Chromium build under PLAYWRIGHT_BROWSERS_PATH. When the
 * installed playwright pins a different build number, point it at the one that is
 * actually here rather than downloading another copy.
 */
async function launch() {
  try {
    return await chromium.launch();
  } catch (error) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root) throw error;
    const candidates = (await readdir(root))
      .filter((d) => d.startsWith('chromium-'))
      .map((d) => join(root, d, 'chrome-linux', 'chrome'));
    for (const executablePath of candidates) {
      if (existsSync(executablePath)) return chromium.launch({ executablePath });
    }
    throw error;
  }
}

const browser = await launch();
let failures = 0;
const note = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); };

for (const width of [360, 390, 430]) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  console.log(`\n── ${width}px ──`);
  note(errors.length === 0, `no console errors (${errors.slice(0,3).join(' | ') || 'none'})`);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    wide: [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5).map((el) => el.className || el.tagName),
  }));
  note(overflow.doc <= overflow.win + 1, `no horizontal overflow (doc ${overflow.doc} vs win ${overflow.win}) ${overflow.wide.join(', ')}`);

  /**
   * The mark in the header, in whichever state it is in.
   *
   * The artwork has not been handed over, so the shipped state is the typographic
   * wordmark and `src/ui/brand.js` swaps in `assets/img/brand/lunart-wordmark.svg`
   * if it ever appears. Either state has to be legible and has to leave the icons
   * alone — so this checks what is actually there rather than asserting one of them.
   */
  const mark = await page.evaluate(() => {
    const el = document.getElementById('header-mark');
    if (!el) return null;
    const img = el.querySelector('img');
    const m = el.getBoundingClientRect();
    const tools = document.querySelector('.header__tools').getBoundingClientRect();
    return {
      kind: el.dataset.logo === 'true' ? 'artwork' : 'type',
      text: el.textContent.trim(),
      imgOk: img ? img.naturalWidth > 0 : null,
      height: Math.round(m.height),
      left: Math.round(m.left),
      clearOfTools: m.right <= tools.left + 1,
      centred: Math.abs((m.top + m.bottom) / 2 - (tools.top + tools.bottom) / 2) < 2,
    };
  });
  note(Boolean(mark), 'the header carries a mark');
  note(mark?.kind === 'artwork' ? mark.imgOk === true : mark?.text === 'LunArt',
    `the mark is ${mark?.kind} (${mark?.kind === 'artwork' ? 'image decoded' : mark?.text})`);
  note(mark?.clearOfTools === true, 'it does not run into search / gift / EN');
  note(mark?.centred === true, 'and sits on the same centre line as them');
  note(mark?.left === 20 || mark?.left === 16, `aligned to the gutter (${mark?.left}px)`);

  const nav = await page.evaluate(() => {
    const r = document.querySelector('#tabbar').getBoundingClientRect();
    return { left: r.left, right: r.right, win: window.innerWidth, visible: r.width > 0 };
  });
  note(nav.left >= -1 && nav.right <= nav.win + 1 && nav.visible, `tabbar inside viewport (${nav.left}→${nav.right} of ${nav.win})`);

  const small = await page.evaluate(() => [...document.querySelectorAll('button, a[href]')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({ c: el.className || el.tagName, h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
    .filter((x) => x.h < 40 || x.w < 40));
  note(small.length === 0, `tap targets >= 40px (${small.length} small: ${small.slice(0,4).map(s=>`${s.c} ${s.w}x${s.h}`).join(', ')})`);

  const counts = await page.evaluate(() => {
    const shown = (sel) => [...document.querySelectorAll(sel)]
      .filter((el) => el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })).length;
    return {
      cards: document.querySelectorAll('.card').length,
      shownCards: shown('#main .card, #main .room'),
      folded: document.querySelectorAll('#main details:not([open]) .card, #main details:not([open]) .room').length,
      quick: document.querySelectorAll('.quick .quick__item').length,
      offers: document.querySelectorAll('.offer').length,
      folds: document.querySelectorAll('.fold').length,
      height: document.body.scrollHeight,
      screens: +(document.body.scrollHeight / window.innerHeight).toFixed(1),
      sliders: document.querySelectorAll('[data-slider]').length,
      h1: document.querySelectorAll('h1').length,
      /**
       * An image with no `alt` attribute at all is a fault. `alt=""` is not — it is
       * how an image is marked decorative, and this guide has one that genuinely
       * is: a partner's logo, whose business name is written in text beside it.
       * Announcing the mark as well would read the venue's name twice to somebody
       * listening instead of looking.
       */
      imgNoAlt: [...document.querySelectorAll('img')].filter((i) => i.getAttribute('alt') === null).length,
      /** And every decorative one has its meaning in the text next to it. */
      imgDecorativeNamed: [...document.querySelectorAll('img[alt=""]')]
        .every((i) => (i.closest('.partner, .pass, .privilege-card')?.innerText ?? '').trim().length > 0),
    };
  });
  note(counts.cards > 30, `the whole knowledge base is still in the document (${counts.cards} cards)`);
  // The home used to be eleven screens of continuous scroll. The content did not
  // shrink — only what is on screen at once did.
  note(counts.screens <= 6, `the home is short (${counts.height}px, ${counts.screens} screens)`);
  note(counts.folded >= 25, `and most of it waits behind a fold (${counts.folded} cards folded away)`);
  note(counts.shownCards < 12, `with little on screen at once (${counts.shownCards} visible)`);
  note(counts.folds >= 5, `every section has its own fold (${counts.folds})`);
  note(counts.quick === 4, `four primary actions (${counts.quick})`);
  note(counts.offers > 0, `featured extras rendered (${counts.offers})`);
  note(counts.h1 === 1, `exactly one h1 (${counts.h1})`);
  note(counts.imgNoAlt === 0, `every image has alt (${counts.imgNoAlt} missing)`);
  note(counts.imgDecorativeNamed, 'and every decorative one is named in the text beside it');

  await page.screenshot({ path: `${OUT}/home-${width}.png`, fullPage: false });
  await context.close();
}

// Interaction pass at 390
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'networkidle' });
console.log('\n── interactions (390px) ──');

await page.click('.quick__item');
await page.waitForTimeout(450);
note(await page.isVisible('.sheet[data-open="true"]'), 'quick action opens the sheet');
note((await page.locator('.sheet__title').textContent()).length > 0, 'sheet has a title');
await page.screenshot({ path: `${OUT}/sheet-390.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(450);
note(!(await page.isVisible('.sheet[data-open="true"]')), 'Escape closes the sheet');

await page.click('#open-concierge');
await page.waitForTimeout(450);
note(await page.isVisible('.concierge[data-open="true"]'), 'concierge opens');
await page.fill('#concierge-input', 'qual è la password del wifi');
await page.press('#concierge-input', 'Enter');
await page.waitForTimeout(350);
const reply = await page.locator('.bubble--concierge').last().textContent();
note(reply.includes('LOPERACAFFE62R'), `concierge answers wifi (${reply.slice(0, 60).trim()}…)`);
await page.fill('#concierge-input', 'avete biscotti?');
await page.press('#concierge-input', 'Enter');
await page.waitForTimeout(350);
const fallback = await page.locator('.bubble--concierge').last().textContent();
note(!fallback.includes('culla') && !fallback.includes('cot'), `biscotti falls back (${fallback.slice(0, 50).trim()}…)`);
await page.screenshot({ path: `${OUT}/concierge-390.png` });
await page.click('.concierge [data-close]');
await page.waitForTimeout(450);

await page.click('[data-open-search]');
await page.waitForTimeout(300);
await page.fill('#search-input', 'colazione');
await page.waitForTimeout(300);
const results = await page.locator('#search-results .card').count();
note(results > 0, `search returns results (${results})`);
await page.screenshot({ path: `${OUT}/search-390.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await page.click('[data-view="florence"]');
await page.waitForTimeout(400);
note((await page.locator('.place').count()) > 5, `florence view lists places (${await page.locator('.place').count()})`);
await page.screenshot({ path: `${OUT}/florence-390.png`, fullPage: false });

// Back to the home: the Help action lives there, not in the bar.
await page.click('[data-view="guide"]');
await page.waitForTimeout(400);
await page.click('[data-primary][data-goto="help"]');
await page.waitForTimeout(400);
note(page.url().includes('#/help'), `the Help action reaches the help view (${page.url().split('#')[1]})`);
note((await page.locator('.card').count()) > 4, 'help view lists contacts');
await page.screenshot({ path: `${OUT}/help-390.png` });

// Everything demoted into a fold is still one tap away, and the fold opens it.
await page.click('[data-view="guide"]');
await page.waitForTimeout(400);
const beforeOpen = await page.locator('#fold-stay .card').first().isVisible();
await page.click('#fold-stay .fold__summary');
await page.waitForTimeout(300);
note(!beforeOpen && await page.locator('#fold-stay .card').first().isVisible(),
  'a fold opens the section it was hiding');
await page.click('#fold-stay .card');
await page.waitForTimeout(450);
note(await page.isVisible('.sheet[data-open="true"]'), 'and a card inside it still opens its sheet');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

note(errors.length === 0, `no page errors during interaction (${errors.slice(0,2).join(' | ') || 'none'})`);

// ── Language, deep links, review mode, desktop ────────────────────────────────
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  console.log('\n── language, routing, review ──');

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('#lang-toggle');
  await page.waitForTimeout(250);
  note((await page.getAttribute('html', 'lang')) === 'it', 'language toggle sets <html lang>');
  const italian = await page.textContent('.quick__grid');
  note(/arriv|ingress|bagagl|auto/i.test(italian), `quick actions render in Italian (${italian.replace(/\s+/g, ' ').trim().slice(0, 48)}…)`);

  await page.click('#open-concierge');
  await page.waitForTimeout(300);
  await page.fill('#concierge-input', 'dove posso cenare?');
  await page.press('#concierge-input', 'Enter');
  await page.waitForTimeout(300);
  const dinner = await page.locator('.bubble--concierge').last().textContent();
  note(/mangiare|ristorante|bistecca/i.test(dinner), `"dove posso cenare?" answers about eating (${dinner.replace(/\s+/g, ' ').trim().slice(0, 44)}…)`);
  note(!/Canneto/.test(dinner), 'it does not answer with the street address');
  await page.click('.concierge [data-close]');
  await page.waitForTimeout(400);

  // Phase changes what is offered first.
  const beforeQuick = await page.textContent('.quick__grid');
  await page.click('[data-phase="leaving"]');
  await page.waitForTimeout(250);
  const leavingQuick = await page.textContent('.quick__grid');
  note(beforeQuick !== leavingQuick, 'changing phase changes the quick actions');

  // Entries are linkable, so staff can send a guest straight to an answer.
  await page.goto(`${BASE}#/e/wifi`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  note(await page.isVisible('.sheet[data-open="true"]'), 'deep link opens the sheet directly');
  note((await page.textContent('.sheet__body')).includes('LOPERACAFFE62R'), 'deep-linked sheet shows the right entry');

  await page.goto(`${BASE}?review=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const flagged = await page.locator('.review__item').count();
  note(flagged > 0, `review mode lists flagged content (${flagged} items)`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  note((await page.locator('.review__item').count()) === 0, 'review list is absent without ?review=1');

  note(errs.length === 0, `no page errors (${errs.slice(0, 2).join(' | ') || 'none'})`);
  await ctx.close();
}

// ── Nothing was dropped, only folded ─────────────────────────────────────────
// The shortening is only honest if every entry that used to be on the home is
// still on the home. This asks the knowledge layer itself rather than trusting
// the markup: every entry outside the two sections that have their own views has
// to have a card somewhere in the page, open or folded.
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  console.log('\n── nothing dropped ──');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const reach = await page.evaluate(async () => {
    const data = await import('/data/index.js');
    const onPage = new Set([...document.querySelectorAll('#main [data-entry]')].map((el) => el.dataset.entry));
    const owned = data.entries.filter((e) => e.section !== 'florence' && e.section !== 'help');
    return {
      total: data.entries.length,
      owned: owned.length,
      missing: owned.filter((e) => !onPage.has(e.id)).map((e) => e.id),
      rooms: document.querySelectorAll('#main .room').length,
    };
  });
  note(reach.missing.length === 0,
    `every entry the home owns is still on it (${reach.owned} entries, ${reach.missing.join(', ') || 'none missing'})`);
  // The catalogue belongs to the public guide, where nobody has booked yet. On a
  // personal link it is gone entirely — qa-reservations checks that end.
  note(reach.rooms >= 5, `the public guide still shows all five rooms (${reach.rooms})`);
  note((await page.locator('#fold-rooms').count()) === 1, 'in their own fold');

  // The Florence and Help sections have their own views; check they still fill.
  await page.goto(`${BASE}#/florence`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  note((await page.locator('.place').count()) > 5, `Florence keeps its recommendations (${await page.locator('.place').count()})`);
  await page.goto(`${BASE}#/help`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  note((await page.locator('.card').count()) > 4, `Help keeps its contacts (${await page.locator('.card').count()})`);
  await ctx.close();
}

// ── One line to message, one to call ─────────────────────────────────────────
// LunArt has a WhatsApp Business line and a telephone, and they are different
// numbers. The Business line does not ring, so it must never be dialled; the
// telephone is not staffed on WhatsApp, so it must never be messaged. This reads
// the rendered links, because the data was right before and the markup was not.
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  console.log('\n── WhatsApp and telephone ──');
  const OFFICIAL = '393925661488';
  const DIEGO = '393342115505';

  const contactLinks = async (where) => page.evaluate(() => [...document.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href')).filter((h) => /^tel:|wa\.me/.test(h)));

  for (const route of ['', '#/help', '#/e/contacts', '#/e/room-problem']) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const found = await contactLinks();
    const wa = found.filter((h) => h.includes('wa.me'));
    const tel = found.filter((h) => h.startsWith('tel:'));
    const where = route || '/';
    note(wa.every((h) => h.includes(OFFICIAL)),
      `${where}: every WhatsApp link is the official line (${[...new Set(wa)].join(', ') || 'none here'})`);
    note(!tel.some((h) => h.replace(/\D/g, '').includes(OFFICIAL)),
      `${where}: the WhatsApp line is never dialled`);
    note(!wa.some((h) => h.includes(DIEGO)), `${where}: WhatsApp never goes to Diego`);
  }

  // Both numbers reachable, each by its own channel, from the help view.
  await page.goto(`${BASE}#/help`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const help = await contactLinks();
  note(help.some((h) => h.includes(`wa.me/${OFFICIAL}`)), 'the official line can be messaged');
  note(help.some((h) => h.replace(/\D/g, '') === DIEGO && h.startsWith('tel:')), 'and Diego can be called');

  // The static shell carries the same split, for a guest with no JavaScript.
  const shell = await page.evaluate(async () => {
    const html = await (await fetch('/index.html')).text();
    return [...html.matchAll(/(?:href="(tel:[^"]+|https:\/\/wa\.me\/[^"]+)")/g)].map((m) => m[1]);
  });
  note(shell.filter((h) => h.includes('wa.me')).every((h) => h.includes(OFFICIAL)),
    `the no-JavaScript shell messages the official line (${[...new Set(shell.filter((h) => h.includes('wa.me')))].join(', ')})`);
  note(!shell.some((h) => h.startsWith('tel:') && h.replace(/\D/g, '').includes(OFFICIAL)),
    'and never dials it');
  await ctx.close();
}

// ── The two languages say the same things ────────────────────────────────────
{
  console.log('\n── Italian and English ──');
  const read = async (lang) => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    // The toggle shows the language it switches TO, so flip until we are there.
    for (let i = 0; i < 2 && (await page.getAttribute('html', 'lang')) !== lang; i++) {
      await page.click('#lang-toggle');
      await page.waitForTimeout(300);
    }
    const shape = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      primary: [...document.querySelectorAll('[data-primary] .quick__title')].map((el) => el.textContent.trim()),
      headings: [...document.querySelectorAll('#main h2')].map((el) => el.textContent.trim()).filter(Boolean),
      folds: [...document.querySelectorAll('.fold__title')].map((el) => el.textContent.trim()),
      brief: document.querySelectorAll('.brief__row').length,
      offers: document.querySelectorAll('.offer').length,
      tabs: [...document.querySelectorAll('.tab:not([hidden]) span')].map((el) => el.textContent.trim()).filter(Boolean),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      empty: [...document.querySelectorAll('#main h2, .fold__title, [data-primary] .quick__title, .tab span')]
        .filter((el) => !el.textContent.trim()).length,
    }));
    await ctx.close();
    return shape;
  };

  const it = await read('it');
  const en = await read('en');
  note(it.lang === 'it' && en.lang === 'en', `both languages render (${it.lang}, ${en.lang})`);
  note(it.primary.length === 4 && en.primary.length === 4,
    `four primary actions either way (${it.primary.join(' · ')} | ${en.primary.join(' · ')})`);
  note(it.headings.length === en.headings.length, `the same sections (${it.headings.length} vs ${en.headings.length})`);
  note(it.folds.length === en.folds.length, `the same folds (${it.folds.join(', ')} | ${en.folds.join(', ')})`);
  note(it.brief === en.brief && it.offers === en.offers, `the same rows and offers (${it.brief}/${it.offers})`);
  note(it.tabs.length === en.tabs.length, `the same bar (${it.tabs.join(' · ')} | ${en.tabs.join(' · ')})`);
  note(it.empty === 0 && en.empty === 0, `no untranslated label is blank (${it.empty + en.empty})`);
  // Italian is the longer language; 360px is the narrowest phone.
  note(it.overflow <= 1 && en.overflow <= 1, `neither overflows at 360px (${it.overflow}, ${en.overflow})`);
}

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  console.log('\n── desktop (1280px) ──');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const wide = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  note(wide.doc <= wide.win + 1, `no horizontal overflow (${wide.doc} vs ${wide.win})`);
  const bar = await page.evaluate(() => document.querySelector('#tabbar').getBoundingClientRect().top);
  note(bar < 100, `navigation moves to the top on desktop (top: ${Math.round(bar)}px)`);
  await page.click('#open-concierge');
  await page.waitForTimeout(400);
  note(await page.isVisible('.concierge[data-open="true"]'), 'concierge opens as a panel');
  await page.screenshot({ path: `${OUT}/desktop-1280.png` });
  note(errs.length === 0, `no page errors (${errs.slice(0, 2).join(' | ') || 'none'})`);
  await ctx.close();
}

// ── Contrast ─────────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  console.log('\n── contrast (WCAG AA) ──');

  for (const [view, label] of [['', 'guide'], ['#/florence', 'florence'], ['#/help', 'help']]) {
    await page.goto(BASE + view, { waitUntil: 'networkidle' });
    await page.waitForTimeout(350);

    const failures = await page.evaluate(() => {
      const channel = (c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const parse = (value) => (value.match(/[\d.]+/g) ?? []).map(Number);
      const blend = (fg, bg) => {
        const a = fg[3] ?? 1;
        return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
      };
      const ratio = (a, b) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };

      /** Walk up for the first opaque background; a photo behind the text is skipped. */
      function backdrop(el) {
        for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.backgroundImage !== 'none') return null;
          const bg = parse(style.backgroundColor);
          if (bg.length && (bg[3] ?? 1) > 0.95) return bg.slice(0, 3);
        }
        return [250, 249, 247];
      }

      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const text = [...el.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent.trim()).join('');
        if (!text) continue;
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;

        // Text over the hero photograph cannot be measured against a parent colour.
        // It is measured against the scrim instead, composited over white — the
        // worst backdrop a photograph could present.
        const overPhoto = el.closest('.welcome__caption, .feature__caption');
        const bg = overPhoto
          ? blend([...parse(getComputedStyle(document.documentElement).getPropertyValue('--hero-scrim'))], [255, 255, 255])
          : backdrop(el);
        if (!bg) continue;

        const style = getComputedStyle(el);
        const colour = blend(parse(style.color), bg);
        const size = parseFloat(style.fontSize);
        const bold = Number(style.fontWeight) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        const needed = large ? 3 : 4.5;
        const got = ratio(colour, bg);
        if (got < needed) {
          out.push({ cls: el.className || el.tagName, size: Math.round(size), got: got.toFixed(2), needed, text: text.slice(0, 24) });
        }
      }
      return out;
    });

    note(failures.length === 0,
      `${label}: every text colour meets AA (${failures.length} below: ${failures.slice(0, 3).map((f) => `${f.cls} ${f.size}px ${f.got}:1`).join(', ')})`);
  }
  await ctx.close();
}

// ── Copy to clipboard, and the offline fallback ──────────────────────────────
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  console.log('\n── clipboard and offline ──');

  await page.goto(`${BASE}#/e/wifi`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.click('.sheet [data-copy]:last-of-type, .sheet [data-copy]');
  await page.waitForTimeout(250);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  note(clip === 'LunArt-Guest' || clip === 'LOPERACAFFE62R', `copy button copies the value (${clip})`);
  note((await page.getAttribute('.sheet [data-copy]', 'data-copied')) === 'true', 'copy button confirms it worked');

  // A guest in a stairwell with no signal should still get the Wi-Fi password.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    return Boolean(reg && reg.active);
  });
  note(registered, 'service worker registers and activates');

  if (registered) {
    await page.waitForTimeout(1200);          // let the runtime cache fill
    await ctx.setOffline(true);
    const response = await page.goto(BASE, { waitUntil: 'load' }).catch(() => null);
    await page.waitForTimeout(900);
    const offlineCards = await page.locator('.card').count();
    note(Boolean(response) && offlineCards > 5, `the guide still renders offline (${offlineCards} cards)`);
    await ctx.setOffline(false);

    /**
     * And nothing the API said is kept.
     *
     * The service worker caches the guide, which only changes when the guide is
     * republished. It must never cache `/api/`: a cached price, a cached
     * availability or a cached order total is a figure shown to a guest as
     * current when it is not — and the server recalculating everything is
     * worthless if the browser can answer from last week.
     */
    await page.waitForTimeout(400);
    const cachedApi = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls = [];
      for (const name of names) {
        const keys = await (await caches.open(name)).keys();
        urls.push(...keys.map((r) => new URL(r.url).pathname).filter((p) => p.startsWith('/api/')));
      }
      return urls;
    });
    note(cachedApi.length === 0, `no API response is ever cached (${cachedApi.join(', ') || 'none'})`);
  }

  await ctx.close();
}

// ── Slider: the dot you tap is the photo you get ─────────────────────────────
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  console.log('\n── room slider ──');
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // The room catalogue is secondary now, so it waits inside a fold.
  await page.click('#fold-rooms .fold__summary');
  await page.waitForTimeout(400);

  // Room 302 carries four photographs, which is where the old off-by-one showed.
  const slider = page.locator('#fold-rooms [data-slider]').nth(1);
  await slider.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);

  const dots = slider.locator('[data-slide]');
  const count = await dots.count();
  note(count >= 3, `a multi-photo slider is on the page (${count} dots)`);

  // Tap the third dot: the third photo must be shown, not the second.
  await dots.nth(2).click();
  await page.waitForTimeout(700);
  const index = await slider.evaluate((el) => {
    const track = el.querySelector('[data-track]');
    return Math.round(track.scrollLeft / track.clientWidth);
  });
  note(index === 2, `tapping dot 3 shows photo 3 (showing ${index + 1})`);
  const marked = await slider.evaluate((el) =>
    [...el.querySelectorAll('[data-slide]')].findIndex((d) => d.getAttribute('aria-current') === 'true'));
  note(marked === 2, `the dots agree with the photo (dot ${marked + 1} marked)`);

  // Then back to the first, to check it does not simply step forward.
  await dots.nth(0).click();
  await page.waitForTimeout(700);
  const back = await slider.evaluate((el) => {
    const track = el.querySelector('[data-track]');
    return Math.round(track.scrollLeft / track.clientWidth);
  });
  note(back === 0, `tapping dot 1 goes back to photo 1 (showing ${back + 1})`);

  await ctx.close();
}

await browser.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
