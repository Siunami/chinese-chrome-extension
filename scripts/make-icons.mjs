// Generates extension/icons/icon{16,32,48,128}.png without any dependencies:
// a red rounded square with a white 中 built from rectangles, rendered at 4x
// and box-downsampled for antialiasing.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');
mkdirSync(outDir, { recursive: true });

const BG = [181, 35, 43];   // #B5232B
const FG = [255, 255, 255];

function renderHi(S) {
  // returns Float array [r,g,b,a] * S*S, drawn with simple geometry
  const px = new Float64Array(S * S * 4);
  const radius = S * 0.19;
  const inRounded = (x, y) => {
    const r = radius;
    const cx = Math.min(Math.max(x, r), S - r);
    const cy = Math.min(Math.max(y, r), S - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };
  // 中: box outline + center vertical bar
  const stroke = S * 0.075;
  const boxL = S * 0.22, boxR = S * 0.78, boxT = S * 0.32, boxB = S * 0.62;
  const barW = stroke * 1.05;
  const barT = S * 0.14, barB = S * 0.86;
  const cx = S / 2;
  const inGlyph = (x, y) => {
    if (x >= cx - barW / 2 && x <= cx + barW / 2 && y >= barT && y <= barB) return true;
    const inOuter = x >= boxL && x <= boxR && y >= boxT && y <= boxB;
    const inInner = x >= boxL + stroke && x <= boxR - stroke && y >= boxT + stroke && y <= boxB - stroke;
    return inOuter && !inInner;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const fx = x + 0.5, fy = y + 0.5;
      if (!inRounded(fx, fy)) { px[i + 3] = 0; continue; }
      const c = inGlyph(fx, fy) ? FG : BG;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return px;
}

function downsample(hi, S, factor) {
  const s = S / factor;
  const out = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * S + (x * factor + dx)) * 4;
          const alpha = hi[i + 3] / 255;
          r += hi[i] * alpha; g += hi[i + 1] * alpha; b += hi[i + 2] * alpha; a += hi[i + 3];
        }
      }
      const n = factor * factor;
      const o = (y * s + x) * 4;
      const aAvg = a / n;
      const aFrac = aAvg / 255 || 1;
      out[o] = Math.round(r / n / aFrac);
      out[o + 1] = Math.round(g / n / aFrac);
      out[o + 2] = Math.round(b / n / aFrac);
      out[o + 3] = Math.round(aAvg);
    }
  }
  return out;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pwaDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'pwa', 'icons');
mkdirSync(pwaDir, { recursive: true });

// 180 is the apple-touch-icon size; 192/512 are the standard PWA install set.
for (const [dir, sizes] of [[outDir, [16, 32, 48, 128]], [pwaDir, [180, 192, 512]]]) {
  for (const size of sizes) {
    const factor = 4;
    const hi = renderHi(size * factor);
    const rgba = downsample(hi, size * factor, factor);
    writeFileSync(join(dir, `icon${size}.png`), encodePNG(rgba, size));
    console.log(join(dir, `icon${size}.png`));
  }
}
