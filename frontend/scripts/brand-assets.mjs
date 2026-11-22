// Genera los recursos de marca a partir de public/logo-oficial.png (fondo blanco → transparente).
// Uso: node scripts/brand-assets.mjs  (requiere sharp, ya incluido por Next)
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const SRC = 'public/logo-oficial.png';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;

// 1) Fondo blanco → transparente con borde suave: alpha según "blancura" (mínimo de los canales)
//    y color des-mezclado del blanco para que los bordes no queden con halo claro.
const HI = 238, LO = 150;
const px = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  const w = Math.min(r, g, b);
  const a = Math.max(0, Math.min(1, (HI - w) / (HI - LO)));
  if (a === 0) continue;
  const un = (c) => Math.max(0, Math.min(255, Math.round((c - 255 * (1 - a)) / a)));
  px[i * 4] = un(r); px[i * 4 + 1] = un(g); px[i * 4 + 2] = un(b); px[i * 4 + 3] = Math.round(a * 255);
}

const alphaAt = (x, y) => px[(y * W + x) * 4 + 3];
function bbox(y0, y1) {
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (alphaAt(x, y) > 24) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}
// Filas con tinta → bandas (globo, palabra JURISGLOBAL, lema)
const rowInk = Array.from({ length: H }, (_, y) => { let n = 0; for (let x = 0; x < W; x++) if (alphaAt(x, y) > 24) n++; return n; });
const bands = [];
for (let y = 0, start = -1; y <= H; y++) {
  const ink = y < H && rowInk[y] > 2;
  if (ink && start < 0) start = y;
  if (!ink && start >= 0) { if (y - start > 8) bands.push([start, y]); start = -1; }
}
// Une bandas separadas por huecos pequeños (p. ej. la tilde de "Jurídicas")
const merged = [];
for (const b of bands) { const last = merged.at(-1); if (last && b[0] - last[1] < 25) last[1] = b[1]; else merged.push([...b]); }
console.log('bandas', merged);
if (merged.length !== 3) throw new Error('Se esperaban 3 bandas (globo, nombre, lema)');

const rgba = { raw: { width: W, height: H, channels: 4 } };
const base = () => sharp(px, rgba);
async function crop(y0, y1, pad, out, dark = false, maxW = 1024) {
  const b = bbox(y0, y1);
  const left = Math.max(0, b.minX - pad), top = Math.max(0, b.minY - pad);
  const w = Math.min(W, b.maxX + pad + 1) - left, h = Math.min(H, b.maxY + pad + 1) - top;
  let buf = await base().extract({ left, top, width: w, height: h }).raw().toBuffer();
  buf = flatColors(buf, dark);
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .resize({ width: Math.min(w, maxW), kernel: 'lanczos3' }).png({ compressionLevel: 9, palette: false }).toFile(out);
  console.log(out, `${Math.min(w, maxW)}px de ancho`);
  return { w, h, buf };
}
// Colores planos de la marca (quita el ruido del archivo original). En la versión para fondo
// oscuro el azul marino pasa a blanco y el dorado se conserva.
const NAVY = [13, 34, 61], GOLD = [202, 158, 61], WHITE = [255, 255, 255];
function flatColors(buf, dark) {
  const o = Buffer.from(buf);
  for (let i = 0; i < o.length; i += 4) {
    if (!o[i + 3]) continue;
    const c = o[i] - o[i + 2] < 40 ? (dark ? WHITE : NAVY) : GOLD;
    o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2];
  }
  return o;
}

const [globe, name, tagline] = merged;
await crop(0, H, 8, 'public/brand/logo-vertical.png');
await crop(0, H, 8, 'public/brand/logo-vertical-dark.png', true);
const iso = await crop(globe[0], globe[1], 4, 'public/brand/isotipo.png', false, 512);
await crop(globe[0], globe[1], 4, 'public/brand/isotipo-dark.png', true, 512);
await crop(name[0], name[1], 4, 'public/brand/wordmark.png');
await crop(name[0], name[1], 4, 'public/brand/wordmark-dark.png', true);
await crop(tagline[0], tagline[1], 4, 'public/brand/tagline.png');
await crop(tagline[0], tagline[1], 4, 'public/brand/tagline-dark.png', true);

// 2) Íconos: isotipo centrado en un cuadrado
const isoPng = await sharp(iso.buf, { raw: { width: iso.w, height: iso.h, channels: 4 } }).png().toBuffer();
async function square(size, padRatio, background) {
  const inner = Math.round(size * (1 - 2 * padRatio));
  const mark = await sharp(isoPng).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer();
}
const clear = { r: 0, g: 0, b: 0, alpha: 0 }, white = { r: 255, g: 255, b: 255, alpha: 1 };
writeFileSync('src/app/icon.png', await square(512, 0.02, clear));
const apple = await square(180, 0.1, white); // iOS rellena la transparencia con negro: fondo blanco
writeFileSync('src/app/apple-icon.png', apple);
writeFileSync('public/apple-touch-icon.png', apple);

// favicon.ico con PNG embebidos (16, 32, 48)
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => square(s, 0, clear)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header[e] = s; header[e + 1] = s; header[e + 2] = 0; header[e + 3] = 0;
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
writeFileSync('src/app/favicon.ico', Buffer.concat([header, ...pngs]));
console.log('íconos listos');
