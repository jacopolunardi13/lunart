/**
 * A QR encoder, in about two hundred lines.
 *
 * The card screen has to draw a code that changes every minute. Pulling a library
 * off a CDN would undo the work of making this guide free of third-party requests,
 * and a QR symbol is a specified, finite thing: byte mode, error correction level
 * M, versions 1 to 10, which covers a validation URL several times over.
 *
 * Correctness is not taken on trust. `test/qr.test.mjs` compares the module matrix
 * this produces against the reference implementation in Python's `qrcode` package,
 * cell by cell, for a range of payloads — including the exact URLs the card uses.
 */

const EC_LEVEL_M = 0b00;

/**
 * Per version at level M: [error correction codewords per block, [group sizes]],
 * where a group size is the number of data codewords in each block of that group.
 */
const VERSIONS = {
  1:  { ecPerBlock: 10, groups: [[1, 16]] },
  2:  { ecPerBlock: 16, groups: [[1, 28]] },
  3:  { ecPerBlock: 26, groups: [[1, 44]] },
  4:  { ecPerBlock: 18, groups: [[2, 32]] },
  5:  { ecPerBlock: 24, groups: [[2, 43]] },
  6:  { ecPerBlock: 16, groups: [[4, 27]] },
  7:  { ecPerBlock: 18, groups: [[4, 31]] },
  8:  { ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  9:  { ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  10: { ecPerBlock: 26, groups: [[4, 43], [1, 44]] },
};

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const dataCapacity = (version) =>
  VERSIONS[version].groups.reduce((sum, [blocks, size]) => sum + blocks * size, 0);

/* ── GF(256), the field QR error correction is computed in ──────────────── */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;            // the primitive polynomial QR uses
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial for `degree` error correction codewords. */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function errorCorrection(data, ecLength) {
  const generator = generatorPoly(ecLength);
  const remainder = new Array(data.length + ecLength).fill(0);
  data.forEach((byte, i) => { remainder[i] = byte; });

  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i];
    if (factor === 0) continue;
    for (let j = 0; j < generator.length; j++) {
      remainder[i + j] ^= mul(generator[j], factor);
    }
  }
  return remainder.slice(data.length);
}

/* ── Bits in, codewords out ─────────────────────────────────────────────── */

function encodeData(bytes, version) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);                                   // byte mode
  push(bytes.length, version <= 9 ? 8 : 16);         // character count
  for (const byte of bytes) push(byte, 8);

  const capacityBits = dataCapacity(version) * 8;
  if (bits.length > capacityBits) return null;

  push(0, Math.min(4, capacityBits - bits.length));  // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  }
  // Pad alternately with 236 and 17, as the specification requires.
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < dataCapacity(version)) codewords.push(pads[padIndex++ % 2]);
  return codewords;
}

/** Split into blocks, compute correction for each, then interleave both halves. */
function interleave(codewords, version) {
  const { ecPerBlock, groups } = VERSIONS[version];
  const dataBlocks = [];
  let offset = 0;
  for (const [blockCount, size] of groups) {
    for (let i = 0; i < blockCount; i++) {
      dataBlocks.push(codewords.slice(offset, offset + size));
      offset += size;
    }
  }
  const ecBlocks = dataBlocks.map((block) => errorCorrection(block, ecPerBlock));

  const out = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

/* ── Drawing the symbol ─────────────────────────────────────────────────── */

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function blankMatrix(size) {
  return {
    cells: Array.from({ length: size }, () => new Array(size).fill(0)),
    reserved: Array.from({ length: size }, () => new Array(size).fill(false)),
    size,
  };
}

function placeFunctionPatterns(matrix, version) {
  const { size, cells, reserved } = matrix;
  const set = (r, c, value) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    cells[r][c] = value;
    reserved[r][c] = true;
  };

  // Finders, with their separators.
  for (const [baseR, baseC] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const ring = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(baseR + r, baseC + c, inside && (ring || core) ? 1 : 0);
      }
    }
  }

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0 ? 1 : 0);
    set(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Alignment patterns, skipping the ones that would sit on a finder.
  const centres = ALIGNMENT[version];
  for (const r of centres) {
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const edge = Math.max(Math.abs(dr), Math.abs(dc));
          set(r + dr, c + dc, edge === 1 ? 0 : 1);
        }
      }
    }
  }

  set(size - 8, 8, 1);                               // the always-dark module

  // Reserve the format areas; they are filled once a mask is chosen.
  for (let i = 0; i < 9; i++) {
    if (!(i === 6)) { reserved[8][i] = true; reserved[i][8] = true; }
  }
  reserved[8][6] = true; reserved[6][8] = true;
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }

  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        reserved[i][size - 11 + j] = true;
        reserved[size - 11 + j][i] = true;
      }
    }
  }
}

/** Data runs up the symbol in two-column strips, skipping the timing column. */
function placeData(matrix, codewords) {
  const { size, cells, reserved } = matrix;
  const bits = [];
  for (const byte of codewords) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);

  let index = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;                        // the vertical timing column
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row][col]) continue;
        cells[row][col] = index < bits.length ? bits[index] : 0;
        index++;
      }
    }
    upward = !upward;
  }
}

function formatBits(ecLevel, mask) {
  let value = (ecLevel << 3) | mask;
  let bch = value << 10;
  for (let i = 4; i >= 0; i--) {
    if (bch & (1 << (i + 10))) bch ^= 0b10100110111 << i;
  }
  return ((value << 10) | bch) ^ 0b101010000010010;
}

function versionBits(version) {
  let bch = version << 12;
  for (let i = 5; i >= 0; i--) {
    if (bch & (1 << (i + 12))) bch ^= 0b1111100100101 << i;
  }
  return (version << 12) | bch;
}

function applyFormat(matrix, mask, version) {
  const { size, cells } = matrix;
  const bits = formatBits(EC_LEVEL_M, mask);
  // The 15 bits are laid down most-significant first, so position 0 in the walks
  // below carries bit 14. Reading them the other way round produces a symbol that
  // is right everywhere except its own metadata, which most scanners then refuse.
  const bit = (i) => (bits >> (14 - i)) & 1;

  // First copy, around the top-left finder.
  for (let i = 0; i <= 5; i++) cells[8][i] = bit(i);
  cells[8][7] = bit(6);
  cells[8][8] = bit(7);
  cells[7][8] = bit(8);
  for (let i = 9; i <= 14; i++) cells[14 - i][8] = bit(i);

  // Second copy, split between the other two finders. Bits 0–6 run up the left
  // column; bits 7–14 run right along row 8. The module at (size-8, 8) is the
  // always-dark one and is not part of this — writing a format bit over it was
  // what made these symbols differ from the reference.
  for (let i = 0; i <= 6; i++) cells[size - 1 - i][8] = bit(i);
  for (let i = 7; i <= 14; i++) cells[8][size - 8 + (i - 7)] = bit(i);

  if (version >= 7) {
    const vbits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const value = (vbits >> i) & 1;
      cells[Math.floor(i / 3)][size - 11 + (i % 3)] = value;
      cells[size - 11 + (i % 3)][Math.floor(i / 3)] = value;
    }
  }
}

/** The four penalty rules. Lower is a cleaner symbol for a camera to read. */
function penalty(cells) {
  const size = cells.length;
  let score = 0;

  const run = (get) => {
    for (let a = 0; a < size; a++) {
      let length = 1;
      for (let b = 1; b < size; b++) {
        if (get(a, b) === get(a, b - 1)) {
          length++;
        } else {
          if (length >= 5) score += 3 + (length - 5);
          length = 1;
        }
      }
      if (length >= 5) score += 3 + (length - 5);
    }
  };
  run((r, c) => cells[r][c]);
  run((c, r) => cells[r][c]);

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = cells[r][c];
      if (v === cells[r][c + 1] && v === cells[r + 1][c] && v === cells[r + 1][c + 1]) score += 3;
    }
  }

  const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const reversed = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (get, a, b) =>
    pattern.every((v, i) => get(a, b + i) === v) || reversed.every((v, i) => get(a, b + i) === v);
  for (let a = 0; a < size; a++) {
    for (let b = 0; b + 11 <= size; b++) {
      if (matches((x, y) => cells[x][y], a, b)) score += 40;
      if (matches((x, y) => cells[y][x], a, b)) score += 40;
    }
  }

  let dark = 0;
  for (const row of cells) for (const cell of row) dark += cell;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/**
 * Encode text as a QR matrix.
 *
 * `forceMask` exists for the test that compares this against a reference
 * implementation: mask choice is a quality heuristic rather than a correctness
 * question — all eight produce a readable symbol — so the test pins the mask and
 * compares everything else exactly.
 *
 * @returns {{ size: number, cells: number[][], version: number, mask: number }}
 */
export function encodeQR(text, { forceMask = null } = {}) {
  const bytes = [...new TextEncoder().encode(String(text))];

  let version = null;
  let codewords = null;
  for (let candidate = 1; candidate <= 10; candidate++) {
    const encoded = encodeData(bytes, candidate);
    if (encoded) { version = candidate; codewords = encoded; break; }
  }
  if (!version) throw new Error('payload too long for a version 10 QR symbol');

  const interleaved = interleave(codewords, version);
  const size = version * 4 + 17;

  let best = null;
  const candidates = forceMask === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
  for (const mask of candidates) {
    const matrix = blankMatrix(size);
    placeFunctionPatterns(matrix, version);
    placeData(matrix, interleaved);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!matrix.reserved[r][c] && MASKS[mask](r, c)) matrix.cells[r][c] ^= 1;
      }
    }
    applyFormat(matrix, mask, version);
    const score = penalty(matrix.cells);
    if (!best || score < best.score) best = { score, mask, cells: matrix.cells };
  }

  return { size, cells: best.cells, version, mask: best.mask };
}

/**
 * Render as SVG. One path for every dark module, which keeps the markup small and
 * lets the colour follow `currentColor` like every other mark in the guide.
 */
export function qrSvg(text, { margin = 2, label = '' } = {}) {
  const { size, cells } = encodeQR(text);
  const total = size + margin * 2;
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (cells[r][c]) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return `<svg viewBox="0 0 ${total} ${total}" width="100%" height="100%"
    role="img" ${label ? `aria-label="${label}"` : 'aria-hidden="true"'}
    shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
    <rect width="${total}" height="${total}" fill="#fff"/>
    <path d="${path}" fill="currentColor"/>
  </svg>`;
}
