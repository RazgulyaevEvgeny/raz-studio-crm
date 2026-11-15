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
      const b = new Uint8Array(ch.byteLength); ch.copyTo(b); if (ch.type === 'key') keys.push(sizes.length); chunks.push(b); sizes.push(b.length); },
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
  return { blob: mp4({ w, h, fps, avcc, chunks, sizes, keys }), poster, w, h, sec: sizes.length / fps };
};
})();
