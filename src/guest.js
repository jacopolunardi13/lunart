/**
 * Who is holding the phone.
 *
 * On a personal link — `/g/<token>` — the guide can know a first name, a room, a
 * set of dates and which part of the stay the guest is in. That is worth having:
 * it means the guide opens on the right moment instead of asking, the room number
 * is already filled in, and a Privilege Card can only be sold for days the guest is
 * actually here.
 *
 * Everything degrades. Opened without a token, or with the API unreachable, this
 * stays empty and the guide works exactly as it did before — a guest picking their
 * own phase and typing their own room number. Nothing here is ever required.
 *
 * The token is read from the path and never written anywhere else. It is not put in
 * localStorage: a shared phone in a hotel is a shared phone, and a personal link
 * living on after the stay is a record left behind.
 */

const state = {
  token: null,
  context: null,
  problem: null,
};

/** The token out of `/g/<token>`, if that is how this page was opened. */
export function tokenFromPath(pathname = location.pathname) {
  const match = /^\/g\/([A-Za-z0-9_-]{16,})\/?$/.exec(pathname);
  return match ? match[1] : null;
}

export const guideToken = () => state.token;
export const guest = () => state.context;
export const guestProblem = () => state.problem;

/** True when this guest opened their own link and the stay is live. */
export const isPersonal = () => Boolean(state.context);
export const canPurchase = () => state.context?.can_purchase !== false;

/** The stay, in the shape the commerce layer wants. Null when there is none. */
export const guestStay = () => (
  state.context?.check_in && state.context?.check_out
    ? { check_in: state.context.check_in, check_out: state.context.check_out }
    : null
);

/** The card lengths and start dates this stay allows, as the server worked them out. */
export const cardOptions = () => state.context?.cardOptions ?? [];

/**
 * The LunArt Pass for this stay.
 *
 * Comes with the context because every reservation has one — there is nothing to
 * fetch and nothing to buy. Null on the public guide, where there is no stay for a
 * Pass to describe.
 */
export const guestPass = () => state.context?.pass ?? null;

/**
 * What this stay has bought, as the server knows it.
 *
 * The server is the source of truth here, not the browser: a guest who ordered
 * wine on the laptop in the room and then opens their link on a phone must find
 * that order, and a phone that has never seen this stay before knows nothing.
 */
export const guestPurchases = () => state.context?.purchases ?? [];

/**
 * Pull the context again, after something has changed it.
 *
 * Used when a guest comes back from paying: the order has just moved, and what the
 * page is holding was true a minute ago.
 */
export async function refreshGuest() {
  if (!state.token) return null;
  return loadGuest(state.token);
}

/**
 * Resolve the link.
 *
 * A failure is not an error the guest should see: an expired or mistyped link just
 * means the guide behaves like the public one, which is still the whole guide.
 */
export async function loadGuest(token = tokenFromPath()) {
  state.token = token;
  if (!token) return null;
  try {
    const response = await fetch(`/api/guide/${encodeURIComponent(token)}`, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      state.problem = response.status === 404 ? 'not-found' : `http-${response.status}`;
      return null;
    }
    state.context = await response.json();
    return state.context;
  } catch (error) {
    state.problem = 'unreachable';
    return null;
  }
}

/** Ask for a lost link back. Surname plus booking number; one answer for every failure. */
export async function requestRecovery({ lastName, reference }) {
  const response = await fetch('/api/guide/recover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lastName, reference }),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok && payload.ok === true, status: response.status, ...payload };
}
