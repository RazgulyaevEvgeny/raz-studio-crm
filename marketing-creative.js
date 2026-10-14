/* Дизайнер креативов RAZ: рисует пост или сторис на холсте (canvas) по описанию от ИИ.
   Текст всегда рисуется шрифтом сайта, поэтому русские буквы ровные. Фото — своё или фон от ИИ. */
(function () {
  const FORMATS = {
    post: { l: 'Пост 4:5', w: 1080, h: 1350 },
    story: { l: 'Сторис 9:16', w: 1080, h: 1920 },
    square: { l: 'Квадрат 1:1', w: 1080, h: 1080 }
  };
  const TEMPLATES = { bold: 'Яркий', photo: 'Фото на весь экран', price: 'С ценой', list: 'Список преимуществ' };
  const THEMES = {
    blue: { l: 'Синий', bg: '#4358ef', bg2: '#3346d8', fg: '#ffffff', sub: 'rgba(255,255,255,.84)', acc: '#ffffff', accFg: '#0a0b14', logo: '#ffffff', deco: 'rgba(255,255,255,.10)' },
    dark: { l: 'Тёмный', bg: '#0a0b14', bg2: '#1b1d33', fg: '#ffffff', sub: 'rgba(255,255,255,.74)', acc: '#4358ef', accFg: '#ffffff', logo: '#ffffff', deco: 'rgba(67,88,239,.28)' },
    light: { l: 'Светлый', bg: '#f2f3f9', bg2: '#e4e6f4', fg: '#0a0b14', sub: '#5b5f7b', acc: '#4358ef', accFg: '#ffffff', logo: '#4358ef', deco: 'rgba(67,88,239,.12)' }
  };
  const HANDLE = '@raz.brandstudio';
  const F = '"Inter Tight","Inter",system-ui,sans-serif';

  /* ---------- шрифты и логотип ---------- */
  let fontsReady = null;
  const ensureFonts = () => fontsReady || (fontsReady = Promise.all(['800 80px "Inter Tight"', '600 40px "Inter Tight"', '500 40px "Inter"'].map(f => document.fonts ? document.fonts.load(f).catch(() => {}) : 0)));
  const logoCache = {};
  function logo(color) {
    if (logoCache[color]) return logoCache[color];
    const src = document.querySelector('.logo svg');
    if (!src) return (logoCache[color] = Promise.resolve(null));
    const c = src.cloneNode(true);
    const vb = (c.getAttribute('viewBox') || '0 0 200 60').split(/\s+/).map(Number);
    c.setAttribute('width', vb[2] * 4); c.setAttribute('height', vb[3] * 4);
    c.setAttribute('style', 'color:' + color); c.setAttribute('color', color);
    c.removeAttribute('class');
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c));
    return (logoCache[color] = new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url; }));
  }
  const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

  /* ---------- примитивы ---------- */
  function rr(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function cover(ctx, img, x, y, w, h, r) {
    const k = Math.max(w / img.width, h / img.height), iw = img.width * k, ih = img.height * k;
    ctx.save(); if (r) { rr(ctx, x, y, w, h, r); ctx.clip(); }
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); ctx.restore();
  }
  function lines(ctx, text, maxW) {
    const out = [];
    String(text || '').split('\n').forEach(par => {
      let cur = '';
      par.split(/\s+/).filter(Boolean).forEach(w => {
        const t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = w; }
      });
      if (cur) out.push(cur);
    });
    return out;
  }
  /* подбирает размер шрифта, чтобы текст влез в рамку */
  function fit(ctx, text, maxW, maxH, big, small, weight, lh, font) {
    for (let s = big; s >= small; s -= 4) {
      ctx.font = `${weight} ${s}px ${font || F}`;
      const L = lines(ctx, text, maxW);
      const tooWide = L.some(l => ctx.measureText(l).width > maxW);
      if (L.length * s * lh <= maxH && !tooWide) return { s, L, h: L.length * s * lh };
    }
    ctx.font = `${weight} ${small}px ${font || F}`;
    let L = lines(ctx, text, maxW); const max = Math.max(1, Math.floor(maxH / (small * lh)));
    if (L.length > max) { L = L.slice(0, max); L[max - 1] = L[max - 1].replace(/\s*\S*$/, '') + '…'; }
    return { s: small, L, h: L.length * small * lh };
  }
  function text(ctx, t, x, y, o) {
    ctx.fillStyle = o.color; ctx.font = `${o.weight} ${t.s}px ${o.font || F}`; ctx.textBaseline = 'top'; ctx.textAlign = o.align || 'left';
    t.L.forEach((l, i) => ctx.fillText(l, x, y + i * t.s * o.lh + (o.lh - 1) * t.s / 2));
    return y + t.h;
  }
  function pill(ctx, label, x, y, size, bg, fg, alignRight) {
    ctx.font = `700 ${size}px ${F}`;
    const w = ctx.measureText(label).width + size * 1.6, h = size * 2.1;
    const px = alignRight ? x - w : x;
    ctx.fillStyle = bg; rr(ctx, px, y, w, h, h / 2); ctx.fill();
    ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(label, px + size * 0.8, y + h / 2 + 1);
    return { w, h };
  }
  async function head(ctx, W, th, pad, color) {
    const lg = await logo(color || th.logo);
    if (lg) { const h = 112, w = lg.width * h / lg.height; ctx.drawImage(lg, pad - 6, pad - 8, w, h); }
  }
  function foot(ctx, W, H, pad, cta, th, onDark) {
    let y = H - pad - 74;
    if (cta) pill(ctx, cta, pad, y, 34, th.acc, th.accFg);
    ctx.font = `600 30px ${F}`; ctx.fillStyle = onDark ? 'rgba(255,255,255,.8)' : th.sub; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(HANDLE, W - pad, y + 36);
  }
  function deco(ctx, W, H, th) {
    ctx.fillStyle = th.deco;
    ctx.beginPath(); ctx.arc(W * 0.92, H * 0.18, W * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W * 0.05, H * 0.95, W * 0.28, 0, Math.PI * 2); ctx.fill();
  }

  /* ---------- шаблоны ---------- */
  const T = {
    async bold(ctx, W, H, s, th, img) {
      const pad = 80, story = H > 1500;
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H); deco(ctx, W, H, th);
      await head(ctx, W, th, pad);
      if (s.badge) pill(ctx, s.badge.toUpperCase(), W - pad, pad + 6, 28, th.acc, th.accFg, true);
      const top = pad + 150 + (story ? 120 : 0);
      const photoH = img ? Math.round(H * (story ? 0.36 : 0.32)) : 0;
      const photoY = H - pad - 120 - photoH;
      const bottom = (img ? photoY - 36 : H - pad - 140) - (s.price ? 100 : 0);
      const hl = fit(ctx, s.headline, W - pad * 2, (bottom - top) * (s.sub ? 0.64 : 1), story ? 132 : 120, 52, 800, 1.04);
      let y = text(ctx, hl, pad, top, { color: th.fg, weight: 800, lh: 1.04 });
      if (s.sub) { const sb = fit(ctx, s.sub, W - pad * 2, Math.max(60, bottom - y - 26), 44, 26, 500, 1.3, '"Inter",system-ui,sans-serif'); y = text(ctx, sb, pad, y + 26, { color: th.sub, weight: 500, lh: 1.3, font: '"Inter",system-ui,sans-serif' }); }
      if (s.price) pill(ctx, s.price, pad, Math.min(y + 30, bottom + 16), 40, th.acc, th.accFg);
      if (img) cover(ctx, img, pad, photoY, W - pad * 2, photoH, 36);
      foot(ctx, W, H, pad, s.cta, { ...th, acc: th.bg === '#4358ef' ? '#0a0b14' : th.acc, accFg: '#fff' });
    },
    async photo(ctx, W, H, s, th, img) {
      const pad = 80;
      if (img) cover(ctx, img, 0, 0, W, H); else { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, th.bg); g.addColorStop(1, th.bg2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); deco(ctx, W, H, th); }
      const g = ctx.createLinearGradient(0, H * 0.3, 0, H); g.addColorStop(0, 'rgba(10,11,20,0)'); g.addColorStop(0.55, 'rgba(10,11,20,.72)'); g.addColorStop(1, 'rgba(10,11,20,.92)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const tg = ctx.createLinearGradient(0, 0, 0, 260); tg.addColorStop(0, 'rgba(10,11,20,.45)'); tg.addColorStop(1, 'rgba(10,11,20,0)'); ctx.fillStyle = tg; ctx.fillRect(0, 0, W, 260);
      await head(ctx, W, th, pad, '#ffffff');
      if (s.badge) pill(ctx, s.badge.toUpperCase(), W - pad, pad + 6, 28, '#4358ef', '#fff', true);
      const bottom = H - pad - 130;
      const sub = s.sub ? (() => { ctx.font = `500 40px Inter`; return fit(ctx, s.sub, W - pad * 2, 200, 40, 28, 500, 1.3, '"Inter",system-ui,sans-serif'); })() : null;
      const priceH = s.price ? 110 : 0;
      const hl = fit(ctx, s.headline, W - pad * 2, H * 0.32, 116, 56, 800, 1.04);
      let y = bottom - (sub ? sub.h + 26 : 0) - priceH - hl.h;
      y = text(ctx, hl, pad, y, { color: '#fff', weight: 800, lh: 1.04 });
      if (sub) y = text(ctx, sub, pad, y + 26, { color: 'rgba(255,255,255,.86)', weight: 500, lh: 1.3, font: '"Inter",system-ui,sans-serif' });
      if (s.price) pill(ctx, s.price, pad, y + 30, 40, '#ffffff', '#0a0b14');
      foot(ctx, W, H, pad, s.cta, { ...th, acc: '#4358ef', accFg: '#fff' }, true);
    },
    async price(ctx, W, H, s, th, img) {
      const pad = 80, split = Math.round(H * 0.5);
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);
      if (img) cover(ctx, img, 0, 0, W, split); else { ctx.fillStyle = th.bg2; ctx.fillRect(0, 0, W, split); deco(ctx, W, split * 2, th); }
      if (img) { const tg = ctx.createLinearGradient(0, 0, 0, 240); tg.addColorStop(0, 'rgba(10,11,20,.45)'); tg.addColorStop(1, 'rgba(10,11,20,0)'); ctx.fillStyle = tg; ctx.fillRect(0, 0, W, 240); }
      await head(ctx, W, th, pad, img ? '#ffffff' : th.logo);
      if (s.badge) pill(ctx, s.badge.toUpperCase(), W - pad, pad + 6, 28, th.acc, th.accFg, true);
      // ценник
      if (s.price) {
        const R = 170, cx = W - pad - R + 20, cy = split;
        ctx.fillStyle = '#4358ef'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = th.bg; ctx.lineWidth = 14; ctx.stroke();
        const pt = fit(ctx, s.price, R * 1.55, R * 1.2, 64, 28, 800, 1.05);
        text(ctx, pt, cx, cy - pt.h / 2, { color: '#fff', weight: 800, lh: 1.05, align: 'center' });
      }
      const top = split + (s.price ? 190 : 70), bottom = H - pad - 130;
      const hl = fit(ctx, s.headline, W - pad * 2, (bottom - top) * (s.sub ? 0.62 : 1), 100, 48, 800, 1.05);
      let y = text(ctx, hl, pad, top, { color: th.fg, weight: 800, lh: 1.05 });
      if (s.sub) { const sb = fit(ctx, s.sub, W - pad * 2, bottom - y - 24, 40, 26, 500, 1.3, '"Inter",system-ui,sans-serif'); text(ctx, sb, pad, y + 24, { color: th.sub, weight: 500, lh: 1.3, font: '"Inter",system-ui,sans-serif' }); }
      foot(ctx, W, H, pad, s.cta, th);
    },
    async list(ctx, W, H, s, th, img) {
      const pad = 80, story = H > 1500;
      ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H); deco(ctx, W, H, th);
      await head(ctx, W, th, pad);
      if (img) { const r = story ? 210 : 170; ctx.save(); ctx.beginPath(); ctx.arc(W - pad - r, pad + 180 + r, r, 0, Math.PI * 2); ctx.clip(); cover(ctx, img, W - pad - 2 * r, pad + 180, 2 * r, 2 * r); ctx.restore(); }
      else if (s.badge) pill(ctx, s.badge.toUpperCase(), W - pad, pad + 6, 28, th.acc, th.accFg, true);
      const top = pad + 170 + (story ? 80 : 0), textW = img ? W - pad * 2 - (story ? 420 : 340) - 30 : W - pad * 2;
      const hl = fit(ctx, s.headline, textW, story ? 520 : 400, 104, 52, 800, 1.04);
      let y = text(ctx, hl, pad, top, { color: th.fg, weight: 800, lh: 1.04 });
      if (img) y = Math.max(y, pad + 180 + (story ? 420 : 340));
      const items = (s.bullets && s.bullets.length ? s.bullets : (s.sub ? [s.sub] : [])).slice(0, 5);
      const bottom = H - pad - 140 - (s.price ? 110 : 0), per = Math.min(story ? 190 : 150, (bottom - y - 40) / Math.max(1, items.length));
      y += 50;
      items.forEach(b => {
        const r = 26;
        ctx.fillStyle = th.acc; ctx.beginPath(); ctx.arc(pad + r, y + r + 4, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = th.accFg; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(pad + r - 11, y + r + 5); ctx.lineTo(pad + r - 3, y + r + 13); ctx.lineTo(pad + r + 12, y + r - 5); ctx.stroke();
        const bt = fit(ctx, b, W - pad * 2 - 80, per - 20, 44, 28, 600, 1.22);
        text(ctx, bt, pad + 80, y, { color: th.fg, weight: 600, lh: 1.22 });
        y += Math.max(per, bt.h + 24);
      });
      if (s.price) pill(ctx, s.price, pad, Math.min(y + 10, bottom + 10), 40, th.acc, th.accFg);
      foot(ctx, W, H, pad, s.cta, th);
    }
  };

  async function render(spec, o) {
    await ensureFonts();
    const f = FORMATS[o.format] || FORMATS.post, th = THEMES[spec.theme] || THEMES.blue;
    const c = o.canvas || document.createElement('canvas'); c.width = f.w; c.height = f.h;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, f.w, f.h);
    await (T[spec.template] || T.bold)(ctx, f.w, f.h, spec, th, o.img || null);
    return c;
  }
  const toBlob = c => new Promise(ok => c.toBlob(ok, 'image/png'));

  window.RAZCreative = { FORMATS, TEMPLATES, THEMES, render, toBlob, loadImg };
})();
