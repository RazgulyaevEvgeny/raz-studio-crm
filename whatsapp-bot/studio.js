// Оборудование в студии (кроме 3D-принтеров): Wi‑Fi камера и датчики Smart Life / Tuya.
// Бот на рабочем компьютере раз в минуту проверяет их и кладёт короткую сводку в Realtime Database,
// а учёт показывает её в виджете «Оборудование в студии».
//
// Камера (Imou / Dahua, например DH-C3A): проверяем, отвечает ли она в сети студии (порт видео RTSP 554).
// Адрес бот находит сам (перебирает адреса своей сети) или берёт CAMERA_IP из .env. Пароль камеры не нужен.
//   → sig/studio/camera: { name, ip, online, since, lastOnline, at }
//
// Датчики Tuya (датчик дыма и т.п.): через облако Tuya так же, как это делает Home Assistant
// (вход по QR-коду из приложения Smart Life / Tuya Smart, без аккаунта разработчика и без денег).
//   1) в учёте вводят «код пользователя» из приложения → sig/studio/tuya/req = { userCode, at }
//   2) бот просит у Tuya QR-код и кладёт его в sig/studio/tuya/qr — учёт его показывает
//   3) QR сканируют приложением Smart Life, бот получает доступ и хранит его в tuya.json рядом с ботом (в git не попадает)
//   4) раз в 30 секунд бот спрашивает облако о устройствах → sig/studio/tuya/devices
//
// Тревога при дыме: громкое критическое уведомление Bark на iPhone (через воркер bambu-watch, как у принтеров,
// ключ воркера лежит рядом с ботом в alarm.json, в git не попадает) + сообщение в Telegram команде.
// Пока дым не пропал — повтор каждые 3 минуты. Ещё в Telegram: датчик пропал со связи, села батарея.
// Проверка из учёта: кнопка «Проверить тревогу» → sig/studio/tuya/test = { at }, ответ бота → sig/studio/tuya/testDone = { req, ok, at }.

import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EVERY = 60e3, TUYA_EVERY = 30e3;
const ALARM_URL = 'https://bambu-watch.design-onegin.workers.dev/api/alarm';
const SMOKE_REPEAT = 3 * 60e3, OFFLINE_WARN = 30 * 60e3;
const isSmoke = s => { const v = ['smoke_sensor_status', 'smoke_sensor_state'].map(k => s?.[k]).find(x => x != null); return v === 'alarm' || v === '1' || v === true; };
const lowBattery = s => (s?.battery_percentage != null && +s.battery_percentage <= 20) || s?.battery_state === 'low';
const T_CLIENT = 'HA_3y9q4ak7g4ephrvke', T_SCHEMA = 'haauthorize', T_LOGIN = 'https://apigw.iotbing.com';

const tcpOpen = (ip, port, ms = 1500) => new Promise(ok => {
  const s = net.connect({ host: ip, port });
  const done = v => { try { s.destroy(); } catch (_) {} ok(v); };
  s.setTimeout(ms, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false));
});
function myNets() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(a.address)) out.add(a.address.split('.').slice(0, 3).join('.'));
  }
  return [...out];
}

// ---------- Tuya: шифрование запросов, как в tuya-device-sharing-sdk ----------
const NONCE_CH = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
const rndNonce = n => Array.from({ length: n }, () => NONCE_CH[crypto.randomInt(NONCE_CH.length)]).join('');
function gcmEnc(text, key) {
  const iv = Buffer.from(rndNonce(12), 'utf8');
  const c = crypto.createCipheriv('aes-128-gcm', Buffer.from(key, 'utf8'), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final(), c.getAuthTag()]);
  return iv.toString('base64') + enc.toString('base64');
}
function gcmDec(b64, key) {
  const b = Buffer.from(b64, 'base64'), iv = b.subarray(0, 12), body = b.subarray(12, b.length - 16), tag = b.subarray(b.length - 16);
  const d = crypto.createDecipheriv('aes-128-gcm', Buffer.from(key, 'utf8'), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}

export function startStudio({ fs, env, log, DIR, alert }) {
  const rt = fs?.rt;
  if (!rt) return;
  const file = join(DIR, 'tuya.json');
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch (_) {}
  const save = () => { try { writeFileSync(file, JSON.stringify(cfg, null, 1)); } catch (_) {} };
  const said = {};
  const say = (k, m) => { if (said[k] !== m) { said[k] = m; log(m); } };
  const put = async (path, v) => { try { await rt.set(path, { ...v, at: Date.now() }); } catch (e) { say('w' + path, 'Оборудование: не записал ' + path + ': ' + (e?.message || e)); } };

  // ---------- камера ----------
  const cam = { online: null, since: 0, lastOnline: cfg.camLast || 0, sent: '', sentAt: 0, scanAt: 0 };
  async function findCamera() {
    if (Date.now() - cam.scanAt < 10 * 60e3) return '';
    cam.scanAt = Date.now();
    const known = new Set(String(env.STUDIO_SKIP_IPS || '').split(',').map(s => s.trim()).filter(Boolean));
    let ips = [];
    try { ips = [...execFileSync('arp', ['-a'], { encoding: 'utf8', timeout: 5000 }).matchAll(/(\d+\.\d+\.\d+\.\d+)/g)].map(m => m[1]); } catch (_) {}
    for (const n of myNets()) for (let i = 2; i < 255; i++) ips.push(n + '.' + i);
    ips = [...new Set(ips)].filter(ip => !known.has(ip) && !/\.(0|1|255)$/.test(ip) && myNets().some(n => ip.startsWith(n + '.')));
    for (let i = 0; i < ips.length; i += 40) {
      const part = ips.slice(i, i + 40);
      const hits = await Promise.all(part.map(ip => tcpOpen(ip, 554, 800)));
      const k = hits.findIndex(Boolean);
      if (k >= 0) return part[k];
    }
    return '';
  }
  async function checkCamera() {
    let ip = (env.CAMERA_IP || '').trim() || cfg.camIp || '';
    let ok = ip ? await tcpOpen(ip, 554) : false;
    if (!ok && !env.CAMERA_IP) { // адрес мог смениться — поищем заново (не чаще раза в 10 минут)
      const f = await findCamera();
      if (f) { ip = f; ok = true; if (cfg.camIp !== f) { cfg.camIp = f; save(); say('cam', 'Камера: нашёл в сети по адресу ' + f); } }
    }
    const now = Date.now();
    if (ok) { if (cam.online !== true) cam.since = now; cam.lastOnline = now; if (now - (cfg.camLast || 0) > 10 * 60e3) { cfg.camLast = now; save(); } }
    cam.online = ok ? true : ip ? false : null;
    const v = { name: env.CAMERA_NAME || 'Камера в мастерской', model: env.CAMERA_MODEL || 'Imou DH-C3A', ip: ip || '', online: cam.online,
      since: ok ? cam.since : null, lastOnline: cam.lastOnline || null, problem: ok ? '' : ip ? 'камера не отвечает в сети студии' : 'камеру не нашёл в сети студии' };
    const key = JSON.stringify({ ...v, lastOnline: ok ? 0 : v.lastOnline });
    if (key !== cam.sent || now - cam.sentAt > 5 * 60e3) { cam.sent = key; cam.sentAt = now; await put('sig/studio/camera', v); }
  }

  // ---------- Tuya ----------
  let tuyaBusy = false, lastReq = 0, lastDev = '', lastDevAt = 0;
  async function tuyaCall(method, path, query) {
    const t = cfg.tuya;
    if (t.expireAt - 60e3 < Date.now() && path.indexOf('/v1.0/m/token/') !== 0) await tuyaRefresh();
    const rid = crypto.randomUUID();
    const hashKey = crypto.createHash('md5').update(rid + cfg.tuya.refresh).digest('hex');
    const secret = crypto.createHmac('sha256', rid).update(hashKey).digest('hex').slice(0, 16);
    let qEnc = '';
    let url = cfg.tuya.endpoint + path;
    if (query && Object.keys(query).length) { qEnc = gcmEnc(JSON.stringify(query), secret); url += '?encdata=' + encodeURIComponent(qEnc); }
    const h = { 'X-appKey': T_CLIENT, 'X-requestId': rid, 'X-sid': '', 'X-time': String(Date.now()) };
    if (cfg.tuya.access) h['X-token'] = cfg.tuya.access;
    const signStr = ['X-appKey', 'X-requestId', 'X-sid', 'X-time', 'X-token'].filter(k => h[k]).map(k => k + '=' + h[k]).join('||') + qEnc;
    h['X-sign'] = crypto.createHmac('sha256', hashKey).update(signStr).digest('hex');
    const r = await fetch(url, { method, headers: h, signal: AbortSignal.timeout(15e3) });
    const j = await r.json();
    if (!j.success) throw Object.assign(new Error('Tuya: ' + (j.msg || j.code)), { code: j.code });
    if (typeof j.result === 'string') { const s = gcmDec(j.result, secret); try { j.result = JSON.parse(s); } catch (_) { j.result = s; } }
    return j;
  }
  async function tuyaRefresh() {
    const j = await tuyaCall('GET', '/v1.0/m/token/' + cfg.tuya.refresh);
    const r = j.result || {};
    cfg.tuya = { ...cfg.tuya, access: r.accessToken, refresh: r.refreshToken, uid: r.uid || cfg.tuya.uid, expireAt: (+j.t || Date.now()) + (+r.expireTime || 7200) * 1000 };
    save();
  }
  // привязка: код пользователя из учёта → QR → ждём сканирования
  async function tuyaLink(userCode) {
    const q = await fetch(`${T_LOGIN}/v1.0/m/life/home-assistant/qrcode/tokens?clientid=${T_CLIENT}&usercode=${encodeURIComponent(userCode)}&schema=${T_SCHEMA}`, { method: 'POST', signal: AbortSignal.timeout(15e3) }).then(r => r.json());
    if (!q.success || !q.result?.qrcode) { await put('sig/studio/tuya/link', { state: 'error', text: 'Smart Life не принял код пользователя (' + (q.msg || q.code || 'нет ответа') + '). Проверьте код и попробуйте снова.' }); return; }
    const token = q.result.qrcode;
    await put('sig/studio/tuya/link', { state: 'qr', qr: 'tuyaSmart--qrLogin?token=' + token });
    say('tuya', 'Smart Life: жду, когда отсканируют QR-код в учёте');
    const until = Date.now() + 5 * 60e3;
    while (Date.now() < until) {
      await new Promise(f => setTimeout(f, 3000));
      let r; try { r = await fetch(`${T_LOGIN}/v1.0/m/life/home-assistant/qrcode/tokens/${token}?clientid=${T_CLIENT}&usercode=${encodeURIComponent(userCode)}`, { signal: AbortSignal.timeout(15e3) }).then(x => x.json()); } catch (_) { continue; }
      if (r?.success && r.result?.access_token) {
        const x = r.result;
        cfg.tuya = { endpoint: x.endpoint, uid: x.uid, terminal: x.terminal_id, userCode, access: x.access_token, refresh: x.refresh_token, expireAt: (+r.t || Date.now()) + (+x.expire_time || 7200) * 1000 };
        save();
        await put('sig/studio/tuya/link', { state: 'ok' });
        say('tuya', 'Smart Life: подключено');
        return;
      }
    }
    await put('sig/studio/tuya/link', { state: 'error', text: 'QR-код не отсканировали за 5 минут. Нажмите «Подключить» ещё раз.' });
  }
  async function tuyaPoll() {
    if (!cfg.tuya?.access) return;
    const homes = (await tuyaCall('GET', '/v1.0/m/life/users/homes')).result || [];
    const out = [];
    for (const h of homes) {
      const list = (await tuyaCall('GET', '/v1.0/m/life/ha/home/devices', { homeId: String(h.ownerId) })).result || [];
      for (const d of list) {
        const st = {};
        for (const s of d.status || []) if (s && 'code' in s) st[s.code] = s.value;
        out.push({ id: d.id, name: d.name || '', category: d.category || '', product: d.product_name || d.productName || '', online: !!d.online, status: st });
      }
    }
    const key = JSON.stringify(out);
    if (key !== lastDev || Date.now() - lastDevAt > 5 * 60e3) { lastDev = key; lastDevAt = Date.now(); await put('sig/studio/tuya/devices', { list: out }); }
    say('tuya', 'Smart Life: на связи, устройств ' + out.length);
    await watchSensors(out);
  }

  // ---------- тревога ----------
  let alarmKey = String(env.ALARM_TOKEN || '').trim();
  if (!alarmKey) try { alarmKey = String(JSON.parse(readFileSync(join(DIR, 'alarm.json'), 'utf8')).token || '').trim(); } catch (_) {}
  async function bark(title, body, critical = true) {
    if (!alarmKey) { say('barkK', 'Тревога: нет alarm.json рядом с ботом, звонок на телефон не отправлен'); return false; }
    try {
      const r = await fetch(ALARM_URL, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ token: alarmKey, title, body, critical }), signal: AbortSignal.timeout(15e3) });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) log('Тревога: телефон не принял (' + r.status + ')');
      return !!j.ok;
    } catch (e) { log('Тревога: не дозвонился до воркера: ' + (e?.message || e)); return false; }
  }
  const tgSay = t => { try { return alert?.(t); } catch (_) {} };
  async function watchSensors(list) {
    const now = Date.now();
    cfg.sens = cfg.sens || {};
    let changed = false;
    for (const d of list) {
      const st = d.status || {}, name = d.name || 'Датчик', w = cfg.sens[d.id] || (cfg.sens[d.id] = {});
      if (d.category === 'ywbj' || 'smoke_sensor_status' in st || 'smoke_sensor_state' in st) {
        const smoke = d.online && isSmoke(st);
        if (smoke && !w.smoke) {
          w.smoke = now; w.bark = now; changed = true;
          log('ДЫМ! Сработал датчик ' + name);
          await bark('🔥 ДЫМ в мастерской!', 'Сработал датчик «' + name + '». Срочно проверьте студию!');
          await tgSay('🔥 ДЫМ! Сработал датчик «' + name + '» в студии. Срочно проверьте мастерскую!');
        } else if (smoke && now - (w.bark || 0) >= SMOKE_REPEAT && !st.muffling) {
          w.bark = now; changed = true;
          await bark('🔥 Дым всё ещё есть', 'Датчик «' + name + '» продолжает тревогу уже ' + Math.round((now - w.smoke) / 60e3) + ' мин.');
        } else if (!smoke && w.smoke && d.online) {
          log('Дым пропал: ' + name);
          await bark('✅ Дыма больше нет', 'Датчик «' + name + '» успокоился.', false);
          await tgSay('✅ Датчик «' + name + '» успокоился: дыма больше нет.');
          w.smoke = 0; changed = true;
        }
      }
      if (lowBattery(st) && now - (w.bat || 0) > 24 * 36e5) { w.bat = now; changed = true; await tgSay('🔋 У датчика «' + name + '» садится батарея' + (st.battery_percentage != null ? ' (' + st.battery_percentage + '%)' : '') + '. Замените, иначе он не предупредит о дыме.'); }
      if (!d.online) {
        if (!w.off) { w.off = now; changed = true; }
        else if (!w.offSaid && now - w.off > OFFLINE_WARN) { w.offSaid = now; changed = true; await tgSay('⚠️ Датчик «' + name + '» не на связи уже ' + Math.round((now - w.off) / 60e3) + ' мин. Проверьте Wi‑Fi и батарею: пока он офлайн, о дыме он не предупредит.'); }
      } else if (w.off) {
        if (w.offSaid) await tgSay('✅ Датчик «' + name + '» снова на связи.');
        w.off = 0; w.offSaid = 0; changed = true;
      }
    }
    if (changed) save();
  }
  let lastTest = 0;
  async function testAlarm() {
    const t = rt.get('sig/studio/tuya/test');
    if (!t?.at || +t.at <= lastTest || Date.now() - +t.at > 5 * 60e3) return;
    lastTest = +t.at;
    const ok = await bark('🔔 Проверка тревоги дыма', 'Так придёт тревога, если сработает датчик дыма в студии.');
    await tgSay('🔔 Проверка: так придёт сообщение, если сработает датчик дыма в студии.');
    await put('sig/studio/tuya/testDone', { req: +t.at, ok });
    log('Тревога: проверка из учёта, телефон ' + (ok ? 'принял' : 'НЕ принял'));
  }
  async function tuyaTick() {
    if (tuyaBusy) return;
    tuyaBusy = true;
    try {
      const req = rt.get('sig/studio/tuya/req');
      if (req?.userCode && +req.at > lastReq && Date.now() - +req.at < 10 * 60e3) { lastReq = +req.at; await tuyaLink(String(req.userCode).trim()); }
      await tuyaPoll();
    } catch (e) {
      say('tuya', 'Smart Life: ' + (e?.message || e));
      if (/token|1010|1011|sign/i.test(String(e?.message)) && cfg.tuya) { // доступ отозван — просим привязать заново
        cfg.tuya = null; save(); await put('sig/studio/tuya/link', { state: 'error', text: 'Доступ к Smart Life пропал. Подключите заново.' });
      }
    } finally { tuyaBusy = false; }
  }

  rt.on(p => {
    if (String(p).startsWith('/studio/tuya/req') || p === '/') setTimeout(tuyaTick, 100);
    if (String(p).startsWith('/studio/tuya/test') || p === '/') setTimeout(() => testAlarm().catch(e => log('Тревога: ' + (e?.message || e))), 100);
  });
  const tick = async () => { try { await checkCamera(); } catch (e) { say('camE', 'Камера: ' + (e?.message || e)); } };
  setTimeout(tick, 5000); setTimeout(tuyaTick, 6000);
  const timer = setInterval(tick, EVERY), timer2 = setInterval(tuyaTick, TUYA_EVERY);
  log('Оборудование: слежу за камерой и датчиками Smart Life');
  return { stop: () => { clearInterval(timer); clearInterval(timer2); } };
}
