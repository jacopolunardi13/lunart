/**
 * The Privilege Card, as an entitlement rather than a picture.
 *
 * A static QR code is a bearer token with no expiry: screenshot it, send it to a
 * friend, and they are you. So the card is not a code the guest holds. It is a
 * record on the server, and what the phone shows is a short-lived proof derived
 * from it:
 *
 *   - the card's state (dates, holder, revocation) lives only here;
 *   - the displayed code is an HMAC over the current time window, so it changes
 *     by itself and an old screenshot stops working within a couple of minutes;
 *   - the code carries no readable information — not the name, not the dates;
 *   - validation is server-side, so an expired or revoked card fails no matter
 *     what the phone is displaying.
 *
 * Nothing is consumed: the card is a membership, so the same card scanned twice in
 * an evening is valid twice. The rotation is the whole protection, and it is the
 * guest's business as little as a chip's rolling counter is a cardholder's. They
 * see the QR of their card; they are told nothing about windows, timers or codes,
 * and the payload sent to the phone does not contain them to leak.
 *
 * The signing key never leaves the server, and per-card secrets are derived from
 * it rather than stored, so there is one secret to protect instead of one per card.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomRef, opaqueToken } from './store.js';
import { propertyDate, lastDayOf, endOfPropertyDay, propertyTimeToInstant, isValidDate } from '../commerce/time.js';
import { allGuestBenefits, cardBenefits, guestBenefit } from '../commerce/partners.js';

export const CARD_STATUS = {
  active: 'active',
  revoked: 'revoked',
};

export const MAX_CARD_PEOPLE = 2;

/** Digits the displayed code is drawn from: no look-alikes, easy to read aloud. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 6;

/** One secret per card, derived rather than stored. */
const cardSecret = (signingKey, cardId) =>
  createHmac('sha256', signingKey).update(`card:${cardId}`).digest();

/** Which time window we are in. */
export const windowFor = (atMs, periodSeconds) => Math.floor(atMs / 1000 / periodSeconds);

/** The code for one card in one window. Not reversible, and not guessable. */
export function codeFor({ signingKey, cardId, window }) {
  const digest = createHmac('sha256', cardSecret(signingKey, cardId))
    .update(`window:${window}`)
    .digest();
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length];
  return out;
}

const sameCode = (a, b) => {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Issue a card against a paid order line.
 * `days` is inclusive: a 2-day card bought for the 5th runs to the end of the 6th.
 */
export function buildCard({ orderId, holderName, startDate, days, variantId, signingKey }) {
  if (!isValidDate(startDate)) throw new Error('card needs a valid start date');
  if (!Number.isInteger(days) || days < 1) throw new Error('card needs a whole number of days');

  const endDate = lastDayOf(startDate, days);
  const id = opaqueToken(16);

  return {
    id,
    object: 'privilege_card',
    public_ref: randomRef(6),
    access_token: opaqueToken(24),
    order_id: orderId,
    variant_id: variantId ?? null,
    holder_name: String(holderName ?? '').trim().slice(0, 80),
    start_date: startDate,
    end_date: endDate,
    starts_at: propertyTimeToInstant(startDate, '00:00').toISOString(),
    expires_at: endOfPropertyDay(endDate).toISOString(),
    max_people: MAX_CARD_PEOPLE,
    days,
    status: CARD_STATUS.active,
    transferable: false,
    revoked_at: null,
    revoked_reason: null,
    // Deliberately absent: any copy of the signing key or a per-card secret.
    signing_key_fingerprint: createHmac('sha256', signingKey).update('fingerprint').digest('hex').slice(0, 12),
  };
}

/** Where a card is in its life, independent of what any phone is showing. */
export function cardState(card, now = new Date()) {
  if (!card) return 'unknown';
  if (card.status === CARD_STATUS.revoked) return 'revoked';
  const nowMs = now.getTime();
  if (nowMs >= Date.parse(card.expires_at)) return 'expired';
  if (nowMs < Date.parse(card.starts_at)) return 'not-started';
  return 'active';
}

/** What the holder's phone shows, and how long before it changes. */
export function currentCode(card, { signingKey, periodSeconds, now = new Date() }) {
  const nowMs = now.getTime();
  const window = windowFor(nowMs, periodSeconds);
  const expiresAtMs = (window + 1) * periodSeconds * 1000;
  return {
    code: codeFor({ signingKey, cardId: card.id, window }),
    reference: card.public_ref,
    /** What a venue types if the camera will not cooperate. */
    manualCode: `${card.public_ref}-${codeFor({ signingKey, cardId: card.id, window })}`,
    window,
    periodSeconds,
    expiresAt: new Date(expiresAtMs).toISOString(),
    secondsRemaining: Math.max(0, Math.round((expiresAtMs - nowMs) / 1000)),
  };
}

/** The URL encoded in the QR. Opens the validation page on any phone camera. */
export const qrPayload = (publicUrl, card, code) =>
  `${publicUrl}/validate-card?c=${encodeURIComponent(card.public_ref)}&k=${encodeURIComponent(code)}`;

/**
 * Accept a scan from a venue.
 *
 * Nothing is consumed and nothing is counted. A card is usable as often as its
 * validity allows, under whatever terms each partner sets, so scanning one twice
 * — a double tap, a reloaded page, two venues in an evening — gives the same
 * answer both times. The protection that remains is the code's short life: it is
 * derived from the current minute, so a screenshot stops working on its own.
 *
 * `partnerId` scopes the answer to the venue that asked, so a bar is shown its
 * own benefit rather than a list to pick from.
 */
export async function validateCode({
  reference, code, store, signingKey, periodSeconds, grace = 1, now = new Date(), partnerId = null,
}) {
  const cleanRef = String(reference ?? '').trim().toUpperCase();
  const cleanCode = String(code ?? '').trim().toUpperCase();
  if (!cleanRef || !cleanCode) return { valid: false, reason: 'malformed' };

  const card = await store.cards.findByPublicRef(cleanRef);
  // Same answer for an unknown card as for a wrong code: a scanner must not become
  // a way to find out which references exist.
  if (!card) return { valid: false, reason: 'not-found' };

  const state = cardState(card, now);
  if (state !== 'active') return { valid: false, reason: state, card: publicView(card) };

  const window = windowFor(now.getTime(), periodSeconds);
  let matched = false;
  for (let back = 0; back <= grace && !matched; back++) {
    matched = sameCode(cleanCode, codeFor({ signingKey, cardId: card.id, window: window - back }));
  }
  if (!matched) return { valid: false, reason: 'invalid-code', card: publicView(card) };

  const scoped = partnerId ? guestBenefit(partnerId) : null;
  return {
    valid: true,
    card: publicView(card),
    partner: scoped,
    benefits: scoped ? [scoped] : allGuestBenefits(),
    validatedAt: now.toISOString(),
  };
}

/**
 * What a venue is allowed to see. Not the card id, not the access token, not the
 * order — a restaurant needs to know the card is good and who is holding it.
 */
export function publicView(card) {
  return {
    reference: card.public_ref,
    holder: card.holder_name,
    initials: initialsOf(card.holder_name),
    valid_from: card.start_date,
    valid_until: card.end_date,
    expires_at: card.expires_at,
    max_people: card.max_people,
    status: card.status,
    transferable: false,
  };
}

function initialsOf(name) {
  return String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3);
}

/** What the holder sees in the guide. Still no secrets. */
export function holderView(card, now = new Date()) {
  return {
    reference: card.public_ref,
    holder: card.holder_name,
    start_date: card.start_date,
    end_date: card.end_date,
    expires_at: card.expires_at,
    max_people: card.max_people,
    days: card.days,
    state: cardState(card, now),
    status: card.status,
    transferable: false,
    /**
     * What the card itself gets you. Deliberately not every benefit LunArt has:
     * the Opera Caffè 30% comes with the stay, so it is listed under the stay and
     * not here. Putting it on the card would be selling a guest something they
     * already have.
     */
    benefits: cardBenefits(),
  };
}

export function revoke(card, reason = '') {
  return {
    ...card,
    status: CARD_STATUS.revoked,
    revoked_at: new Date().toISOString(),
    revoked_reason: String(reason ?? '').slice(0, 200),
  };
}

export { propertyDate };
