// Generates the app icons (PNG + SVG) with no dependencies. Run: npm run icons
// Design: three rising bars on a blue field, kept inside the central 80% so it survives "maskable" cropping.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [0x1f, 0x6f, 0xeb];
const FG = [0xff, 0xff, 0xff];
// Bars in unit coordinates: [x, width, height]; baseline at y = 0.70.
const BARS = [
  [0.26, 0.12, 0.18],
  [0.44, 0.12, 0.30],
  [0.62, 0.12, 0.44],
];
const BASE = 0.7;
const SS = 4; // 4x4 supersampling for smooth edges

function coverage(px, py, size) {
  let hit = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const u = (px + (sx + 0.5) / SS) / size;
      const v = (py + (sy + 0.5) / SS) / size;
      for (const [x, w, h] of BARS) {
        if (u >= x && u <= x + w && v <= BASE && v >= BASE - h) {
          hit++;
          break;
        }
      }
    }
  }
  return hit / (SS * SS);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, size);
      for (let c = 0; c < 3; c++) raw[row + 1 + x * 3 + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#1f6feb"/>
${BARS.map(([x, w, h]) => `  <rect x="${x * 100}" y="${(BASE - h) * 100}" width="${w * 100}" height="${h * 100}" rx="2" fill="#fff"/>`).join('\n')}
</svg>
`;

mkdirSync('public/icons', { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(`public/icons/${name}`, png(size));
  console.log('wrote', name);
}
writeFileSync('public/icons/icon.svg', svg);
console.log('wrote icon.svg');
