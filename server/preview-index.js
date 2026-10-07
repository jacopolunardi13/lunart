/**
 * The preview's front door.
 *
 * One page, on a phone, that answers the only question somebody opening a
 * demonstration has: where do I start? The guest guide, a real personal link, the
 * Staff app, the venue scanner — and a plain list of what is switched off, because
 * a demo that does not say what it is pretending about is a demo that gets
 * misremembered as a promise.
 *
 * It exists only when `LUNART_PREVIEW` is on, and only ever lists the invented
 * reservations the preview seeds for itself.
 */

export function renderPreviewIndex({ origin, links = [], escapeHtml }) {
  const esc = escapeHtml;
  const link = (href, label, note = '') => `
    <li class="entry">
      <a class="entry__link" href="${esc(href)}">${esc(label)}</a>
      ${note ? `<span class="entry__note">${esc(note)}</span>` : ''}
    </li>`;

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>LunArt — Anteprima</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#16140f">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/css/fonts.css">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: calc(24px + env(safe-area-inset-top)) 16px 48px;
    background: #16140f;
    color: #f4f1ea;
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1.6;
  }
  main { max-width: 32rem; margin: 0 auto; }
  .flag {
    display: inline-block;
    padding: 5px 12px;
    border-radius: 999px;
    background: #c9a227;
    color: #16140f;
    font-size: .74rem;
    font-weight: 700;
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  h1 {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 2rem;
    font-weight: 500;
    margin: 16px 0 6px;
  }
  p.lead { color: #a79e8d; margin: 0 0 28px; }
  h2 {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 1.25rem;
    font-weight: 500;
    margin: 28px 0 10px;
  }
  ul { list-style: none; margin: 0; padding: 0; }
  .entry {
    padding: 14px;
    margin-bottom: 10px;
    background: #201d16;
    border: 1px solid #332e24;
    border-radius: 14px;
  }
  .entry__link {
    display: block;
    min-height: 32px;
    color: #f4f1ea;
    font-size: 1.02rem;
    text-decoration: none;
    border-bottom: 1px solid rgba(201, 162, 39, .5);
    padding-bottom: 2px;
    width: fit-content;
  }
  .entry__note { display: block; margin-top: 6px; color: #a79e8d; font-size: .86rem; }
  .off { color: #a79e8d; font-size: .92rem; }
  .off li { padding: 6px 0 6px 20px; position: relative; }
  .off li::before { content: "·"; position: absolute; left: 6px; color: #c9a227; }
  footer { margin-top: 32px; color: #7d7465; font-size: .8rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
</style>
</head>
<body>
<main>
  <span class="flag">Anteprima</span>
  <h1>LunArt — Guest Guide v2</h1>
  <p class="lead">
    Server completo, dati inventati. Niente pagamenti veri, niente email agli ospiti,
    nessuna casella letta, nessun calendario scritto.
  </p>

  <h2>La guida</h2>
  <ul>
    ${link(`${origin}/`, 'Guida pubblica', 'Come la vede chi apre il sito senza link personale')}
    ${links.map((entry) => link(
    entry.url,
    `Link personale · ${entry.guest}`,
    `${entry.rooms > 1 ? 'Camere' : 'Camera'} ${entry.room} · ${entry.dates}`,
  )).join('')}
    ${link(`${origin}/recover`, 'Ho perso il link', 'Cognome + numero di prenotazione')}
  </ul>

  <h2>Lo staff</h2>
  <ul>
    ${link(`${origin}/staff`, 'LunArt Staff', 'Chiede il token dell’anteprima la prima volta')}
  </ul>

  <h2>I locali</h2>
  <ul>
    ${link(`${origin}/partner/opera-caffe`, 'Opera Caffè', 'La pagina che il locale tiene sulla Home')}
    ${link(`${origin}/validate-card`, 'Verifica card generica', 'Per un locale senza pagina propria')}
  </ul>

  <h2>Cosa è spento</h2>
  <ul class="off">
    <li>Pagamenti: checkout finto interno. Nessuna carta, nessun addebito.</li>
    <li>Email agli ospiti: preparate e conservate, mai spedite.</li>
    <li>Casella QuoVai: non letta. Le prenotazioni qui sono inventate.</li>
    <li>Calendario del professionista: non letto e non scritto.</li>
    <li>Notifiche push: registrate, non inviate.</li>
    <li>Prezzi: inclusi quelli ancora provvisori, per poter provare tutto.</li>
  </ul>

  <footer>
    Ramo <code>fable/guest-guide-v2</code>. Il sito pubblico di LunArt non è toccato da questa anteprima.
  </footer>
</main>
</body>
</html>`;
}
