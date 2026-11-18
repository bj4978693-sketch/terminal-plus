// Draws the Terminal Plus app icon (256x256 PNG) with no dependencies: gradient tile, ">_" prompt, "+" badge.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const N = 256;
const px = Buffer.alloc(N * N * 4);
const clamp = (v) => Math.max(0, Math.min(1, v));
const segDist = (x, y, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};
const roundRectDist = (x, y, x0, y0, x1, y1, r) => {
  const qx = Math.max(x0 + r - x, 0, x - (x1 - r)), qy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return Math.hypot(qx, qy) - r;
};
const blend = (i, r, g, b, a) => {
  const ia = 1 - a;
  px[i] = px[i] * ia + r * a; px[i + 1] = px[i + 1] * ia + g * a; px[i + 2] = px[i + 2] * ia + b * a;
  px[i + 3] = Math.min(255, px[i + 3] * ia + 255 * a);
};

for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const i = (y * N + x) * 4, cx = x + 0.5, cy = y + 0.5;
  const tile = clamp(0.5 - roundRectDist(cx, cy, 8, 8, 248, 248, 56));
  if (tile <= 0) continue;
  const t = (cx + cy) / (2 * N); // diagonal gradient #1a73ff -> #7b3fe4
  blend(i, 26 + (123 - 26) * t, 115 + (63 - 115) * t, 255 + (228 - 255) * t, tile);
  const stroke = (d, w) => clamp(w / 2 - d + 0.5);
  const chevron = Math.min(segDist(cx, cy, 64, 80, 112, 128), segDist(cx, cy, 112, 128, 64, 176));
  blend(i, 255, 255, 255, stroke(chevron, 24) * tile);
  blend(i, 255, 255, 255, stroke(segDist(cx, cy, 132, 176, 188, 176), 24) * tile);
  const plus = Math.min(segDist(cx, cy, 184, 52, 184, 108), segDist(cx, cy, 156, 80, 212, 80));
  blend(i, 143, 232, 255, stroke(plus, 20) * tile);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png(N, N, px));
console.log('wrote', out);
