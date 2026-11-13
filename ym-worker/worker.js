/**
 * ym-wave — посредник между экраном в студии и Яндекс Музыкой.
 * Крутит «Мою волну» вашего аккаунта и отдаёт экрану: название, исполнителя, обложку и ссылку на звук.
 *
 * Секреты (wrangler secret put ...):
 *   YM_TOKEN  — OAuth-токен Яндекс Музыки (как пароль: никому не показывать)
 *   TV_KEY    — любой придуманный ключ; тот же ключ прописывается в tv.html
 *
 * Адреса:
 *   GET  /wave?k=KEY&last=TRACK_ID   → { batchId, tracks:[{id, albumId, title, artist, cover, durationMs}] }
 *   GET  /url?k=KEY&id=TRACK_ID      → { url }   (прямая ссылка на mp3, живёт несколько минут)
 *   POST /feedback?k=KEY             ← { type, trackId, albumId, batchId, played }  (учит волну)
 *
 * API у Яндекс Музыки неофициальное. Если Яндекс что-то поменяет — правится здесь, экран трогать не нужно.
 */

const API = 'https://api.music.yandex.net';
const STATION = 'user:onyourwave';               // «Моя волна»
const MOOD = { moodEnergy: 'calm', diversity: 'default', language: 'any' }; // спокойная музыка
const SALT = 'XGRlBW9FXlekgbPrRHuSiA';
const ALLOWED = ['https://razgulyaevevgeny.github.io'];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.searchParams.get('k') !== env.TV_KEY) return json({ error: 'forbidden' }, 403, cors);

    const ym = (path, init = {}) => fetch(API + path, {
      ...init,
      headers: {
        Authorization: 'OAuth ' + env.YM_TOKEN,
        'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621',
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });

    try {
      if (url.pathname === '/wave') {
        // настроение «спокойное» — ставим перед каждой пачкой, это дёшево
        await ym(`/rotor/station/${STATION}/settings2`, { method: 'POST', body: JSON.stringify({ ...MOOD, type: 'rotor' }) }).catch(() => {});
        const last = url.searchParams.get('last');
        const r = await ym(`/rotor/station/${STATION}/tracks?settings2=true${last ? '&queue=' + encodeURIComponent(last) : ''}`);
        const j = await r.json();
        const res = j.result || {};
        const tracks = (res.sequence || []).map(s => s.track).filter(Boolean).map(t => ({
          id: String(t.id),
          albumId: t.albums && t.albums[0] ? String(t.albums[0].id) : '',
          title: t.title + (t.version ? ` (${t.version})` : ''),
          artist: (t.artists || []).map(a => a.name).join(', '),
          cover: t.coverUri ? 'https://' + t.coverUri.replace('%%', '200x200') : '',
          durationMs: t.durationMs || 0,
        }));
        return json({ batchId: res.batchId || '', tracks }, 200, cors);
      }

      if (url.pathname === '/url') {
        const id = url.searchParams.get('id');
        const r = await ym(`/tracks/${id}/download-info`);
        const list = (await r.json()).result || [];
        const mp3 = list.filter(x => x.codec === 'mp3').sort((a, b) => b.bitrateInKbps - a.bitrateInKbps)[0] || list[0];
        if (!mp3) return json({ error: 'no-stream' }, 404, cors);
        const xml = await (await fetch(mp3.downloadInfoUrl)).text();
        const tag = n => (xml.match(new RegExp(`<${n}>([^<]*)</${n}>`)) || [])[1] || '';
        const host = tag('host'), path = tag('path'), ts = tag('ts'), s = tag('s');
        const sign = await md5(SALT + path.slice(1) + s);
        return json({ url: `https://${host}/get-mp3/${sign}/${ts}${path}` }, 200, cors);
      }

      if (url.pathname === '/feedback' && req.method === 'POST') {
        const b = await req.json();
        const body = { type: b.type, timestamp: new Date().toISOString(), from: 'radio-mobile-user-onyourwave-default' };
        if (b.trackId) body.trackId = b.albumId ? `${b.trackId}:${b.albumId}` : b.trackId;
        if (b.played != null) body.totalPlayedSeconds = b.played;
        await ym(`/rotor/station/${STATION}/feedback${b.batchId ? '?batch-id=' + encodeURIComponent(b.batchId) : ''}`,
          { method: 'POST', body: JSON.stringify(body) });
        return json({ ok: true }, 200, cors);
      }

      return json({ error: 'not-found' }, 404, cors);
    } catch (e) {
      return json({ error: String(e) }, 502, cors);
    }
  },
};

function json(o, status, headers) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
async function md5(str) {
  const buf = await crypto.subtle.digest('MD5', new TextEncoder().encode(str)); // MD5 поддерживается в Cloudflare Workers
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
