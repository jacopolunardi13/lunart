/**
 * LunArt Staff.
 *
 * One screen per thing a person does: see what is waiting, work an order, find a
 * reservation, check that the synchronisation is actually running. It talks to the
 * same API the guest side does, so there is nothing to reconcile at the end of a
 * shift — a breakfast marked delivered here is the same record the guest paid for.
 *
 * Deliberately plain: no framework, no build, no router beyond the hash. It is used
 * one-handed on a phone that may be on hotel Wi-Fi, so every screen is one request
 * and every action is one tap with its result shown immediately.
 *
 * The token lives in localStorage on the device. That is the right trade for two
 * phones belonging to two people: it survives the app being closed, it is scoped to
 * this origin, and it is cleared from here when a device is handed on.
 */

const TOKEN_KEY = 'lunart.staff.token';

const state = {
  token: readToken(),
  view: 'dashboard',
  data: {},
  busy: false,
};

const VIEWS = [
  { id: 'dashboard', label: 'Oggi' },
  { id: 'new', label: 'Nuovi' },
  { id: 'awaiting', label: 'Da confermare' },
  { id: 'preparing', label: 'In preparazione' },
  { id: 'completed', label: 'Completati' },
  { id: 'cancelled', label: 'Annullati' },
  { id: 'reservations', label: 'Prenotazioni' },
  { id: 'sync', label: 'Sincronizzazione' },
];

/* ── Plumbing ──────────────────────────────────────────────────────────── */

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

function writeToken(token) {
  state.token = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode: it will work for this session */ }
}

import { roomsIn, roomList } from '../../commerce/rooms.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (amount, currency = 'EUR') => new Intl.NumberFormat('it-IT',
  { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format((amount ?? 0) / 100);

const day = (date) => (date
  ? new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Rome' })
    .format(new Date(`${date}T12:00:00Z`))
  : '—');

/**
 * Statuses in Italian, because the people reading this screen are.
 *
 * The stored values stay as they are — they are an API contract — and only the
 * labels are translated, which is also why an unknown status falls through to
 * itself rather than disappearing.
 */
const LABELS = {
  // Money
  pending: 'in attesa', authorized: 'autorizzato', confirmed: 'confermato',
  paid: 'pagato', cancelled: 'annullato', refunded: 'rimborsato', failed: 'fallito',
  // The thing itself
  'not-required': 'da fare', 'awaiting-confirmation': 'attende conferma',
  'in-preparation': 'in preparazione', 'substitution-requested': 'bottiglia da sostituire',
  declined: 'rifiutato', delivered: 'consegnato', completed: 'completato',
  // Reservations
  active: 'attiva', modified: 'modificata',
  // Deliveries
  scheduled: 'programmata', sent: 'inviata', simulated: 'simulata', unsendable: 'senza indirizzo',
  none: 'nessuna',
};
const label = (value) => LABELS[value] ?? String(value ?? '');

/**
 * "Camera 303", or "Camere 302, 303, 304 e 305".
 *
 * A booking is not always one room, and the first version of this screen said
 * "Camera 305 · 7 ospiti" for a party of seven spread across four of them — the
 * one number it had, presented as the answer. Takes a reservation or any row that
 * carries `rooms`, and answers with `none` when the room is genuinely not known
 * yet, which is what a provisional stay from a calendar feed looks like.
 */
const roomsText = (entry, none = '') => {
  const list = roomsIn(entry);
  if (list.length === 0) return none;
  return `${list.length === 1 ? 'Camera' : 'Camere'} ${roomList(list)}`;
};

const stamp = (iso) => (iso
  ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
    .format(new Date(iso))
  : '—');

/**
 * One request. A 401 means the token is wrong, which is the only error worth
 * interrupting somebody for: everything else is shown in place.
 */
async function api(path, { method = 'GET', body, keepBody = false } = {}) {
  const response = await fetch(`/api/staff${path}`, {
    method,
    headers: {
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    showGate('Token rifiutato.');
    throw Object.assign(new Error('unauthorised'), { handled: true });
  }
  const payload = await response.json().catch(() => ({}));
  // Some answers are refusals with something to say — "no mailbox is configured" is
  // a 503 and is exactly what the screen should print. Those are kept, not thrown.
  if (keepBody) return { status: response.status, ...payload };
  if (!response.ok) throw Object.assign(new Error(payload.error ?? payload.reason ?? `errore ${response.status}`), { payload });
  return payload;
}

const $ = (selector) => document.querySelector(selector);

function showGate(note = '') {
  const gate = $('#gate');
  gate.hidden = false;
  const message = $('#gate-note');
  message.hidden = !note;
  message.textContent = note;
}

/* ── Rendering ─────────────────────────────────────────────────────────── */

function renderTabs() {
  const counts = state.data.counts ?? {};
  $('#tabs').innerHTML = VIEWS.map((view) => {
    const count = counts[view.id];
    return `<button class="tab" type="button" data-view="${view.id}"
      aria-current="${view.id === state.view ? 'page' : 'false'}">
      ${esc(view.label)}${count ? `<span class="count">${count}</span>` : ''}
    </button>`;
  }).join('');
}

function paint(html) {
  $('#main').innerHTML = html;
  $('#main').scrollTop = 0;
}

async function render() {
  renderTabs();
  try {
    if (state.view === 'dashboard') await renderDashboard();
    else if (state.view === 'reservations') await renderReservations();
    else if (state.view === 'sync') await renderSync();
    else await renderQueue(state.view);
  } catch (error) {
    if (error.handled) return;
    paint(`<div class="banner" data-tone="bad">Non riesco a leggere i dati: ${esc(error.message)}</div>`);
  }
  renderTabs();
}

async function renderDashboard() {
  const data = await api('/dashboard');
  state.data.counts = data.orders;
  $('#push-state').dataset.on = String(Boolean(data.push?.configured));

  const stat = (value, label, tone = '') =>
    `<div class="stat" ${tone ? `data-tone="${tone}"` : ''}><span class="stat__value">${value}</span><span class="stat__label">${esc(label)}</span></div>`;

  paint(`
    ${data.alerts > 0 ? `<div class="banner" data-tone="warn">
      ${data.alerts} ${data.alerts === 1 ? 'cosa' : 'cose'} da verificare.
      <div class="actions"><button class="action" type="button" data-go="sync">Apri sincronizzazione</button></div>
    </div>` : ''}

    <h2>Ordini</h2>
    <div class="grid">
      ${stat(data.orders.new ?? 0, 'Nuovi', data.orders.new ? 'warn' : '')}
      ${stat(data.orders.awaiting ?? 0, 'Da confermare', data.orders.awaiting ? 'warn' : '')}
      ${stat(data.orders.preparing ?? 0, 'In corso')}
      ${stat(data.orders.completed ?? 0, 'Completati')}
    </div>

    <h2>Oggi · ${esc(day(data.today))}</h2>
    <div class="grid">
      ${stat(data.arrivals.length, 'Arrivi')}
      ${stat(data.departures.length, 'Partenze')}
      ${stat(data.inHouse, 'In casa')}
    </div>

    ${/**
      * Lines the guests themselves called off.
      *
      * Near the top because it is the one change on this screen nobody at LunArt
      * made: a cancelled breakfast that the kitchen does not see is a breakfast
      * that goes up anyway. The money is already settled by the time it appears.
      */''}
    ${(data.guestCancellations ?? []).length ? `<h2>Annullati dagli ospiti</h2>
      ${data.guestCancellations.map((entry) => `
        <div class="row">
          <div class="row__head">
            <span class="row__title">${esc(entry.title)}${entry.quantity > 1 ? ` ×${esc(entry.quantity)}` : ''}</span>
            <span class="row__amount">${esc(money(entry.amount, 'EUR'))}</span>
          </div>
          <p class="row__meta">
            ${entry.room ? `Camera ${esc(entry.room)}` : ''}
            ${entry.date ? ` · era per ${esc(day(entry.date))}${entry.time ? ` ${esc(entry.time)}` : ''}` : ''}
            · <span class="pill" data-tone="${entry.outcome === 'refunded' ? 'good' : 'warn'}">${esc(CANCEL_OUTCOMES[entry.outcome] ?? entry.outcome)}</span>
          </p>
          <p class="row__meta">${esc(stamp(entry.at))} · ordine <span class="mono">${esc(entry.reference)}</span></p>
        </div>`).join('')}` : ''}

    ${data.arrivals.length ? `<h2>Arrivi</h2>${data.arrivals.map(reservationRow).join('')}` : ''}
    ${data.departures.length ? `<h2>Partenze</h2>${data.departures.map(reservationRow).join('')}` : ''}

    ${data.next.length ? `<h2>In arrivo</h2>${data.next.map((item) => `
      <div class="row">
        <div class="row__head">
          <span class="row__title">${esc(item.title)}</span>
          <span class="row__amount">${esc(day(item.date))}${item.time ? ` · ${esc(item.time)}` : ''}</span>
        </div>
        <p class="row__meta">${item.room ? `Camera ${esc(item.room)}` : 'Camera da confermare'}</p>
      </div>`).join('')}` : ''}

    ${data.push?.configured ? '' : `<p class="note">Le notifiche push non sono configurate: l’app funziona, ma non arriva nulla sul telefono.</p>`}
  `);
}

/** One order, with only the buttons that make sense for where it is. */
function orderRow(order) {
  const tone = { new: 'warn', awaiting: 'warn', preparing: '', completed: 'good', cancelled: 'bad' }[order.queue] ?? '';
  const lines = order.lines.map((line) => `
    <div class="row__fields">
      <div><span>${esc(line.title)}${line.variant_title ? ` — ${esc(line.variant_title)}` : ''}</span><span>${esc(money(line.amount, order.currency))}</span></div>
      <div><span>Quando</span><span>${esc(day(line.date))}${line.time ? ` · ${esc(line.time)}` : ''}${line.slot_id ? ` · ${esc(line.slot_id.replace(/^[a-z]-/, '').replace(/(\d{2})(\d{2})/, '$1:$2'))}` : ''}</span></div>
      ${line.room ? `<div><span>Camera</span><span>${esc(line.room)}</span></div>` : ''}
      ${Object.entries(line.options ?? {}).map(([key, value]) => `<div><span>${esc(key)}</span><span>${esc(value)}</span></div>`).join('')}
      ${Object.entries(line.fields ?? {}).map(([key, value]) => `<div><span>${esc(key)}</span><span>${esc(value)}</span></div>`).join('')}
      ${line.cancellable_until ? `<div><span>Annullabile fino a</span><span>${esc(stamp(line.cancellable_until))}</span></div>` : ''}
      ${line.cancelled_quantity ? `<div><span>Annullato</span><span>
        ${esc(line.cancelled_quantity)}${line.quantity > 1 ? ` di ${esc(line.quantity)}` : ''}
        ${line.cancelled_by ? `· ${esc(line.cancelled_by === 'guest' ? 'dall’ospite' : 'dallo staff')}` : ''}
        ${line.refunded_amount ? `· rimborsati ${esc(money(line.refunded_amount, order.currency))}` : ''}
      </span></div>` : ''}
    </div>`).join('');

  return `<div class="row" data-order="${esc(order.id)}">
    <div class="row__head">
      <span class="row__title">${order.express ? '<span class="pill pill--express">Express</span> ' : ''}${esc(order.lines[0]?.title ?? 'Ordine')}</span>
      <span class="row__amount">${esc(money(order.amount, order.currency))}</span>
    </div>
    <p class="row__meta">
      ${esc(order.customer.name || '—')}${order.customer.room ? ` · camera ${esc(order.customer.room)}` : ''}
      · <span class="pill" data-tone="${tone}">${esc(label(order.status))}</span>
      <span class="pill">${esc(label(order.fulfilment_status))}</span>
      ${order.provider?.assignee ? `<span class="pill">${esc(order.provider.assignee)}</span>` : ''}
      ${order.guest_cancelled ? '<span class="pill" data-tone="bad">annullato dall’ospite</span>' : ''}
      ${order.refunded_amount && order.status !== 'refunded'
        ? `<span class="pill" data-tone="warn">rimborsati ${esc(money(order.refunded_amount, order.currency))}</span>` : ''}
    </p>
    ${lines}
    <div class="actions">
      ${order.status === 'authorized' ? `
        <button class="action action--primary" type="button" data-action="confirm">Conferma e incassa</button>
        <button class="action action--danger" type="button" data-action="reject">Rifiuta e libera</button>` : ''}
      ${['new', 'awaiting'].includes(order.queue) ? '<button class="action" type="button" data-action="preparing">In preparazione</button>' : ''}
      ${order.queue !== 'completed' && order.queue !== 'cancelled' ? '<button class="action" type="button" data-action="completed">Completato</button>' : ''}
      ${order.lines.some((l) => l.product_id === 'wine-in-room') && order.queue !== 'cancelled'
        ? '<button class="action" type="button" data-action="substitution">Bottiglia non disponibile</button>' : ''}
      <button class="action" type="button" data-contact>Contatta</button>
      ${order.queue !== 'cancelled' ? '<button class="action action--danger" type="button" data-action="cancel">Annulla</button>' : ''}
      ${order.status === 'paid' ? '<button class="action action--danger" type="button" data-action="refund">Rimborsa</button>' : ''}
    </div>
    <div data-contact-panel hidden></div>
  </div>`;
}

async function renderQueue(queue) {
  const data = await api(`/orders?queue=${encodeURIComponent(queue)}`);
  state.data.counts = data.counts;
  paint(data.orders.length
    ? data.orders.map(orderRow).join('')
    : '<p class="empty">Niente in questa coda.</p>');
}

/** The fields a provisional stay is still missing, in words rather than in keys. */
const FIELD_NAMES = {
  first_name: 'nome', last_name: 'cognome', guest_email: 'email', guest_phone: 'telefono',
};

function reservationRow(reservation) {
  const tone = { active: 'good', modified: 'warn', cancelled: 'bad', completed: '' }[reservation.status] ?? '';
  const missing = reservation.incomplete ?? [];
  return `<details class="row" data-reservation="${esc(reservation.id)}"${reservation.provisional ? ' data-provisional' : ''}>
    <summary>
      <div class="row__head">
        <span class="row__title">${esc([reservation.first_name, reservation.last_name].filter(Boolean).join(' ') || 'Ospite da identificare')}</span>
        <span class="row__amount">${esc(day(reservation.check_in))} → ${esc(day(reservation.check_out))}</span>
      </div>
      <p class="row__meta">
        ${esc(roomsText(reservation, 'camera da assegnare'))}
        · ${esc(reservation.guest_count ?? 0)} ospiti
        · <span class="pill" data-tone="${tone}">${esc(label(reservation.status))}</span>
        ${reservation.channel ? `<span class="pill">${esc(reservation.channel)}</span>` : ''}
        ${reservation.provisional ? '<span class="pill" data-tone="warn">provvisoria</span>' : ''}
      </p>
      ${missing.length ? `<p class="row__meta row__meta--warn">Dati ospite da completare: ${esc(missing.map((f) => FIELD_NAMES[f] ?? f).join(', '))}</p>` : ''}
    </summary>
    ${reservation.provisional ? `<p class="note">
      Creata dal calendario: sappiamo che la camera è occupata, non chi arriva.
      Nessuna email è stata programmata. Quando arriva la notifica QuoVai questa
      scheda si completa da sola, senza creare una seconda prenotazione.
    </p>` : ''}
    <div class="row__fields">
      <div><span>Prenotazione</span><span class="mono">${esc(reservation.booking_reference || '—')}</span></div>
      <div><span>Riferimento LunArt</span><span class="mono">${esc(reservation.staff_ref || '—')}</span></div>
      <div><span>Email</span><span>${esc(reservation.guest_email || '—')}</span></div>
      <div><span>Telefono</span><span>${esc(reservation.guest_phone || '—')}</span></div>
      <div><span>Email guida</span><span>${esc(label(reservation.guide_email_status))}${reservation.guide_email_sent_at ? ` · ${esc(stamp(reservation.guide_email_sent_at))}` : ''}</span></div>
      ${reservation.notes ? `<div><span>Note</span><span>${esc(reservation.notes)}</span></div>` : ''}
    </div>
    <div class="actions">
      <button class="action" type="button" data-link>Copia link guida</button>
      <button class="action" type="button" data-link-rotate>Rigenera link</button>
      <button class="action" type="button" data-edit>Modifica</button>
      ${reservation.status !== 'cancelled' ? '<button class="action action--danger" type="button" data-cancel>Annulla</button>' : ''}
    </div>
    <div data-reservation-panel hidden></div>
  </details>`;
}

/**
 * The groups, in the order a person works them, and what each one is called.
 *
 * History is last and closed, because it is the only group nobody is looking for
 * until they are looking for one specific thing in it.
 */
const GROUP_NAMES = {
  'in-house': 'In casa adesso',
  'arriving-today': 'Arrivi di oggi',
  'arriving-soon': 'Arrivi nei prossimi giorni',
  upcoming: 'Prossimi soggiorni',
  incomplete: 'Date da sistemare',
  history: 'Storico',
};

async function renderReservations() {
  const data = await api('/reservations');
  const groups = data.groups ?? {};
  const order = data.order ?? Object.keys(groups);

  const group = (id) => {
    const rows = groups[id] ?? [];
    if (rows.length === 0) return '';
    if (id === 'history') {
      return `<details class="row"><summary><div class="row__head">
          <span class="row__title">${esc(GROUP_NAMES.history)}</span>
          <span class="row__amount">${rows.length}</span>
        </div></summary>${rows.map(reservationRow).join('')}</details>`;
    }
    return `<h3 class="group">${esc(GROUP_NAMES[id] ?? id)} <span class="group__count">${rows.length}</span></h3>
      ${rows.map(reservationRow).join('')}`;
  };

  paint(`
    <h2>Prenotazioni</h2>
    ${data.needsData ? `<p class="note note--warn">${data.needsData} ${data.needsData === 1 ? 'soggiorno ha' : 'soggiorni hanno'} dati ospite da completare.</p>` : ''}
    ${order.some((id) => (groups[id] ?? []).length) ? order.map(group).join('') : '<p class="empty">Nessuna prenotazione.</p>'}

    <h2>Inserimento manuale</h2>
    <p class="note">Da usare quando la notifica non è arrivata. Il resto funziona uguale: link personale e email programmata.</p>
    <form id="manual">
      <div class="field--pair">
        <label class="field"><span class="field__label">Nome</span><input name="first_name" required></label>
        <label class="field"><span class="field__label">Cognome</span><input name="last_name" required></label>
      </div>
      <div class="field--pair">
        <label class="field"><span class="field__label">Check-in</span><input type="date" name="check_in" required></label>
        <label class="field"><span class="field__label">Check-out</span><input type="date" name="check_out" required></label>
      </div>
      <div class="field--pair">
        <label class="field"><span class="field__label">Camera</span>
          <select name="room">
            <option value="">—</option>
            ${['301', '302', '303', '304', '305'].map((room) => `<option value="${room}">${room}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span class="field__label">N. prenotazione</span><input name="booking_reference"></label>
      </div>
      <div class="field--pair">
        <label class="field"><span class="field__label">Adulti</span><input type="number" name="adults" value="2" min="1" max="6"></label>
        <label class="field"><span class="field__label">Bambini</span><input type="number" name="children" value="0" min="0" max="4"></label>
      </div>
      <label class="field"><span class="field__label">Email</span><input type="email" name="guest_email"></label>
      <label class="field"><span class="field__label">Telefono</span><input name="guest_phone"></label>
      <label class="field"><span class="field__label">Lingua</span>
        <select name="lang"><option value="it">Italiano</option><option value="en">English</option></select>
      </label>
      <label class="field"><span class="field__label">Note</span><textarea name="notes"></textarea></label>
      <div class="actions"><button class="action action--primary" type="submit">Crea prenotazione</button></div>
    </form>
    <div id="manual-result"></div>
  `);
}

/**
 * What the repair did, in the five numbers that matter.
 *
 * Staff ran this because something looked wrong; a JSON dump is not an answer to
 * that. Each reservation it corrected is named with the fields it filled in, so
 * the result can be checked against the Prenotazioni list without trusting it.
 */
function repairSummary(result) {
  const counts = [
    ['Lette', result.scanned],
    ['Prenotazioni', result.reservations],
    ['Trovate', result.matched],
    ['Corrette', result.repaired],
    ['Già a posto', result.unchanged],
    ['Non nostre', result.ignored],
    ['Senza riscontro', result.unmatched],
    ['Illeggibili', result.failed],
  ];

  const changes = (result.changes ?? []).map((change) => `
    <li><strong>${esc(change.guest || change.booking_reference)}</strong>
      <span class="mono">${esc(change.booking_reference)}</span> ·
      ${esc(change.fields.join(', '))}</li>`).join('');

  const problems = (result.problems ?? []).map((problem) => `
    <li>${esc(problem.booking_reference ?? problem.subject ?? '')} — ${esc(problem.reason)}</li>`).join('');

  return `<div class="banner" data-tone="${result.failed > 0 ? 'warn' : ''}">
    <p>${counts.map(([label, value]) => `${esc(label)}: <strong>${Number(value ?? 0)}</strong>`).join(' · ')}</p>
    ${changes ? `<ul class="repair__list">${changes}</ul>` : '<p class="note">Nessuna correzione da fare.</p>'}
    ${problems ? `<p class="note">Da guardare:</p><ul class="repair__list">${problems}</ul>` : ''}
  </div>`;
}

/**
 * What the backfill recovered.
 *
 * Every reservation it created is named with its dates, because the only way to
 * trust a number like "17 created" is to recognise a few of the names in it.
 */
function backfillSummary(result) {
  const counts = [
    ['Lette', result.scanned],
    ['Prenotazioni', result.reservationEvents],
    ['Create', result.created],
    ['Modificate', result.modified],
    ['Annullate', result.cancelled],
    ['Già note', result.duplicates + result.unchanged],
    ['Non nostre', result.ignored],
    ['Illeggibili', result.failed],
  ];

  const recovered = (result.recovered ?? []).map((row) => `
    <li><strong>${esc(row.guest || row.booking_reference)}</strong>
      ${row.room ? `· ${esc(roomsText(row).toLowerCase())}` : ''}
      · ${esc(row.check_in)} → ${esc(row.check_out)}
      <span class="mono">${esc(row.booking_reference)}</span></li>`).join('');

  const problems = (result.problems ?? []).map((p) => `
    <li>${esc(p.subject ?? '')} — ${esc(p.reason)}</li>`).join('');

  return `<div class="banner" data-tone="${result.failed > 0 ? 'warn' : ''}">
    <p>${counts.map(([label, value]) => `${esc(label)}: <strong>${Number(value ?? 0)}</strong>`).join(' · ')}</p>
    ${recovered ? `<p class="note">Recuperate:</p><ul class="repair__list">${recovered}</ul>`
    : '<p class="note">Nessuna prenotazione nuova da recuperare.</p>'}
    ${problems ? `<p class="note">Da guardare:</p><ul class="repair__list">${problems}</ul>` : ''}
  </div>`;
}

/** Why a reservation is not in the catch-up. Mirrors CATCHUP_SKIP on the server. */
const CATCHUP_REASONS = {
  'already-sent': 'guida già inviata',
  cancelled: 'annullate',
  past: 'soggiorno concluso',
  /** Live and complete; the scheduler writes to them three days before they arrive. */
  'not-due-yet': 'non ancora in scadenza',
  provisional: 'provvisorie',
  'no-email': 'senza indirizzo email',
  'no-token': 'senza link personale',
  'no-dates': 'senza date',
  other: 'altro',
};

/**
 * Who the catch-up would write to — and, first of all, that it has not.
 *
 * The one sentence a person needs before reading anything else is that nothing
 * has been sent, so it is the first line and it is in bold. After that the three
 * numbers, then why each exclusion happened, then the list itself: a count of
 * "28 ospiti" is only trustworthy if you can recognise four or five names in it.
 *
 * The addresses arrive masked from the server and are printed as they arrive.
 */
function catchUpPreviewSummary(result) {
  const breakdown = Object.entries(result.breakdown ?? {})
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${esc(CATCHUP_REASONS[reason] ?? reason)}: <strong>${Number(count)}</strong>`)
    .join(' · ');

  const rows = (result.rows ?? []).map((r) => `
    <li><strong>${esc(r.guest || r.reference || '—')}</strong>
      ${r.rooms?.length ? `· ${esc(roomsText(r).toLowerCase())}` : ''}
      · ${esc(day(r.check_in))} → ${esc(day(r.check_out))}
      <span class="mono">${esc(r.email)}</span>
      <span class="mono">${esc(r.reference)} · ${esc(label(r.delivery_status))}</span></li>`).join('');

  /**
   * The ones the scheduler is going to handle on its own.
   *
   * Listed with the morning each one is due, because "non ancora in scadenza" is a
   * verdict and a date is a fact — and because the question a person will have
   * when they see a short list is "then what happens to the others?". This is the
   * answer: nothing, they go out by themselves at the usual hour.
   */
  const waiting = (result.skipped ?? [])
    .filter((r) => r.reason === 'not-due-yet')
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))
    .map((r) => `
      <li><strong>${esc(r.guest || r.reference || '—')}</strong>
        · ${esc(day(r.check_in))} → ${esc(day(r.check_out))}
        <span class="mono">parte ${esc(stamp(r.due_at))}</span></li>`).join('');

  return `<div class="banner" data-tone="${result.eligible > 0 ? 'warn' : ''}">
    <p><strong>Nessuna email è stata inviata.</strong> Questo è solo il controllo.</p>
    <p>Prenotazioni lette: <strong>${Number(result.considered ?? 0)}</strong> ·
      riceverebbero la guida: <strong>${Number(result.eligible ?? 0)}</strong> ·
      escluse: <strong>${Number(result.excluded ?? 0)}</strong></p>
    ${breakdown ? `<p class="note">Escluse perché — ${breakdown}</p>` : ''}
    ${rows
      ? `<p class="note">Riceverebbero la guida:</p><ul class="repair__list">${rows}</ul>`
      : '<p class="note">Nessun ospite da recuperare: sono già tutti a posto.</p>'}
    ${waiting ? `<p class="note">
      Queste non sono in ritardo: la guida parte da sé tre giorni prima
      dell’arrivo, alle 10:00. Questa operazione non le tocca.</p>
      <ul class="repair__list">${waiting}</ul>` : ''}
    ${result.mailerConfigured === false && result.eligible > 0
      ? `<p class="note note--warn">Nessun provider email configurato: premendo
          “Invia” le email verrebbero preparate e registrate come
          <em>simulate</em>, senza partire davvero.</p>`
      : ''}
  </div>`;
}

/** And what it did. The three outcomes are kept apart, because they are not the same. */
function catchUpSendSummary(result) {
  if (result.ok === false) {
    return `<div class="banner" data-tone="bad">
      <p>Invio non eseguito: serviva una conferma esplicita. Non è partito niente.</p>
    </div>`;
  }

  const rows = (result.results ?? []).map((r) => `
    <li><strong>${esc(r.guest || r.reservation_id)}</strong> · ${esc(label(r.status))}
      ${r.error ? `<span class="mono">${esc(r.error)}</span>` : ''}</li>`).join('');

  const wrong = (result.failed ?? 0) > 0 || (result.simulated ?? 0) > 0;
  return `<div class="banner" data-tone="${wrong ? 'warn' : ''}">
    <p>Tentate: <strong>${Number(result.attempted ?? 0)}</strong> ·
      inviate: <strong>${Number(result.sent ?? 0)}</strong> ·
      simulate: <strong>${Number(result.simulated ?? 0)}</strong> ·
      non riuscite: <strong>${Number(result.failed ?? 0)}</strong></p>
    <p class="note">Provider: ${esc(result.provider ?? '—')}.${result.simulated
      ? ' Le simulate non sono partite: non c’è nessun provider configurato, e quegli ospiti restano da recuperare.'
      : ''}</p>
    ${result.stale ? `<p class="note note--warn">
      Il controllo che hai davanti diceva ${Number(result.expected)} ospiti; al momento
      dell’invio erano ${Number(result.attempted ?? 0)}. Il server ha ricalcolato chi è
      davvero in scadenza, e ha scritto solo a quelli.</p>` : ''}
    ${rows ? `<ul class="repair__list">${rows}</ul>` : '<p class="note">Nessun ospite da recuperare.</p>'}
  </div>`;
}

/**
 * What the reconciliation did, in the two facts that matter.
 *
 * Which cards stopped working is the one a person has to be able to read back: a
 * revoked Privilege Card is a guest whose QR will not open a door this evening, and
 * if that was not meant, somebody needs to know tonight rather than next week.
 */
function refundReconcileSummary(result) {
  if (result.ok === false) {
    const why = {
      'not-confirmed': 'Serviva una conferma esplicita: non \u00e8 stato cambiato niente.',
      'not-reconcilable': `L\u2019ordine \u00e8 in stato \u201c${esc(label(result.status))}\u201d: solo un ordine pagato pu\u00f2 essere riconciliato.`,
      'not-found': 'Nessun ordine con quel riferimento.',
      'no-order-given': 'Nessun ordine indicato.',
    }[result.error ?? result.reason] ?? esc(result.error ?? result.reason ?? 'non eseguito');
    return `<div class="banner" data-tone="bad"><p>${why}</p></div>`;
  }

  if (result.action === 'unchanged') {
    return `<div class="banner">
      <p>Era gi\u00e0 riconciliato: niente da cambiare.</p>
      <p class="note">Ordine <span class="mono">${esc(result.order?.reference ?? '')}</span>
        \u00b7 ${esc(label(result.order?.status ?? ''))}</p>
    </div>`;
  }

  return `<div class="banner" data-tone="warn">
    <p>Ordine <span class="mono">${esc(result.order?.reference ?? '')}</span> segnato come
      <strong>rimborsato</strong> per ${esc(money(result.refunded_amount, result.order?.currency))}.</p>
    ${result.revoked?.length
      ? `<p class="note">Card revocate: <span class="mono">${esc(result.revoked.join(', '))}</span>.
          Il QR non funziona pi\u00f9 e i vantaggi partner non valgono pi\u00f9.</p>`
      : '<p class="note">Nessuna card da revocare su questo ordine.</p>'}
    <p class="note">Nessun soldo \u00e8 stato mosso: il rimborso era gi\u00e0 stato fatto su Stripe.</p>
  </div>`;
}

/**
 * What the test notification actually did.
 *
 * Three things can be wrong and each needs a different person to do a different
 * thing: no device has registered yet — open the app on the phone and allow
 * notifications; no keys are configured — an environment variable on the server;
 * the push service refused — nothing to do but read the error. Saying "non
 * funziona" would send somebody looking in the wrong place.
 *
 * Subscription endpoints are not printed. They are per-device addresses and the
 * screen has no use for them.
 */
function pushTestSummary(result) {
  if (!result.devices) {
    return `<div class="banner" data-tone="warn">
      <p>Nessun telefono registrato: non c’è dove mandarla.</p>
      <p class="note">Aprire questa app sul telefono, consentire le notifiche, e riprovare.</p>
    </div>`;
  }

  const errors = (result.results ?? []).filter((r) => r.error);
  return `<div class="banner" data-tone="${result.simulated || errors.length ? 'warn' : ''}">
    <p>Telefoni registrati: <strong>${Number(result.devices ?? 0)}</strong> ·
      consegnate: <strong>${Number(result.delivered ?? 0)}</strong>${result.removed
        ? ` · registrazioni scadute rimosse: <strong>${Number(result.removed)}</strong>` : ''}</p>
    ${result.simulated
      ? `<p class="note note--warn">Nessuna chiave configurata: la notifica è stata
          registrata ma non è partita. Sul server servono
          <span class="mono">VAPID_PUBLIC_KEY</span>,
          <span class="mono">VAPID_PRIVATE_KEY</span> e
          <span class="mono">VAPID_SUBJECT</span>.</p>`
      : '<p class="note">Controllare che sia arrivata su tutti i telefoni che dovrebbero averla.</p>'}
    ${errors.map((r) => `<p class="note note--warn">${esc(r.error)}</p>`).join('')}
  </div>`;
}

async function renderSync() {
  const data = await api('/sync');

  /**
   * One row per integration, saying which of four things is true.
   *
   * The distinction is the whole point of this screen: "credenziali mancanti" is
   * somebody filling in an environment variable, "non raggiungibile" is Google
   * having a bad morning and nothing to do, and "disattivato" is a deliberate
   * choice. Lumping them together as "not working" would send Jacopo looking for
   * a bug that is not there.
   */
  const stateOf = (entry) => {
    if (entry?.implemented === false) return 'non implementato';
    if (!entry?.configured) return 'credenziali mancanti';
    if (entry.lastError) return 'non raggiungibile';
    if (entry.enabled === false) return 'configurato, non schedulato';
    return 'operativo';
  };
  const toneOf = (entry) => {
    const state = stateOf(entry);
    if (state === 'operativo') return 'good';
    if (state === 'non raggiungibile') return 'bad';
    return 'warn';
  };

  const row = (label, entry, detail = '') => `
    <div class="row">
      <div class="row__head">
        <span class="row__title">${esc(label)}</span>
        <span class="pill" data-tone="${toneOf(entry)}">${esc(stateOf(entry))}</span>
      </div>
      ${detail ? `<p class="row__meta">${esc(detail)}</p>` : ''}
      ${entry?.lastError ? `<p class="row__meta">Ultimo errore: ${esc(entry.lastError)}</p>` : ''}
      ${!entry?.configured && entry?.requires?.length
        ? `<div class="row__fields"><div><span>Serve</span><span class="mono">${esc(entry.requires.join(', '))}</span></div></div>`
        : ''}
      ${entry?.lastSuccessAt ? `<p class="row__meta">Ultimo successo: ${esc(stamp(entry.lastSuccessAt))}</p>` : ''}
    </div>`;

  const jobs = data.schedule ?? [];
  const jobRow = (job) => `
    <div class="row">
      <div class="row__head">
        <span class="row__title">${esc(JOB_NAMES[job.id] ?? job.id)}</span>
        <span class="pill" data-tone="${job.status === 'operational' ? 'good' : job.status === 'failing' ? 'bad' : 'warn'}">${esc(JOB_STATES[job.status] ?? job.status)}</span>
      </div>
      <p class="row__meta">${job.enabled ? `ogni ${job.intervalMinutes} min` : 'non schedulato'}${job.lastSuccessAt ? ` · ultimo ok ${esc(stamp(job.lastSuccessAt))}` : ''}</p>
      ${job.lastError ? `<p class="row__meta">${esc(job.lastError)}</p>` : ''}
      <div class="actions"><button class="action" type="button" data-job="${esc(job.id)}">Esegui ora</button></div>
    </div>`;

  paint(`
    <h2>Integrazioni</h2>
    ${row('Lettura notifiche QuoVai', data.mailbox, data.mailbox?.id ? `Sorgente: ${data.mailbox.id}` : 'Nessuna casella collegata')}
    ${row('Invio email agli ospiti', data.mail, `Provider: ${data.mail?.provider ?? '—'}${data.mail?.configured ? '' : ' — le email vengono preparate ma non spedite'}`)}
    ${row('Notifiche push', data.push, data.push?.configured ? `Trasporto: ${data.push.transport}` : 'L’app funziona lo stesso: si aggiorna da sola quando la apri')}
    ${row('Calendario del professionista', data.calendar, data.calendar?.id ?? '')}
    <div class="actions">
      <button class="action" type="button" data-push-test="now">Invia una notifica di prova</button>
    </div>
    <p class="note">
      Arriva su ogni telefono che ha aperto e autorizzato questa app. È la verifica
      da fare in partenza: aprite l’app sui due telefoni, premete qui una volta e
      controllate che la notifica arrivi su entrambi. Le chiavi si configurano come
      variabili d’ambiente sul server — non si vedono e non si impostano da qui.
    </p>
    <div id="push-result"></div>

    <h2>Sincronizzazione prenotazioni</h2>
    <p class="note">
      Tre operazioni diverse, con tre esiti diversi. Il polling tiene il passo con
      quello che arriva; il recupero storico riprende quello che non è mai arrivato;
      il calendario è la rete di sicurezza. Qui ognuna dice per conto suo quando è
      andata bene l’ultima volta e cosa ha trovato.
    </p>
    ${SYNC_JOBS.map((id) => syncJobRow(id, data.jobs?.[id])).join('')}

    <h2>Processi automatici</h2>
    ${jobs.length ? jobs.map(jobRow).join('') : '<p class="note">Nessun processo schedulato.</p>'}
    <div class="actions">
      <button class="action" type="button" data-sync="poll">Leggi le notifiche</button>
      <button class="action" type="button" data-sync="reconcile">Confronta i calendari</button>
      <button class="action" type="button" data-sync="send-emails">Invia le email in scadenza</button>
    </div>

    <h2>Invio iniziale Guest Guide</h2>
    <p class="note">
      Una volta sola, in partenza. La regola normale non cambia e questa operazione
      non la tocca: la guida parte tre giorni prima dell’arrivo, alle 10:00 ora di
      Firenze. Questo serve per le prenotazioni già in archivio, il cui momento è
      passato prima che l’invio fosse attivo — altrimenti a quelle persone non
      scriverebbe nessuno.
    </p>
    <p class="note">
      <strong>Controlla destinatari</strong> non manda niente: legge e mostra chi
      riceverebbe, chi no e per quale motivo. <strong>Invia</strong> scrive davvero
      agli ospiti e non si può annullare. Chi ha già ricevuto la guida resta sempre
      fuori, quindi un secondo lancio non manda doppioni.
    </p>
    <div class="actions">
      <button class="action" type="button" data-catchup="preview">Controlla destinatari</button>
      <button class="action action--danger" type="button" data-catchup="send" disabled>Invia Guest Guide agli ospiti selezionati</button>
    </div>
    <p class="note" id="catchup-hint">L’invio si sblocca dopo il controllo.</p>
    <div id="catchup-result"></div>

    <h2>Riparazione</h2>
    <p class="note">
      Rilegge le notifiche QuoVai recenti con il parser aggiornato e corregge le
      prenotazioni già salvate — nome e camera, dove mancavano. Non crea niente,
      non sposta le date, non tocca il link dell’ospite e non manda nessuna email.
      Si può lanciare due volte senza conseguenze.
    </p>
    <div class="actions">
      <button class="action" type="button" data-sync="repair">Ripara prenotazioni QuoVai</button>
    </div>

    <h2>Recupero storico</h2>
    <p class="note">
      Il polling normale guarda solo gli ultimi giorni. Questo rilegge un anno di
      notifiche QuoVai e recupera le prenotazioni che non sono mai arrivate — quelle
      prenotate settimane fa per un soggiorno che deve ancora iniziare. Non duplica
      niente, non rigenera i link e non manda nessuna email. Si può rilanciare.
    </p>
    <div class="actions">
      <button class="action" type="button" data-sync="backfill">Ricostruisci prenotazioni da QuoVai</button>
    </div>

    <h2>Rimborso già effettuato su Stripe</h2>
    <p class="note">
      Solo per il caso raro di un rimborso fatto su un account Stripe diverso, il cui
      webhook non arriva qui. <strong>Non chiama Stripe e non muove soldi</strong>:
      il rimborso è già avvenuto e verificato, e questo serve solo a farlo sapere a
      LunArt. Segna l’ordine come rimborsato per l’intero importo e revoca la
      Privilege Card che quell’ordine aveva emesso — il QR smette di funzionare e i
      vantaggi partner non valgono più. Lo storico resta. Si può rilanciare: la
      seconda volta non cambia niente.
    </p>
    <div class="actions">
      <button class="action action--danger" type="button" data-refund-reconcile>
        Riconcilia un rimborso esterno
      </button>
    </div>
    <div id="refund-reconcile-result"></div>

    <h2>Calendario iCal</h2>
    <p class="note">
      La rete di sicurezza. Confronta l’occupancy dei calendari con le prenotazioni
      che abbiamo: dove il calendario dice che una camera è occupata e noi non
      abbiamo niente, crea una <strong>prenotazione provvisoria</strong> con i soli
      dati del feed. Non inventa nome, email, telefono, canale o numero di
      prenotazione, e non manda nessuna email. Quando arriva la notifica QuoVai la
      scheda si completa; non se ne crea una seconda. Un evento che sparisce dal
      feed non annulla mai niente da solo.
    </p>
    ${data.ical?.configured
      ? `<p class="note">${data.ical.feeds} feed configurati${data.ical.provisional ? ` · ${data.ical.provisional} prenotazioni provvisorie aperte` : ''}.</p>`
      : `<p class="note note--warn">
          Nessun feed configurato: manca <span class="mono">QUOVAI_ICAL_FEEDS</span>.
          L’architettura è pronta — servono gli URL iCal da QuoVai, uno per camera.
        </p>`}
    <div class="actions">
      <button class="action" type="button" data-sync="ical/inspect">Esamina i feed</button>
    </div>
    <div id="sync-result"></div>

    ${data.alerts.length ? `<h2>Da verificare</h2>${data.alerts.map((alert) => `
      <div class="row" data-alert="${esc(alert.id)}">
        <div class="row__head">
          <span class="row__title">${esc(alertTitle(alert.kind))}</span>
          <span class="pill" data-tone="${alert.severity === 'action' ? 'bad' : 'warn'}">${esc(alert.severity)}</span>
        </div>
        <p class="row__meta">${esc(alert.detail?.message ?? '')}</p>
        <div class="row__fields">
          ${Object.entries(alert.detail ?? {}).filter(([key]) => key !== 'message').map(([key, value]) =>
            `<div><span>${esc(key)}</span><span>${esc(typeof value === 'object' ? JSON.stringify(value) : value)}</span></div>`).join('')}
        </div>
        <div class="actions"><button class="action" type="button" data-resolve>Risolto</button></div>
      </div>`).join('')}` : '<p class="note">Nessuna discrepanza fra calendario e prenotazioni.</p>'}

    <h2>Prenotazioni sincronizzate</h2>
    <div class="grid">
      <div class="stat"><span class="stat__value">${data.counts.reservations}</span><span class="stat__label">Totali</span></div>
      <div class="stat" ${data.counts.needs_review ? 'data-tone="warn"' : ''}><span class="stat__value">${data.counts.needs_review}</span><span class="stat__label">Da rivedere</span></div>
      <div class="stat"><span class="stat__value">${data.counts.scheduled}</span><span class="stat__label">Email in attesa</span></div>
      <div class="stat"><span class="stat__value">${data.counts.sent}</span><span class="stat__label">Email inviate</span></div>
    </div>
    ${data.rows.map((row) => `
      <div class="row">
        <div class="row__head">
          <span class="row__title">${esc(row.guest || '—')}</span>
          <span class="row__amount">${esc(day(row.check_in))} → ${esc(day(row.check_out))}</span>
        </div>
        <p class="row__meta">
          ${esc(row.source)}${row.channel ? ` · ${esc(row.channel)}` : ''}
          · <span class="pill" data-tone="${row.needs_review ? 'warn' : 'good'}">${row.needs_review ? 'da rivedere' : 'ok'}</span>
        </p>
        <div class="row__fields">
          <div><span>Importata</span><span>${esc(stamp(row.imported_at))}</span></div>
          <div><span>Link guida</span><span>${row.guide_created ? 'creato' : 'no'}</span></div>
          <div><span>Email</span><span>${esc(label(row.email_status))}${row.email_due ? ` · ${esc(stamp(row.email_due))}` : ''}</span></div>
          ${row.problems.length ? `<div><span>Problemi</span><span>${esc(row.problems.join(', '))}</span></div>` : ''}
        </div>
      </div>`).join('')}
  `);
}

/**
 * The three synchronisation jobs, each with its own row.
 *
 * Reported separately because they fail separately and, more to the point, because
 * "never run" is the answer that matters for the backfill and is invisible when the
 * three are rolled into one green tick.
 */
const SYNC_JOBS = ['gmail-incremental', 'gmail-backfill', 'ical'];

const SYNC_JOB_NAMES = {
  'gmail-incremental': 'Notifiche QuoVai (continuo)',
  'gmail-backfill': 'Recupero storico QuoVai',
  ical: 'Calendario iCal',
};

const SYNC_JOB_WHAT = {
  'gmail-incremental': 'Sorgente primaria: legge la posta recente e applica subito nuove, modifiche e cancellazioni.',
  'gmail-backfill': 'Si lancia a mano. Rilegge un anno di posta e recupera le prenotazioni mai viste.',
  ical: 'Rete di sicurezza. Confronta l’occupancy e tiene le prenotazioni provvisorie.',
};

function syncJobRow(id, entry) {
  const counts = entry?.counts ?? {};
  const tone = !entry?.everRan ? 'warn' : entry.lastError ? 'bad' : 'good';
  const state = !entry?.everRan ? 'mai eseguito' : entry.lastError ? 'in errore' : 'ok';
  const found = id === 'ical'
    ? [
      ['Eventi letti', counts.scanned], ['Corrispondenze', counts.matched],
      ['Provvisorie create', counts.created], ['Non abbinate', counts.unmatched],
      ['Spariti dal feed', counts.vanished], ['Ambigui', counts.ambiguous],
    ]
    : [
      ['Messaggi letti', counts.scanned], ['Create', counts.created],
      ['Modificate', counts.modified], ['Cancellate', counts.cancelled],
      ['Già a posto', counts.unchanged], ['Non pertinenti', counts.ignored],
      ['Non lette', counts.failed],
    ];

  return `<div class="row">
    <div class="row__head">
      <span class="row__title">${esc(SYNC_JOB_NAMES[id] ?? id)}</span>
      <span class="pill" data-tone="${tone}">${esc(state)}</span>
    </div>
    <p class="row__meta">${esc(SYNC_JOB_WHAT[id] ?? '')}</p>
    <div class="row__fields">
      <div><span>Esecuzioni</span><span>${esc(entry?.runs ?? 0)}</span></div>
      <div><span>Ultima</span><span>${entry?.lastRunAt ? esc(stamp(entry.lastRunAt)) : '—'}</span></div>
      <div><span>Ultimo successo</span><span>${entry?.lastSuccessAt ? esc(stamp(entry.lastSuccessAt)) : '—'}</span></div>
      ${entry?.lastError ? `<div><span>Ultimo errore</span><span>${esc(entry.lastError)}</span></div>` : ''}
      ${entry?.everRan ? found.map(([name, value]) => `<div><span>${esc(name)}</span><span>${esc(value ?? 0)}</span></div>`).join('') : ''}
    </div>
  </div>`;
}

/** What the calendar run did, in the numbers that decide whether to look further. */
function reconcileSummary(result) {
  if (result.ok === false) {
    return `<p class="note note--warn">Nessun feed configurato: manca <span class="mono">QUOVAI_ICAL_FEEDS</span>.</p>`;
  }
  const counts = [
    ['Eventi', result.checked], ['Abbinati', result.matched],
    ['Non abbinati', result.unmatched], ['Provvisorie create', result.created],
    ['Già tenute', result.alreadyHeld], ['Ambigui', result.ambiguous],
    ['Non nel feed', result.missing], ['Spariti dal feed', result.vanished],
  ];
  return `
    <div class="grid">${counts.map(([name, value]) => `
      <div class="stat"><span class="stat__value">${esc(value ?? 0)}</span><span class="stat__label">${esc(name)}</span></div>`).join('')}</div>
    ${(result.provisional ?? []).length ? `<h3>Da completare</h3>${result.provisional.map((row) => `
      <div class="row">
        <div class="row__head">
          <span class="row__title">${row.room ? `Camera ${esc(row.room)}` : 'Camera da assegnare'}</span>
          <span class="row__amount">${esc(day(row.check_in))} → ${esc(day(row.check_out))}</span>
        </div>
        <p class="row__meta">Dati ospite da completare: ${esc((row.incomplete ?? []).map((f) => FIELD_NAMES[f] ?? f).join(', '))}</p>
      </div>`).join('')}` : ''}
    ${(result.errors ?? []).length ? `<p class="note note--warn">${result.errors.map((e) => esc(`${e.feed}: ${e.message}`)).join('<br>')}</p>` : ''}`;
}

/**
 * What a feed actually contains.
 *
 * Nothing in LunArt knows what a QuoVai iCal export looks like, and this is the
 * screen that answers it from the feed itself rather than from an assumption.
 */
function inspectSummary(result) {
  if (result.ok === false) {
    return `<p class="note note--warn">Nessun feed configurato: servono gli URL iCal da QuoVai.</p>`;
  }
  return (result.feeds ?? []).map((feed) => (feed.ok === false
    ? `<div class="row">
        <div class="row__head"><span class="row__title">${esc(feed.url)}</span><span class="pill" data-tone="bad">non raggiungibile</span></div>
        <p class="row__meta">${esc(feed.message)}</p>
      </div>`
    : `<div class="row">
        <div class="row__head">
          <span class="row__title">${esc(feed.room ? `Camera ${feed.room}` : feed.url)}</span>
          <span class="pill" data-tone="${feed.looksLikeIcal ? 'good' : 'bad'}">${feed.looksLikeIcal ? 'calendario' : 'non è un calendario'}</span>
        </div>
        <div class="row__fields">
          <div><span>Eventi</span><span>${esc(feed.events)}</span></div>
          <div><span>Con UID</span><span>${esc(feed.withUid)}</span></div>
          <div><span>Con n. prenotazione</span><span>${esc(feed.withBookingReference)}</span></div>
          <div><span>Con camera</span><span>${esc(feed.withRoom)}</span></div>
          <div><span>Blocchi</span><span>${esc(feed.blocked)}</span></div>
          <div><span>Proprietà</span><span class="mono">${esc((feed.properties ?? []).join(' '))}</span></div>
        </div>
        ${feed.sample ? `<p class="row__meta">Esempio: ${esc(feed.sample.check_in)} → ${esc(feed.sample.check_out)} · ${esc(feed.sample.summary || '—')}</p>` : ''}
      </div>`)).join('');
}

/** What happened to the money, said the way a person would say it. */
const CANCEL_OUTCOMES = {
  refunded: 'rimborsato',
  'refunded-offline': 'rimborsato (fuori Stripe)',
  released: 'autorizzazione liberata',
  reduced: 'importo ridotto',
  'nothing-to-settle': 'nessun addebito',
};

const JOB_NAMES = {
  mailbox: 'Lettura casella QuoVai',
  'guest-email': 'Invio email in scadenza',
  ical: 'Confronto calendari iCal',
  housekeeping: 'Chiusura soggiorni conclusi',
};

const JOB_STATES = {
  operational: 'operativo',
  running: 'in esecuzione',
  failing: 'in errore',
  disabled: 'non schedulato',
  idle: 'mai eseguito',
};

const alertTitle = (kind) => ({
  'provider-calendar-unavailable': 'Calendario del professionista non raggiungibile',
  'occupancy-not-synchronised': 'Prenotazione o occupazione non sincronizzata',
  'reservation-not-in-calendar': 'Prenotazione non presente nel calendario',
  'occupancy-ambiguous': 'Evento del calendario riferibile a più prenotazioni',
  'occupancy-vanished': 'Evento sparito dal calendario',
  'ical-feed-unreachable': 'Calendario non raggiungibile',
  'unreadable-notification': 'Notifica non interpretabile',
  'partial-refund-unallocated': 'Rimborso parziale da attribuire',
  'refund-amount-unreadable': 'Rimborso senza importo leggibile',
}[kind] ?? kind);

/* ── Interaction ───────────────────────────────────────────────────────── */

async function act(orderId, action, extra = {}) {
  if (state.busy) return;
  state.busy = true;
  try {
    const result = await api(`/orders/${encodeURIComponent(orderId)}/${action}`, { method: 'POST', body: extra });
    if (result.refund_outstanding) {
      alert('Annullato. L’incasso resta da rimborsare: usa Rimborsa quando è deciso.');
    }
    await render();
  } catch (error) {
    if (!error.handled) alert(`Non è andata: ${error.message}`);
  } finally {
    state.busy = false;
  }
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('[data-view]');
  if (tab) {
    state.view = tab.dataset.view;
    location.hash = `#${state.view}`;
    await render();
    return;
  }

  const go = event.target.closest('[data-go]');
  if (go) { state.view = go.dataset.go; await render(); return; }

  if (event.target.closest('#refresh')) { await render(); return; }

  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const row = actionButton.closest('[data-order]');
    const action = actionButton.dataset.action;
    if (['cancel', 'refund', 'reject'].includes(action)
      && !confirm({ cancel: 'Annullare l’ordine?', refund: 'Rimborsare l’importo?', reject: 'Rifiutare e liberare l’autorizzazione?' }[action])) return;
    await act(row.dataset.order, action);
    return;
  }

  const contact = event.target.closest('[data-contact]');
  if (contact) {
    const row = contact.closest('[data-order]');
    const panel = row.querySelector('[data-contact-panel]');
    const info = await api(`/orders/${encodeURIComponent(row.dataset.order)}/contact`);
    panel.hidden = false;
    panel.innerHTML = `<div class="actions">
      ${info.whatsapp ? `<a class="action" href="${esc(info.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${info.tel ? `<a class="action" href="${esc(info.tel)}">Chiama</a>` : ''}
      ${info.mailto ? `<a class="action" href="${esc(info.mailto)}">Email</a>` : ''}
    </div>
    <p class="note">${esc(info.name)} · ${esc(info.phone || 'nessun telefono')} · ${esc(info.email || 'nessuna email')}</p>`;
    return;
  }

  const linkButton = event.target.closest('[data-link], [data-link-rotate]');
  if (linkButton) {
    const row = linkButton.closest('[data-reservation]');
    const rotate = 'linkRotate' in linkButton.dataset;
    if (rotate && !confirm('Rigenerare il link? Quello vecchio smette di funzionare.')) return;
    const result = await api(`/reservations/${encodeURIComponent(row.dataset.reservation)}/link`, { method: 'POST', body: { rotate } });
    const panel = row.querySelector('[data-reservation-panel]');
    panel.hidden = false;
    panel.innerHTML = `<p class="note mono">${esc(result.link)}</p>`;
    try { await navigator.clipboard.writeText(result.link); panel.innerHTML += '<p class="note">Copiato.</p>'; } catch { /* shown above */ }
    return;
  }

  const editButton = event.target.closest('[data-edit]');
  if (editButton) {
    const row = editButton.closest('[data-reservation]');
    const panel = row.querySelector('[data-reservation-panel]');
    panel.hidden = false;
    panel.innerHTML = `<form data-edit-form>
      <div class="field--pair">
        <label class="field"><span class="field__label">Check-in</span><input type="date" name="check_in"></label>
        <label class="field"><span class="field__label">Check-out</span><input type="date" name="check_out"></label>
      </div>
      <div class="field--pair">
        <label class="field"><span class="field__label">Camera</span><input name="room"></label>
        <label class="field"><span class="field__label">Ospiti</span><input type="number" name="guest_count" min="1" max="6"></label>
      </div>
      <label class="field"><span class="field__label">Email</span><input type="email" name="guest_email"></label>
      <label class="field"><span class="field__label">Telefono</span><input name="guest_phone"></label>
      <label class="field"><span class="field__label">Note</span><textarea name="notes"></textarea></label>
      <div class="actions"><button class="action action--primary" type="submit">Salva</button></div>
      <p class="note">Solo i campi compilati vengono cambiati.</p>
    </form>`;
    return;
  }

  const cancelReservation = event.target.closest('[data-cancel]');
  if (cancelReservation) {
    const row = cancelReservation.closest('[data-reservation]');
    const reason = prompt('Motivo dell’annullamento (facoltativo)');
    if (reason === null) return;
    await api(`/reservations/${encodeURIComponent(row.dataset.reservation)}/cancel`, { method: 'POST', body: { reason } });
    await render();
    return;
  }

  const jobButton = event.target.closest('[data-job]');
  if (jobButton) {
    jobButton.disabled = true;
    try {
      const result = await api(`/sync/run/${jobButton.dataset.job}`, { method: 'POST', keepBody: true });
      $('#sync-result').innerHTML = `<div class="banner" data-tone="${result.ok ? '' : 'warn'}">
        <p class="mono">${esc(JSON.stringify(result, null, 1).slice(0, 700))}</p></div>`;
      await render();
    } catch (error) {
      if (!error.handled) $('#sync-result').innerHTML = `<div class="banner" data-tone="bad">${esc(error.message)}</div>`;
    } finally {
      jobButton.disabled = false;
    }
    return;
  }

  const syncButton = event.target.closest('[data-sync]');
  if (syncButton) {
    const what = syncButton.dataset.sync;
    syncButton.disabled = true;
    try {
      const result = await api(`/sync/${what}`, { method: 'POST', keepBody: true });
      const summary = {
        repair: repairSummary,
        backfill: backfillSummary,
        reconcile: reconcileSummary,
        'ical/inspect': inspectSummary,
      }[what];
      // The two calendar summaries answer usefully even when the run refused, so
      // they are given the result either way; the rest fall back to the raw shape.
      const readsRefusals = what === 'reconcile' || what === 'ical/inspect';
      $('#sync-result').innerHTML = summary && (readsRefusals || result.ok !== false)
        ? summary(result)
        : `<div class="banner" data-tone="${result.ok === false ? 'warn' : ''}">
            <p class="mono">${esc(JSON.stringify(result, null, 1).slice(0, 900))}</p></div>`;
    } catch (error) {
      if (!error.handled) $('#sync-result').innerHTML = `<div class="banner" data-tone="bad">${esc(error.message)}</div>`;
    } finally {
      syncButton.disabled = false;
    }
    return;
  }

  /**
   * The launch catch-up. Two buttons, because they are two different acts.
   *
   * The preview is a GET and has no way to send. The send is a POST carrying an
   * explicit confirmation, is refused by the server without it, and is disabled
   * here until a preview has run — so the only route to it is through having read
   * who is on the list. Leaving the screen disables it again, because by the time
   * you come back the list may have moved.
   */
  const catchUp = event.target.closest('[data-catchup]');
  if (catchUp) {
    const what = catchUp.dataset.catchup;
    const send = $('[data-catchup="send"]');
    const out = $('#catchup-result');
    const hint = $('#catchup-hint');

    if (what === 'send') {
      const count = Number(send.dataset.eligible ?? 0);
      if (!count) return;
      // The last gate, and the only one that names the number out loud.
      if (!confirm(`Invio reale della Guest Guide a ${count} ospiti. Non si può annullare. Procedere?`)) return;
    }

    /**
     * What this screen believed, so the answer can say if it was out of date.
     *
     * Sent to nobody — the request carries one word and no recipients, because the
     * server decides who is owed the guide at the moment the button is pressed and
     * a browser left open since this morning is not evidence about anything. This
     * is only here so that when the two numbers differ, the banner can say so
     * instead of leaving a person to wonder why they saw nineteen and six went out.
     */
    const expected = Number(send.dataset.eligible ?? 0);

    catchUp.disabled = true;
    try {
      const result = what === 'preview'
        ? await api('/sync/guide-catchup', { keepBody: true })
        : await api('/sync/guide-catchup', { method: 'POST', body: { confirm: true }, keepBody: true });

      out.innerHTML = what === 'preview'
        ? catchUpPreviewSummary(result)
        : catchUpSendSummary({
          ...result,
          expected,
          stale: result.ok !== false && Number(result.attempted ?? 0) !== expected,
        });

      if (what === 'preview') {
        // The preview arms the send, with the number it found, and only when there
        // is somebody to write to.
        send.dataset.eligible = String(result.eligible ?? 0);
        send.disabled = !result.eligible;
        hint.textContent = result.eligible
          ? `Controllo fatto, nessuna email inviata. L’invio scriverebbe a ${result.eligible} ospiti.`
          : 'Controllo fatto, nessuna email inviata: non c’è nessun ospite da recuperare.';
      } else {
        // Sent is sent. A second press would find nothing, but it should not be one
        // tap away either.
        send.disabled = true;
        send.dataset.eligible = '0';
        hint.textContent = 'Invio eseguito. Per rivedere la situazione, rifare il controllo.';
      }
    } catch (error) {
      if (!error.handled) out.innerHTML = `<div class="banner" data-tone="bad">${esc(error.message)}</div>`;
      if (what === 'send') hint.textContent = 'Rifare il controllo per sapere a chi è arrivata.';
    } finally {
      if (what === 'preview') catchUp.disabled = false;
    }
    return;
  }

  /**
   * Reconcile a refund that already happened on another Stripe account.
   *
   * Two prompts and a confirmation, which is the right amount of friction for an
   * operation that revokes a card on a person's word. The first asks which order,
   * because naming it wrong is the only real mistake available here; the server
   * then answers with the order it found, so the second prompt can quote the guest
   * and the amount back before anything is written. Nothing is sent to Stripe.
   */
  const refundReconcile = event.target.closest('[data-refund-reconcile]');
  if (refundReconcile) {
    const out = $('#refund-reconcile-result');
    const wanted = prompt('Riferimento o id dell\u2019ordine gi\u00e0 rimborsato su Stripe (es. 654C8AE9)');
    if (!wanted?.trim()) return;

    refundReconcile.disabled = true;
    try {
      /**
       * A deliberate dry run: without `confirm` the server refuses and hands back
       * the order it matched, so the question below can name a real guest and a
       * real amount instead of an eight-character code.
       */
      const found = await api('/orders/refund-reconcile', {
        method: 'POST', body: { order: wanted.trim() }, keepBody: true,
      });

      if (found.status === 404 || !found.order) {
        out.innerHTML = `<div class="banner" data-tone="bad">
          <p>Nessun ordine corrisponde a <span class="mono">${esc(wanted.trim())}</span>.</p></div>`;
        return;
      }

      const order = found.order;
      const sure = confirm(
        `Segnare come rimborsato l\u2019ordine ${order.reference} di ${order.customer?.name ?? '\u2014'}`
        + ` per ${money(order.amount, order.currency)}?\n\n`
        + 'Il rimborso deve essere GI\u00c0 stato fatto su Stripe. Questo non muove soldi,'
        + ' ma revoca la Privilege Card di quell\u2019ordine e non si pu\u00f2 annullare.',
      );
      if (!sure) return;

      const reason = prompt('Motivo / nota (facoltativo, resta nello storico dell\u2019ordine)') ?? '';
      const providerReference = prompt('Riferimento del rimborso su Stripe (facoltativo)') ?? '';

      const result = await api('/orders/refund-reconcile', {
        method: 'POST',
        body: { order: order.id, confirm: true, reason, providerReference },
        keepBody: true,
      });
      out.innerHTML = refundReconcileSummary(result);
      await render();
    } catch (error) {
      if (!error.handled) out.innerHTML = `<div class="banner" data-tone="bad">${esc(error.message)}</div>`;
    } finally {
      refundReconcile.disabled = false;
    }
    return;
  }

  /** One test notification to every registered device. */
  const pushTest = event.target.closest('[data-push-test]');
  if (pushTest) {
    pushTest.disabled = true;
    try {
      const result = await api('/push/test', { method: 'POST', keepBody: true });
      $('#push-result').innerHTML = pushTestSummary(result);
    } catch (error) {
      if (!error.handled) $('#push-result').innerHTML = `<div class="banner" data-tone="bad">${esc(error.message)}</div>`;
    } finally {
      pushTest.disabled = false;
    }
    return;
  }

  const resolve = event.target.closest('[data-resolve]');
  if (resolve) {
    const row = resolve.closest('[data-alert]');
    await api(`/alerts/${encodeURIComponent(row.dataset.alert)}/resolve`, { method: 'POST' });
    await render();
    return;
  }

  if (event.target.closest('#enter')) {
    const value = $('#token').value.trim();
    writeToken(value);
    $('#gate').hidden = true;
    await render();
  }
});

document.addEventListener('submit', async (event) => {
  const manual = event.target.closest('#manual');
  if (manual) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(manual).entries());
    try {
      const result = await api('/reservations', { method: 'POST', body: data });
      $('#manual-result').innerHTML = `<div class="banner" data-tone="">Creata: ${esc(result.reservation.staff_ref)}</div>`;
      await render();
    } catch (error) {
      if (!error.handled) $('#manual-result').innerHTML = `<div class="banner" data-tone="bad">${esc(error.message)}</div>`;
    }
    return;
  }

  const edit = event.target.closest('[data-edit-form]');
  if (edit) {
    event.preventDefault();
    const row = edit.closest('[data-reservation]');
    const patch = Object.fromEntries([...new FormData(edit).entries()].filter(([, value]) => String(value).trim() !== ''));
    await api(`/reservations/${encodeURIComponent(row.dataset.reservation)}/edit`, { method: 'POST', body: patch });
    await render();
  }
});

/* ── Notifications ─────────────────────────────────────────────────────── */

/**
 * Ask for permission and register this device.
 *
 * Only offered once there is a key to register against: asking for notification
 * permission and then not being able to send any is how an app teaches somebody to
 * tap "Don't allow". The subscription is stored either way, so a device registered
 * before the keys exist starts working the moment they do.
 */
async function offerNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const { push } = await api('/dashboard');
    if (!push?.configured || !push.publicKey) return;
    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'default') {
      const granted = await Notification.requestPermission();
      if (granted !== 'granted') return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: push.publicKey,
    });
    await api('/push/subscribe', { method: 'POST', body: { subscription: subscription.toJSON(), label: navigator.platform } });
  } catch { /* notifications are a convenience, never a blocker */ }
}

/* ── Boot ──────────────────────────────────────────────────────────────── */

async function start() {
  const wanted = location.hash.replace(/^#/, '');
  if (VIEWS.some((view) => view.id === wanted)) state.view = wanted;

  try {
    await render();
  } catch (error) {
    if (!error.handled) showGate('');
  }
  offerNotifications();
}

/**
 * The token gate.
 *
 * A development server with no staff token configured lets everything through, so the gate
 * only appears when the server actually asks for one. Trying first and asking second
 * keeps the preview usable without pretending the production server is open.
 */
if (!state.token) {
  api('/dashboard').then(start).catch((error) => { if (!error.handled) showGate(''); });
} else {
  start();
}
