/**
 * The stand-in for Stripe Checkout.
 *
 * Only reachable when no Stripe key is configured. It exists so the whole purchase
 * — including an authorisation that is captured or released later — can be walked
 * through and tested without an account, and so a reviewer can see what a guest
 * sees rather than read a description of it.
 *
 * It is labelled on the page, in a way that cannot be mistaken for a payment form.
 * It collects no card details, because there is nothing to collect.
 */

const money = (amount, currency = 'EUR') =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format((amount ?? 0) / 100);

export function renderMockCheckout({ session, order, escapeHtml: esc }) {
  const manual = order?.payment_mode === 'authorize-then-capture';

  const lines = (order?.lines ?? []).map((line) => `
    <li class="line">
      <span class="line__name">
        ${esc(line.title)}${line.variant_title ? ` — ${esc(line.variant_title)}` : ''}
        ${line.quantity > 1 ? `<span class="line__qty">×${line.quantity}</span>` : ''}
        ${line.date ? `<span class="line__when">${esc(line.date)}${line.time ? ` · ${esc(line.time)}` : ''}</span>` : ''}
      </span>
      <span class="line__amount">${money(line.amount, order.currency)}</span>
    </li>`).join('');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Pagamento di prova — LunArt</title>
<link rel="stylesheet" href="/assets/css/fonts.css">
<link rel="stylesheet" href="/assets/css/app.css">
<style>
  body { display: grid; place-items: center; min-height: 100dvh; padding: 24px 0; }
  .sheetish { width: min(520px, calc(100vw - 40px)); }
  .banner {
    background: #8a2f2f; color: #fff; border-radius: 12px;
    padding: 14px 16px; font-size: 0.8125rem; line-height: 1.55; margin-bottom: 20px;
  }
  .banner strong { display: block; font-size: 0.6875rem; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 4px; }
  .panel { background: #fff; border: 1px solid var(--ink-faint); border-radius: 16px; padding: 22px 20px; }
  .line { display: flex; justify-content: space-between; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--ink-faint); }
  .line:last-of-type { border-bottom: 0; }
  .line__name { display: flex; flex-direction: column; gap: 3px; }
  .line__qty, .line__when { font-size: 0.75rem; color: var(--ink-quiet); }
  .line__amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .total { display: flex; justify-content: space-between; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--ink-line); font-size: 1.125rem; }
  .total strong { font-family: var(--serif); font-weight: 500; }
  .buttons { display: flex; flex-direction: column; gap: 10px; margin-top: 22px; }
  .buttons .action { justify-content: center; }
  .note { margin-top: 16px; font-size: 0.75rem; color: var(--ink-quiet); line-height: 1.6; }
</style>
</head>
<body>
<main class="sheetish">
  <div class="banner">
    <strong>Ambiente di prova</strong>
    Questa non è una pagina di pagamento. Stripe non è configurato su questo server,
    quindi la guida usa questa schermata al suo posto: nessuna carta viene richiesta
    e nessun importo viene mai addebitato.
  </div>

  <div class="panel">
    <p class="eyebrow">LunArt · ${esc(session.id)}</p>
    <h1 class="serif" style="font-size:1.5rem;margin:6px 0 16px">Riepilogo</h1>
    <ul>${lines || '<li class="line">—</li>'}</ul>
    <div class="total">
      <span>${manual ? 'Da autorizzare' : 'Totale'}</span>
      <strong>${money(session.amount_total, session.currency?.toUpperCase() ?? 'EUR')}</strong>
    </div>

    ${manual ? `<p class="note">
      Questo ordine usa l’autorizzazione con addebito differito: l’importo viene
      bloccato ora e addebitato solo quando il fornitore conferma. Se non conferma,
      l’autorizzazione viene annullata e non viene addebitato nulla.
    </p>` : ''}

    <div class="buttons">
      <button class="action action--primary" type="button" data-pay>
        ${manual ? 'Autorizza (prova)' : 'Paga (prova)'}
      </button>
      <button class="action" type="button" data-cancel>Annulla</button>
    </div>
    <p class="note" id="status" role="status"></p>
  </div>
</main>

<script>
  const session = ${JSON.stringify(session.id)};
  const status = document.getElementById('status');
  async function act(action, button) {
    for (const b of document.querySelectorAll('button')) b.disabled = true;
    status.textContent = 'Un momento…';
    try {
      const response = await fetch('/mock-checkout/' + action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session }),
      });
      const payload = await response.json();
      if (!payload.redirect) throw new Error('nessun redirect');
      location.href = payload.redirect;
    } catch (error) {
      status.textContent = 'Non ha funzionato: ' + error.message;
      for (const b of document.querySelectorAll('button')) b.disabled = false;
    }
  }
  document.querySelector('[data-pay]').addEventListener('click', (e) => act('complete', e.currentTarget));
  document.querySelector('[data-cancel]').addEventListener('click', (e) => act('cancel', e.currentTarget));
</script>
</body>
</html>`;
}
