/**
 * Minimal, dependency-free QR Code generator.
 *
 * Scope (deliberately small, correct, and offline — no third-party service ever
 * sees resident data): byte mode, error-correction level L, versions 1–5
 * (single data block), fixed mask pattern 0. Capacity at v5 ≈ 106 bytes, which
 * is ample for a resident check-in URL or an id like "GH-RES-1a2b3c".
 *
 * Algorithm follows the public-domain approach popularized by Project Nayuki.
 */

// ── Galois field GF(256) tables (primitive polynomial 0x11d) ──────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/**
 * Reed–Solomon generator polynomial of the given degree, in DESCENDING order:
 * `poly[0]` is the leading (x^degree) coefficient (always 1). This ordering is
 * what `rsEncode` expects.
 */
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    // Multiply poly by (x + α^i): shift up (×x) then add α^i·poly.
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Compute `ecLen` error-correction codewords for the given data codewords. */
function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift();
    res.push(0);
    for (let j = 0; j < gen.length - 1; j++) {
      res[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return res;
}

// ── Version table (ECC level L, single block) ─────────────────────────────────
// [dataCodewords, ecCodewords]
const VERSIONS: Record<number, [number, number]> = {
  1: [19, 7],
  2: [34, 10],
  3: [55, 15],
  4: [80, 20],
  5: [108, 26],
};
// Center coordinate of the single alignment pattern (versions 2–5).
const ALIGN_POS: Record<number, number> = { 2: 18, 3: 22, 4: 26, 5: 30 };
// Format-info bits for ECC level L + mask 0 (precomputed BCH ^ 0x5412).
const FORMAT_L_MASK0 = 0x77c4;

function pickVersion(byteLen: number): number {
  for (let v = 1; v <= 5; v++) {
    const [dataCw] = VERSIONS[v];
    // overhead: 4-bit mode + 8-bit length = 12 bits = 1.5 bytes → need len + 2 ≤ dataCw
    if (byteLen + 2 <= dataCw) return v;
  }
  throw new Error("QR payload too long (max ~106 bytes at ECC-L v5)");
}

/**
 * Build the QR module matrix for `text`. Returns a square boolean grid where
 * `true` = dark module. Throws if the payload exceeds v5 capacity.
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = pickVersion(bytes.length);
  const [dataCw, ecCw] = VERSIONS[version];
  const size = version * 4 + 17;

  // ── Bit buffer → data codewords ─────────────────────────────────────────
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4); // byte mode
  pushBits(bytes.length, 8); // char count (8 bits for v1–9 byte mode)
  for (const b of bytes) pushBits(b, 8);
  // Terminator (up to 4 zero bits) + pad to byte boundary.
  const capacityBits = dataCw * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataCodewords.push(byte);
  }
  // Pad bytes 0xEC / 0x11 alternating.
  const pad = [0xec, 0x11];
  let p = 0;
  while (dataCodewords.length < dataCw) dataCodewords.push(pad[p++ % 2]);

  const ecCodewords = rsEncode(dataCodewords, ecCw);
  const all = dataCodewords.concat(ecCodewords);

  // ── Matrix + function-pattern reservation ───────────────────────────────
  const modules: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r: number, c: number, dark: boolean) => {
    modules[r][c] = dark;
    isFn[r][c] = true;
  };

  const finder = (r: number, c: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing =
          dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6);
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        set(rr, cc, inRing || inCore);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    set(6, i, dark);
    set(i, 6, dark);
  }

  // Alignment pattern (v2–5: one pattern).
  if (version >= 2) {
    const a = ALIGN_POS[version];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const ring = Math.max(Math.abs(dr), Math.abs(dc));
        set(a + dr, a + dc, ring !== 1);
      }
    }
  }

  // Dark module.
  set(size - 8, 8, true);

  // Reserve format-info areas (values written after masking).
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      isFn[8][i] = true;
      isFn[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFn[8][size - 1 - i] = true;
    isFn[size - 1 - i][8] = true;
  }

  // ── Place data with zigzag + mask 0 ─────────────────────────────────────
  let bitIdx = 0;
  const totalBits = all.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    const col0 = right === 6 ? 5 : right; // skip timing column 6
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = col0 - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (isFn[row][col]) continue;
        let dark = false;
        if (bitIdx < totalBits) {
          const byte = all[bitIdx >> 3];
          dark = ((byte >> (7 - (bitIdx & 7))) & 1) === 1;
          bitIdx++;
        }
        // Mask 0: invert where (row + col) is even.
        if ((row + col) % 2 === 0) dark = !dark;
        modules[row][col] = dark;
      }
    }
  }

  // ── Format information (ECC L, mask 0) ──────────────────────────────────
  const fmt = FORMAT_L_MASK0;
  const fbit = (i: number) => ((fmt >> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) modules[8][i] = fbit(i);
  modules[8][7] = fbit(6);
  modules[8][8] = fbit(7);
  modules[7][8] = fbit(8);
  for (let i = 9; i < 15; i++) modules[14 - i][8] = fbit(i);
  for (let i = 0; i < 8; i++) modules[size - 1 - i][8] = fbit(i);
  for (let i = 8; i < 15; i++) modules[8][size - 15 + i] = fbit(i);
  modules[size - 8][8] = true; // dark module

  return modules;
}

/**
 * Render a QR matrix as a crisp, scalable SVG string (with a quiet zone).
 * Suitable for an <img src> via a data URL, or inline.
 */
export function qrSvg(text: string, opts: { size?: number; margin?: number } = {}): string {
  const m = qrMatrix(text);
  const n = m.length;
  const margin = opts.margin ?? 4;
  const dim = n + margin * 2;
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) path += `M${c + margin},${r + margin}h1v1h-1z`;
    }
  }
  const px = opts.size ?? 240;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/>` +
    `</svg>`
  );
}

/** QR as a data URL for use in an <img src>. */
export function qrDataUrl(text: string, opts?: { size?: number; margin?: number }): string {
  const svg = qrSvg(text, opts);
  // Unicode-safe base64.
  const b64 =
    typeof window === "undefined"
      ? Buffer.from(svg, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${b64}`;
}
