/* Пережатие роликов для ТВ-приставки прямо в браузере (Chrome, WebCodecs).
   Почему: ролики с айфона часто 4K / 60 к/с и большого битрейта — слабая приставка
   не тянет несколько таких сразу, и видео подвисает. Здесь каждый кадр берётся из ролика
   по порядку и кодируется в H.264 с ровным шагом 30 к/с, до 1280 px по длинной стороне.
   Рывков, как у MediaRecorder, нет: время кадров ставим сами, а не по часам. */
(function(){
const TVV = window.TVV = {};
TVV.supported = () => typeof window.VideoEncoder === 'function' && typeof window.VideoFrame === 'function';

/* ---------- минимальный MP4 (moov в начале — приставка открывает сразу) ---------- */
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = n => [(n >>> 8) & 255, n & 255];
const str = s => [...s].map(c => c.charCodeAt(0));
const box = (type, ...parts) => { const body = [].concat(...parts.map(p => p instanceof Uint8Array ? [...p] : p)); return [...u32(body.length + 8), ...str(type), ...body]; };
const full = (type, v, flags, ...parts) => box(type, [v, ...u32(flags).slice(1)], ...parts);
const MATRIX = [].concat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));

function moov(o, base){
  const TS = 90000, n = o.sizes.length, dur = Math.round(n * TS / o.fps), ms = Math.round(n * 1000 / o.fps);
  let off = base; const stco = o.sizes.map(s => { const r = off; off += s; return u32(r); });
  return box('moov',
    full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x10000), u16(0x100), new Array(10).fill(0), MATRIX, new Array(24).fill(0), u32(2)),
    box('trak',
      full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(ms), new Array(8).fill(0), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(o.w << 16), u32(o.h << 16)),
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(dur), u16(0x55c4), u16(0)),
        full('hdlr', 0, 0, u32(0), str('vide'), new Array(12).fill(0), str('VideoHandler'), [0]),
        box('minf',
          full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
          box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
          box('stbl',
            full('stsd', 0, 0, u32(1), box('avc1', new Array(6).fill(0), u16(1), new Array(16).fill(0), u16(o.w), u16(o.h), u32(0x480000), u32(0x480000), u32(0), u16(1), new Array(32).fill(0), u16(0x18), u16(0xffff), box('avcC', o.avcc))),
            full('stts', 0, 0, u32(1), u32(n), u32(Math.round(TS / o.fps))),
            full('stss', 0, 0, u32(o.keys.length), ...o.keys.map(k => u32(k + 1))),
            full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
            full('stsz', 0, 0, u32(0), u32(n), ...o.sizes.map(u32)),
            full('stco', 0, 0, u32(n), ...stco))))));
}
function mp4(o){
  const ftyp = box('ftyp', str('isom'), u32(512), str('isomiso2avc1mp41'));
  const total = o.chunks.reduce((a, c) => a + c.length, 0);
  const probe = moov(o, 0).length;
  const mv = moov(o, ftyp.length + probe + 8);
  return new Blob([new Uint8Array(ftyp), new Uint8Array(mv), new Uint8Array([...u32(total + 8), ...str('mdat')]), ...o.chunks], { type: 'video/mp4' });
}

/* ---------- чистка потока для приставок ----------
   Кодировщик браузера (OpenH264) ставит перед каждым кадром служебный блок «префикс SVC» (NAL 14)
   и разрешает пропуски номеров кадров в SPS. Браузеры это пропускают, а аппаратный декодер
   дешёвых приставок на этом зависает (в журнале — «timed out») и не показывает ни кадра. */
const DROP = { 14: 1, 15: 1, 20: 1 };
// убрать NAL 14/15/20 из кадра (длины NAL — 4 байта)
TVV.cleanSample = (b) => {
  let p = 0, keep = [], drop = false;
  while (p + 4 <= b.length) { const L = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; if (!L || p + 4 + L > b.length) return b;
    if (DROP[b[p + 4] & 31]) drop = true; else keep.push([p, 4 + L]); p += 4 + L; }
  if (!drop) return b;
  const out = new Uint8Array(keep.reduce((a, k) => a + k[1], 0)); let o = 0; keep.forEach(k => { out.set(b.subarray(k[0], k[0] + k[1]), o); o += k[1]; }); return out;
};
// SPS: снять флаг gaps_in_frame_num_value_allowed_flag (длина SPS не меняется — меняется один бит)
function unesc(a){ const o = [], map = []; for (let i = 0; i < a.length; i++) { if (i >= 2 && a[i] === 3 && a[i - 1] === 0 && a[i - 2] === 0) continue; o.push(a[i]); map.push(i); } return { o, map }; }
function esc(a){ const o = []; let z = 0; for (const x of a) { if (z >= 2 && x <= 3) { o.push(3); z = 0; } o.push(x); z = x === 0 ? z + 1 : 0; } return o; }
function fixSps(sps){
  const { o } = unesc(sps); let p = 8;   // после заголовка NAL
  const bit = () => { const v = (o[p >> 3] >> (7 - (p & 7))) & 1; p++; return v; }, n = k => { let v = 0; for (let i = 0; i < k; i++) v = v * 2 + bit(); return v; };
  const ue = () => { let z = 0; while (bit() === 0 && z < 32) z++; return (2 ** z - 1) + n(z); };
  const prof = n(8); n(16); ue();
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(prof)) { const ch = ue(); if (ch === 3) bit(); ue(); ue(); bit(); if (bit()) return sps; }   // с матрицами квантования не трогаем
  ue(); const poc = ue(); if (poc === 0) ue(); else if (poc === 1) { bit(); ue(); ue(); const k = ue(); for (let i = 0; i < k; i++) ue(); }
  ue(); const at = p; if (!bit()) return sps;
  o[at >> 3] &= ~(1 << (7 - (at & 7)));
  return esc(o);
}
TVV.cleanAvcc = (avcc) => {
  const a = [...avcc]; if (a.length < 7) return avcc;
  const nsps = a[5] & 31; let q = 6; const out = a.slice(0, 6);
  for (let i = 0; i < nsps; i++) { const L = (a[q] << 8) | a[q + 1]; const sp = fixSps(a.slice(q + 2, q + 2 + L)); out.push((sp.length >> 8) & 255, sp.length & 255, ...sp); q += 2 + L; }
  return new Uint8Array(out.concat(a.slice(q)));
};

/* Почистить уже готовый ролик (сделанный TVV.optimize) без пережатия. Возвращает { blob, changed } */
TVV.clean = async (src) => {
  const u = new Uint8Array(await (typeof src === 'string' ? fetch(src).then(r => r.arrayBuffer()) : src.arrayBuffer()));
  const R32 = p => ((u[p] << 24) | (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3]) >>> 0, R16 = p => (u[p] << 8) | u[p + 1];
  const find = (t, from, to) => { for (let i = from + 4; i < to - 4; i++) if (u[i] === t.charCodeAt(0) && u[i + 1] === t.charCodeAt(1) && u[i + 2] === t.charCodeAt(2) && u[i + 3] === t.charCodeAt(3)) return i - 4; return -1; };
  const moov = find('moov', 0, Math.min(u.length, 4096)); if (moov < 0) throw new Error('ролик не в нашем формате — загрузите его заново');
  const mend = moov + R32(moov), fm = t => find(t, moov, mend);
  const avc1 = fm('avc1'), avcC = fm('avcC'), stsz = fm('stsz'), stco = fm('stco'), stss = fm('stss'), stts = fm('stts'), mdhd = fm('mdhd');
  if (avc1 < 0 || avcC < 0 || stsz < 0 || stco < 0 || stts < 0 || mdhd < 0 || R32(stsz + 12) !== 0 || R32(stts + 12) !== 1) throw new Error('ролик не в нашем формате — загрузите его заново');
  if ((u[avcC + 8 + 4] & 3) !== 3) throw new Error('необычный формат кадров');
  const n = R32(stsz + 16); if (R32(stco + 12) !== n) throw new Error('необычная раскладка кадров');
  const ts = R32(mdhd + 20), fps = Math.round(ts / R32(stts + 20)) || 30;
  const w = R16(avc1 + 32), h = R16(avc1 + 34);
  const avcc0 = u.slice(avcC + 8, avcC + R32(avcC)), avcc = TVV.cleanAvcc(avcc0);
  const keys = []; if (stss >= 0) for (let i = 0, k = R32(stss + 12); i < k; i++) keys.push(R32(stss + 16 + i * 4) - 1); else keys.push(0);
  const chunks = [], sizes = []; let changed = avcc.length !== avcc0.length || avcc.some((x, i) => x !== avcc0[i]);
  for (let i = 0; i < n; i++) { const off = R32(stco + 16 + i * 4), sz = R32(stsz + 20 + i * 4), b = u.subarray(off, off + sz), c = TVV.cleanSample(b); if (c !== b) changed = true; chunks.push(c); sizes.push(c.length); }
  return { blob: mp4({ w, h, fps, avcc, chunks, sizes, keys }), changed };
};

/* ---------- пережатие ---------- */
// src — File/Blob или dataURL. Возвращает { blob, poster, w, h, sec }.
TVV.optimize = async (src, opt = {}) => {
  const max = opt.max || 1280, fps = opt.fps || 30, maxSec = opt.maxSec || 30, onp = opt.progress || (() => {});
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('ролик не читается')); });
  const vw = v.videoWidth, vh = v.videoHeight, k = Math.min(1, max / Math.max(vw, vh));
  const w = Math.max(2, Math.round(vw * k / 2) * 2), h = Math.max(2, Math.round(vh * k / 2) * 2);
  const sec = Math.min(maxSec, v.duration || maxSec), total = Math.max(1, Math.floor(sec * fps));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  const chunks = [], sizes = [], keys = []; let avcc = null, err = null;
  const enc = new VideoEncoder({
    output: (ch, meta) => { if (meta && meta.decoderConfig && meta.decoderConfig.description && !avcc) avcc = new Uint8Array(meta.decoderConfig.description);
      let b = new Uint8Array(ch.byteLength); ch.copyTo(b); b = TVV.cleanSample(b); if (ch.type === 'key') keys.push(sizes.length); chunks.push(b); sizes.push(b.length); },
    error: e => { err = e; } });
  const bitrate = Math.round(Math.min(6e6, Math.max(1.5e6, w * h * fps * 0.11)));
  let codec = null;
  for (const cd of ['avc1.4d0028', 'avc1.42002a', 'avc1.640028', 'avc1.42001f']) {
    const s = await VideoEncoder.isConfigSupported({ codec: cd, width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' } }).catch(() => null);
    if (s && s.supported) { codec = cd; break; } }
  if (!codec) throw new Error('браузер не умеет кодировать H.264');
  enc.configure({ codec, width: w, height: h, bitrate, framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' });
  // ролик идёт в 2 раза медленнее, чтобы браузер точно успевал отдать каждый кадр
  v.playbackRate = 0.5; let idx = 0, poster = null;
  await new Promise((res, rej) => {
    const take = async (now, md) => {
      if (err) return rej(err);
      const t = md ? md.mediaTime : v.currentTime;
      while (idx < total && t + 0.0005 >= idx / fps) {
        g.drawImage(v, 0, 0, w, h);
        if (!poster) poster = c.toDataURL('image/jpeg', 0.85);
        const fr = new VideoFrame(c, { timestamp: Math.round(idx * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(fr, { keyFrame: idx % (fps * 2) === 0 }); fr.close(); idx++;
      }
      onp(Math.min(99, Math.round(idx / total * 100)));
      if (idx >= total || v.ended) return res();
      while (enc.encodeQueueSize > 12) await new Promise(r => setTimeout(r, 10));
      v.requestVideoFrameCallback(take);
    };
    v.onended = () => setTimeout(res, 50);
    v.requestVideoFrameCallback(take);
    v.play().catch(rej);
  });
  v.pause();
  await enc.flush(); enc.close();
  if (err) throw err;
  if (!avcc || !sizes.length) throw new Error('не получилось закодировать');
  return { blob: mp4({ w, h, fps, avcc: TVV.cleanAvcc(avcc), chunks, sizes, keys }), poster, w, h, sec: sizes.length / fps };
};
})();
