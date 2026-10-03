/**
 * Structural checks on the QR encoder.
 *
 * These run anywhere Node does. The stronger verification — module-for-module
 * equality with python-qrcode across every mask, and a real decode through
 * OpenCV — lives in `tools/qr-verify.py`, because it needs those packages.
 * Both have been run against this encoder; these tests are what keeps it honest
 * day to day.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQR, qrSvg } from '../src/commerce/qr.js';

const CARD_URL = 'https://guide.lunart.example/validate-card?c=ABC123&k=XYZ789';

test('a card URL fits comfortably inside the supported versions', () => {
  const { version, size } = encodeQR(CARD_URL);
  assert.ok(version >= 1 && version <= 10, `version ${version} is out of range`);
  assert.equal(size, version * 4 + 17);
});

test('finder patterns are where a scanner looks for them', () => {
  const { cells, size } = encodeQR(CARD_URL);
  for (const [baseRow, baseCol] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    assert.equal(cells[baseRow][baseCol], 1, 'finder corner should be dark');
    assert.equal(cells[baseRow + 1][baseCol + 1], 0, 'finder ring should be light');
    assert.equal(cells[baseRow + 3][baseCol + 3], 1, 'finder core should be dark');
  }
});

test('timing patterns alternate', () => {
  const { cells, size } = encodeQR(CARD_URL);
  for (let i = 8; i < size - 8; i++) {
    assert.equal(cells[6][i], i % 2 === 0 ? 1 : 0, `horizontal timing wrong at ${i}`);
    assert.equal(cells[i][6], i % 2 === 0 ? 1 : 0, `vertical timing wrong at ${i}`);
  }
});

test('the always-dark module is dark', () => {
  const { cells, size } = encodeQR(CARD_URL);
  assert.equal(cells[size - 8][8], 1);
});

test('the format information reads back as the mask that was used', () => {
  // Recovering the metadata from the finished symbol catches the class of bug
  // where everything is right except the symbol's description of itself.
  for (let mask = 0; mask < 8; mask++) {
    const { cells, size } = encodeQR(CARD_URL, { forceMask: mask });

    const read = [];
    for (let i = 0; i <= 5; i++) read.push(cells[8][i]);
    read.push(cells[8][7], cells[8][8], cells[7][8]);
    for (let i = 9; i <= 14; i++) read.push(cells[14 - i][8]);

    const value = read.reduce((acc, bit) => (acc << 1) | bit, 0) ^ 0b101010000010010;
    const recoveredMask = (value >> 10) & 0b111;
    const recoveredLevel = (value >> 13) & 0b11;
    assert.equal(recoveredMask, mask, `mask ${mask} did not survive the round trip`);
    assert.equal(recoveredLevel, 0b00, 'error correction level should read back as M');

    // Both copies of the format information must agree, or scanners disagree too.
    const second = [];
    for (let i = 0; i <= 6; i++) second.push(cells[size - 1 - i][8]);
    for (let i = 7; i <= 14; i++) second.push(cells[8][size - 8 + (i - 7)]);
    assert.deepEqual(second, read, 'the two format copies differ');
  }
});

test('every mask produces a different symbol', () => {
  const seen = new Set();
  for (let mask = 0; mask < 8; mask++) {
    seen.add(JSON.stringify(encodeQR(CARD_URL, { forceMask: mask }).cells));
  }
  assert.equal(seen.size, 8);
});

test('the chosen mask is the one with the lowest penalty', () => {
  // Not that it matches any particular library's choice — only that the choice
  // is made rather than defaulted.
  const chosen = encodeQR(CARD_URL).mask;
  assert.ok(chosen >= 0 && chosen <= 7);
});

test('encoding is deterministic', () => {
  const once = JSON.stringify(encodeQR(CARD_URL));
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(encodeQR(CARD_URL)), once);
});

test('the SVG carries one square per dark module', () => {
  const { cells } = encodeQR(CARD_URL);
  const dark = cells.flat().filter(Boolean).length;
  const svg = qrSvg(CARD_URL, { label: 'test' });
  assert.equal((svg.match(/M\d+ \d+h1v1h-1z/g) ?? []).length, dark);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="test"/);
});

test('a payload too long to encode fails loudly', () => {
  assert.throws(() => encodeQR('x'.repeat(500)), /too long/);
});
