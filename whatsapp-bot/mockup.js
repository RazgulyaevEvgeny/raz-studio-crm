// Визуализация макета: логотип клиента на футболке, худи, свитшоте или шоппере.
// Аня присылает картинку «как это будет выглядеть» прямо в WhatsApp. Всё считается на рабочем компьютере, бесплатно.
// Изделия нарисованы здесь же (SVG); можно передать и своё фото заготовки (opts.blank).
// Картинки собирает библиотека sharp; если её ещё нет на компьютере, бот один раз сам докачивает компоненты (npm install).

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const PHOTOS = join(DIR, 'photos');      // последнее фото каждого клиента (логотип, из которого делаем макет)
const W = 1000, H = 1100;

export const ITEMS = { tshirt: 'футболка', hoodie: 'худи', sweatshirt: 'свитшот', shopper: 'шоппер' };
export const SIDES = { front: 'спереди по центру', back: 'на спине', chest_left: 'на груди слева' };
// Форматы DTF из прайса студии, ширина × высота в см
export const SIZES = { A3: [27, 37], A4: [21, 27], A5: [21, 15], A6: [10, 14] };

const COLORS = [
  [/черн|black/, '#1f1f22'], [/бел|white/, '#f3f3f1'], [/графит|антрацит|темно-?сер|тёмно-?сер/, '#3b3c40'], [/сер|gr[ae]y|меланж/, '#a2a4a8'],
  [/темно-?син|тёмно-?син|navy|нэви/, '#1e2943'], [/голуб|light ?blue/, '#93bbe0'], [/син|blue/, '#2c56aa'],
  [/бордо|вишн|марсал/, '#6b1c28'], [/красн|red/, '#b52430'], [/розов|pink/, '#e9a9bb'], [/оранж|orange/, '#e2742c'],
  [/жёлт|желт|yellow/, '#ebc53c'], [/хаки|олив/, '#6c6b46'], [/зел|green/, '#2f6c3b'], [/молоч|айвори|крем/, '#efe8d9'],
  [/беж|песоч|sand/, '#d8c6a5'], [/фиолет|purple|лилов/, '#5c3d8a'], [/коричн|шоколад|brown/, '#5a3d2b'],
];
export function colorOf(name) {
  const s = String(name || '').toLowerCase().replace(/ё/g, 'е');
  for (const [re, hex] of COLORS) if (re.test(s)) return hex;
  return /^#[0-9a-f]{6}$/i.test(s) ? s : '#1f1f22';
}
const shade = (hex, k) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)))).map(v => v.toString(16).padStart(2, '0')).join('');
const isDark = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return r * 0.3 + g * 0.59 + b * 0.11 < 128; };

/* ---------- sharp: подключаем, при необходимости докачиваем ---------- */
let sharpLib = null, installing = null;
async function sharp() {
  if (sharpLib) return sharpLib;
  try { sharpLib = (await import('sharp')).default; return sharpLib; } catch (_) {}
  installing ||= (async () => {
    console.log('Для макетов нужен компонент sharp, скачиваю (один раз)...');
    await promisify(exec)('npm install --omit=dev --no-fund --no-audit', { cwd: DIR, timeout: 5 * 60e3, windowsHide: true });
    console.log('Компонент sharp скачан');
  })().finally(() => { installing = null; });
  await installing;
  sharpLib = (await import('sharp')).default;
  return sharpLib;
}
// Вызывается при запуске бота: докачать sharp заранее, а не во время ответа клиенту
export function warmUp() { sharp().catch(e => console.log('Не удалось подготовить макеты:', String(e?.message || e).slice(0, 200))); }

/* ---------- последнее фото клиента ---------- */
const safe = id => String(id || '').replace(/[^\w-]/g, '_');
export async function rememberPhoto(chatId, buf) {
  if (!chatId || !buf?.length) return;
  try { await mkdir(PHOTOS, { recursive: true }); await writeFile(join(PHOTOS, safe(chatId) + '.img'), buf); } catch (_) {}
}
export async function lastPhoto(chatId) {
  try { return await readFile(join(PHOTOS, safe(chatId) + '.img')); } catch (_) { return null; }
}

/* ---------- фото заготовок (blanks/) ---------- */
// Настоящие фото пустых изделий: blanks/<изделие>_<black|white>_<front|back>.png (фон вырезан).
// body — какая доля ширины фото приходится на корпус (без рукавов), chest — ширина груди в см,
// front/back — где верх принта (доля высоты), left — центр и верх логотипа на груди слева
const BLANKS = join(DIR, 'blanks');
const PHOTO = {
  tshirt: { chest: 60, body: 0.6, front: 0.2, back: 0.16, left: [0.63, 0.22] },
  hoodie: { chest: 64, body: 0.56, front: 0.28, back: 0.29, left: [0.61, 0.33] },
};
async function photoBase(S, item, side, hex) {
  const p = PHOTO[item];
  if (!p) return null;
  const face = side === 'back' ? 'back' : 'front';
  const load = tone => readFile(join(BLANKS, `${item}_${tone}_${face}.png`)).catch(() => null);
  const h = hex.toLowerCase();
  // Чёрное и белое — как на фото; любой другой цвет — перекрашиваем белую заготовку, сохраняя складки и тени ткани
  let file = h === '#1f1f22' ? await load('black') : h === '#f3f3f1' ? await load('white') : null, tint = false;
  if (!file) { file = await load('white'); tint = !!file && h !== '#f3f3f1'; }
  if (!file) return null;
  if (tint) {
    // Светотень берём размытой: на тёмном цвете иначе проступают квадратики сжатия исходного фото; края тоже сглаживаем
    const { data, info } = await S(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const dark = isDark(hex);
    const lum = await S(file).flatten({ background: '#ffffff' }).greyscale().blur(dark ? 3 : 1.2).extractChannel(0).raw().toBuffer();
    const alpha = await S(file).ensureAlpha().extractChannel(3).blur(dark ? 1.6 : 0.8).raw().toBuffer();
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    let sum = 0, cnt = 0;
    for (let i = 0; i < lum.length; i++) if (data[i * 4 + 3] > 200) { sum += lum[i]; cnt++; }
    const mean = cnt ? sum / cnt : 230, k = dark ? 0.9 : 1;
    for (let i = 0; i < lum.length; i++) {
      const d = (lum[i] - mean) * k;
      for (let j = 0; j < 3; j++) data[i * 4 + j] = Math.max(0, Math.min(255, Math.round(c[j] + d)));
      data[i * 4 + 3] = alpha[i];
    }
    file = await S(data, { raw: info }).png().toBuffer();
  }
  const g = await S(file).resize(900, 900, { fit: 'inside' }).png().toBuffer();
  const m = await S(g).metadata();
  const gx = Math.round((W - m.width) / 2), gy = Math.round(30 + (900 - m.height) / 2);
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#f7f7f5"/><stop offset="1" stop-color="#dedfdc"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/><ellipse cx="500" cy="${gy + m.height + 8}" rx="${Math.round(m.width * 0.38)}" ry="14" fill="#00000018"/>
    <text x="500" y="1092" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#777">Разгуляев · студия брендирования · примерная визуализация</text></svg>`);
  const base = await S(bg).png().composite([{ input: g, left: gx, top: gy }]).png().toBuffer();
  const px = m.width * p.body / p.chest;
  const cx = gx + m.width * (side === 'chest_left' ? p.left[0] : 0.5);
  const top = gy + m.height * (side === 'chest_left' ? p.left[1] : p[face]);
  return { base, px, cx, top: Math.round(top) };
}

/* ---------- изделия (SVG) ---------- */
// Каждое изделие: силуэт, детали поверх и где печатать. px — сколько пикселей в 1 см (ширина груди ~52 см)
const GARMENTS = {
  tshirt: {
    px: 11.2,
    body: side => `M360 90 Q500 ${side === 'back' ? 125 : 175} 640 90 L800 132 L962 330 L852 404 L790 336 L790 1040 L210 1040 L210 336 L148 404 L38 330 L200 132 Z`,
    extra: side => `<path d="M360 90 Q500 ${side === 'back' ? 125 : 175} 640 90" fill="none" stroke="#0004" stroke-width="10"/>
      <path d="M210 336 L200 132 M790 336 L800 132" stroke="#0002" stroke-width="3" fill="none"/>`,
    top: { front: 240, back: 205, chest_left: 250 },
  },
  sweatshirt: {
    px: 11.2,
    body: side => `M370 92 Q500 ${side === 'back' ? 125 : 165} 630 92 L800 132 L905 470 L955 930 L860 950 L800 520 L790 1000 L210 1000 L200 520 L140 950 L45 930 L95 470 L200 132 Z`,
    extra: side => `<path d="M370 92 Q500 ${side === 'back' ? 125 : 165} 630 92" fill="none" stroke="#0004" stroke-width="14"/>
      <rect x="212" y="950" width="576" height="48" fill="#0002"/><path d="M48 905 L955 905" stroke="none"/>
      <path d="M140 950 L45 930 L50 885 L150 905 Z M860 950 L955 930 L950 885 L850 905 Z" fill="#0002"/>`,
    top: { front: 255, back: 215, chest_left: 260 },
  },
  hoodie: {
    px: 11.2,
    body: side => `M330 120 Q330 20 500 18 Q670 20 670 120 L800 150 L905 480 L955 930 L860 950 L800 530 L790 1000 L210 1000 L200 530 L140 950 L45 930 L95 480 L200 150 Z`,
    extra: side => side === 'back'
      ? `<path d="M340 140 Q500 330 660 140" fill="none" stroke="#0003" stroke-width="6"/><rect x="212" y="950" width="576" height="48" fill="#0002"/>
         <path d="M140 950 L45 930 L50 885 L150 905 Z M860 950 L955 930 L950 885 L850 905 Z" fill="#0002"/>`
      : `<path d="M345 125 Q500 250 655 125 Q640 60 500 55 Q360 60 345 125 Z" fill="#0005"/>
         <path d="M460 210 L452 330 M540 210 L548 330" stroke="#fff9" stroke-width="7" stroke-linecap="round"/>
         <path d="M300 700 L700 700 L760 930 L240 930 Z" fill="none" stroke="#0003" stroke-width="5"/>
         <rect x="212" y="950" width="576" height="48" fill="#0002"/>
         <path d="M140 950 L45 930 L50 885 L150 905 Z M860 950 L955 930 L950 885 L850 905 Z" fill="#0002"/>`,
    top: { front: 365, back: 300, chest_left: 345 },
  },
  shopper: {
    px: 14.2,
    body: () => `M230 330 L770 330 L770 1040 L230 1040 Z`,
    extra: () => `<path d="M330 335 Q330 90 500 90 Q670 90 670 335" fill="none" stroke="currentColor" stroke-width="38"/>
      <path d="M230 330 L770 330" stroke="#0002" stroke-width="6"/>`,
    top: { front: 470, back: 470, chest_left: 470 },
  },
};

function garmentSvg(item, side, hex) {
  const g = GARMENTS[item];
  const s = side === 'chest_left' ? 'front' : side;
  const dark = isDark(hex);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#f7f7f5"/><stop offset="1" stop-color="#dedfdc"/></radialGradient>
    <linearGradient id="sh" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset=".22" stop-color="#000" stop-opacity="0"/>
      <stop offset=".78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
    <linearGradient id="hl" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${dark ? '.10' : '.25'}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <ellipse cx="500" cy="1062" rx="360" ry="16" fill="#0000001a"/>
  <g color="${shade(hex, 0.92)}">
    <path d="${g.body(s)}" fill="${hex}" stroke="${shade(hex, dark ? 1.6 : 0.8)}" stroke-width="3" stroke-linejoin="round"/>
    <path d="${g.body(s)}" fill="url(#sh)"/><path d="${g.body(s)}" fill="url(#hl)"/>
    ${g.extra(s)}
  </g>
  <text x="500" y="1092" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#777">Разгуляев · студия брендирования · примерная визуализация</text>
</svg>`;
}

/* ---------- размерные стрелки над принтом и справа от него ---------- */
function sizeArrows(x, y, w, h, wcm, hcm, dark, emb, capY) {
  // Стрелки полупрозрачные, чтобы не спорили с принтом; размер ещё раз крупно подписан рядом с изделием
  const c = dark ? '#ffffff' : '#1d1d1f', pill = dark ? '#00000055' : '#ffffff66';
  const cm = v => (v >= 10 ? Math.round(v) : Math.round(v * 2) / 2).toString().replace('.', ',') + ' см';
  const gy = Math.max(30, y - 22), gx = Math.min(W - 30, x + w + 22);
  const head = (x1, y1, dx, dy) => `<path d="M${x1} ${y1} l${-dx * 10 - dy * 6} ${-dy * 10 + dx * 6} M${x1} ${y1} l${-dx * 10 + dy * 6} ${-dy * 10 - dx * 6}" />`;
  const label = (tx, ty, t, lw = 68) => `<rect x="${tx - lw / 2}" y="${ty - 15}" width="${lw}" height="24" rx="12" fill="${pill}"/><text x="${tx}" y="${ty + 3}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="15" fill="${c}" fill-opacity=".6">${t}</text>`;
  const low = h < 40; // низкая надпись: высоту пишем в верхней подписи, без вертикальной стрелки
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <g stroke="${c}" stroke-opacity=".45" stroke-width="2" fill="none" stroke-linecap="round">
    <path d="M${x} ${gy - 7} v14 M${x + w} ${gy - 7} v14 M${x} ${gy} H${x + w}"/>${head(x, gy, -1, 0)}${head(x + w, gy, 1, 0)}
    ${low ? '' : `<path d="M${gx - 7} ${y} h14 M${gx - 7} ${y + h} h14 M${gx} ${y} V${y + h}"/>${head(gx, y, 0, -1)}${head(gx, y + h, 0, 1)}`}
  </g>
  ${low ? label(x + w / 2, gy - 20, cm(wcm).replace(' см', '') + ' × ' + cm(hcm), 120) : label(x + w / 2, gy - 20, cm(wcm)) + label(Math.min(W - 40, gx + 40), y + h / 2, cm(hcm))}
  <text x="500" y="${capY}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="26" fill="#3a3a3c">Размер ${emb ? 'вышивки' : 'принта'} ≈ ${cm(wcm).replace(' см', '')} × ${cm(hcm)}</text>
</svg>`);
}

/* ---------- логотип: убираем однотонный фон, обрезаем поля ---------- */
async function cleanLogo(buf) {
  const S = await sharp();
  const { data, info } = await S(buf).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info, n = w * h;
  let clear = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 200) clear++;
  if (clear < n * 0.02) {
    // Фон: средний цвет по краю картинки; убираем всё похожее на него, что соединено с краем (сам логотип не трогаем)
    const edge = [];
    for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) edge.push(y * w, y * w + w - 1);
    const avg = [0, 1, 2].map(c => edge.reduce((s, p) => s + data[p * 4 + c], 0) / edge.length);
    const near = p => Math.hypot(data[p * 4] - avg[0], data[p * 4 + 1] - avg[1], data[p * 4 + 2] - avg[2]) < 62;
    const seen = new Uint8Array(n), stack = edge.filter(near);
    stack.forEach(p => (seen[p] = 1));
    while (stack.length) {
      const p = stack.pop(), x = p % w;
      data[p * 4 + 3] = 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < n && !seen[q] && near(q)) { seen[q] = 1; stack.push(q); }
    }
  }
  // Поля вокруг логотипа обрезаем
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0 || (x1 - x0 + 1) * (y1 - y0 + 1) < n * 0.003) return S(buf).rotate().png().toBuffer(); // фон убрать не вышло — берём как есть
  return S(data, { raw: { width: w, height: h, channels: 4 } }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer();
}

// Надпись вместо картинки (клиент просто написал название)
function textLogo(text, hex) {
  const t = String(text).trim().slice(0, 40).replace(/[<&>]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
  const fill = isDark(hex) ? '#ffffff' : '#111111';
  const fs = 120, wpx = Math.round(t.length * fs + 200); // с запасом: лишние поля потом обрезаются
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${wpx}" height="${fs * 1.3}"><text x="50%" y="${fs}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${fs}" fill="${fill}">${t}</text></svg>`);
}

/**
 * Собирает визуализацию. Возвращает JPEG (Buffer).
 * opts: { item, color, side, size, logo (Buffer) | text, blank (Buffer — своё фото заготовки из учёта) }
 */
export async function makeMockup(opts) {
  const S = await sharp();
  const item = GARMENTS[opts.item] ? opts.item : 'tshirt';
  const side = SIDES[opts.side] ? opts.side : 'front';
  const size = SIZES[opts.size] ? opts.size : side === 'chest_left' ? 'A6' : 'A4';
  const hex = colorOf(opts.color);
  const g = GARMENTS[item];

  // Сначала настоящее фото заготовки (blanks/), если для изделия его нет — рисованное изделие
  const photo = opts.blank ? null : await photoBase(S, item, side, hex).catch(e => { console.log('Фото заготовки не подошло:', String(e?.message || e).slice(0, 200)); return null; });
  const base = opts.blank
    ? await S(opts.blank).rotate().resize(W, H, { fit: 'cover' }).png().toBuffer()
    : photo ? photo.base : await S(Buffer.from(garmentSvg(item, side, hex))).png().toBuffer();

  let logo = opts.logo ? await cleanLogo(opts.logo) : await S(textLogo(opts.text || 'LOGO', hex)).trim().png().toBuffer();
  const emb = opts.method === 'embroidery';
  let [cw, ch] = emb ? (side === 'chest_left' ? [8, 8] : [20, 20])
    : side === 'chest_left' ? [Math.min(10, SIZES[size][0]), Math.min(10, SIZES[size][1])] : SIZES[size];
  // Клиент назвал ширину в см — подгоняем по ширине (вышивка не больше 20×20 см)
  if (+opts.width_cm > 0) { cw = Math.min(+opts.width_cm, emb ? 20 : 37); ch = emb ? 20 : 45; }
  const px = photo ? photo.px : g.px;
  const box = { w: Math.round(cw * px), h: Math.round(ch * px) };
  logo = await S(logo).ensureAlpha().resize(box.w, box.h, { fit: 'inside' }).png().toBuffer();
  const meta = await S(logo).metadata();
  const cx = photo ? photo.cx : side === 'chest_left' ? (item === 'shopper' ? 500 : 640) : 500;
  const top = photo ? photo.top : opts.blank ? Math.round(H * (side === 'back' ? 0.24 : 0.28)) : g.top[side];
  const left = Math.round(cx - meta.width / 2);
  const layers = [{ input: logo, left, top }];
  if (photo) {
    // Складки ткани поверх принта: берём светотень фото под принтом и накладываем мягким светом — печать выглядит «на ткани»
    const region = await S(base).extract({ left, top, width: meta.width, height: meta.height }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const avg = region.data.reduce((a, v) => a + v, 0) / region.data.length;
    const alpha = await S(logo).extractChannel(3).raw().toBuffer();
    const shadeBuf = Buffer.alloc(meta.width * meta.height * 4);
    for (let i = 0; i < meta.width * meta.height; i++) {
      const v = Math.max(0, Math.min(255, Math.round(128 + (region.data[i] - avg) * 1.8)));
      shadeBuf[i * 4] = shadeBuf[i * 4 + 1] = shadeBuf[i * 4 + 2] = v; shadeBuf[i * 4 + 3] = alpha[i];
    }
    layers.push({ input: shadeBuf, raw: { width: meta.width, height: meta.height, channels: 4 }, left, top, blend: 'soft-light' });
  }
  // Правило Евгения: на мокапе стрелками показываем примерный размер принта или вышивки в см
  layers.push({ input: sizeArrows(left, top, meta.width, meta.height, meta.width / px, meta.height / px, isDark(hex), emb, photo ? 1040 : 44), left: 0, top: 0 });
  return S(base).composite(layers).jpeg({ quality: 88 }).toBuffer();
}

export function describe(o) {
  const size = SIZES[o.size] ? o.size : o.side === 'chest_left' ? 'A6' : 'A4';
  const how = o.method === 'embroidery' ? `вышивка${+o.width_cm > 0 ? ' ~' + Math.min(+o.width_cm, 20) + ' см' : ''}` : +o.width_cm > 0 ? `DTF ~${o.width_cm} см` : `DTF ${size}`;
  return `${ITEMS[o.item] || ITEMS.tshirt}, ${String(o.color || 'чёрный').toLowerCase()}, ${SIDES[o.side] || SIDES.front}, ${how}`;
}
