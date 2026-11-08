// 3D-принтер Anycubic Kobra X («Cobra X») в мастерской: состояние печати по локальной сети, без облака и без денег.
// Bambu Lab отдают состояние через облако (воркер bambu-watch), а Anycubic наружу ничего не отдаёт: принтер говорит
// только внутри сети студии. Поэтому его слушает бот на рабочем компьютере и кладёт короткую сводку в Realtime Database
// (sig/printers/anycubic), а учёт показывает её в виджете «3D принтеры» рядом с Bambu.
//
// Как это устроено (так же делает фирменная программа Anycubic Slicer Next в режиме LAN):
//   1) http://<принтер>:18910/info — принтер отдаёт свой токен;
//   2) по токену просим /ctrl — принтер отдаёт зашифрованный логин и пароль своего MQTT (AES-CBC), расшифровываем;
//   3) подключаемся к MQTT принтера (TLS, порт 9883), раз в 30 секунд спрашиваем «status» и «info», слушаем ответы.
// Адрес принтера бот находит сам (перебирает адреса своей сети), или берёт ANYCUBIC_IP из .env, если он там указан.
// Найденный адрес и логин принтера запоминаются в anycubic.json рядом с ботом (в репозиторий не попадает).
// На самом принтере должен быть включён режим LAN: Настройки → Сеть → «LAN mode» / «Режим локальной сети».
//
// Второй путь, без LAN (в режиме LAN у Anycubic не работает камера в приложении): через облако Anycubic, как это делает
// Anycubic Slicer Next. Slicer Next, установленный на этом же компьютере, пишет свой ключ входа в журнал
// %AppData%\AnycubicSlicerNext\log\debug_*.log — бот берёт его оттуда сам (ключ никуда, кроме облака Anycubic,
// не уходит и в репозиторий не попадает) и раз в минуту спрашивает облако о принтере и текущей печати.
// Если ключ устарел — достаточно открыть Slicer Next и войти в аккаунт заново.

import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const NAME = 'Anycubic Kobra X';
const SIG = 'sig/printers/anycubic';
const ASK_EVERY = 30e3;        // как часто спрашиваем принтер
const BEAT_EVERY = 5 * 60e3;   // даже без изменений обновляем отметку «бот на связи» раз в 5 минут
const SEEN_TTL = 2 * 60e3;     // принтер молчит дольше 2 минут — считаем, что он выключен
const SCAN_EVERY = 10 * 60e3;  // принтер не нашли — ищем снова через 10 минут

// состояния печати Anycubic → те же, что у Bambu в учёте (RUNNING, PREPARE, PAUSE, FINISH, FAILED, IDLE)
const STATE = {
  printing: 'RUNNING', updated: 'RUNNING', resuming: 'RUNNING', resumed: 'RUNNING', busy: 'RUNNING',
  checking: 'PREPARE', auto_leveling: 'PREPARE', preheating: 'PREPARE', downloading: 'PREPARE', slicing: 'PREPARE',
  vibrating: 'PREPARE', flow_calibrating: 'PREPARE', drying: 'PREPARE', printstart: 'PREPARE',
  pausing: 'PAUSE', paused: 'PAUSE',
  finished: 'FINISH', finish: 'FINISH', completed: 'FINISH', done: 'FINISH',
  failed: 'FAILED', error: 'FAILED',
  stopped: 'IDLE', stoped: 'IDLE', stopping: 'IDLE', cancelled: 'IDLE', canceled: 'IDLE', free: 'IDLE', idle: 'IDLE',
};
const PRINT_STATUS = { 1: 'printing', 2: 'finished', 3: 'failed', 4: 'downloading', 5: 'checking', 6: 'preheating', 7: 'slicing', 9: 'auto_leveling', 10: 'vibrating', 11: 'flow_calibrating', 12: 'drying' };
// частые ошибки Anycubic по-русски; остальные — «код N»
const ERR = {
  10105: 'Не удалось загрузить файл на принтер', 10107: 'Проблема с пластиком', 10108: 'Сопло царапает стол: проверьте зазор',
  10116: 'Файл печати повреждён', 10118: 'Ошибка калибровки оси X', 10119: 'Ошибка калибровки оси Y', 10120: 'Ошибка калибровки оси Z',
  10121: 'Проблема с нагревом стола', 10122: 'Проблема с нагревом сопла', 10403: 'Оборвался пластик: вставьте новый',
  10409: 'Сбой принтера: перезагрузите его', 10410: 'Перегрев нагревателя', 11511: 'Пластик не выдавливается', 11512: 'Не получилось втянуть пластик',
  11518: 'Засорилось сопло или пластик застрял', 11519: 'Пластик запутался на катушке', 11520: 'Проблема с пластиком в ACE',
  11801: 'Печать сорвалась («спагетти»)', 11842: 'Пластик застрял или запутался', 11854: 'Не получилось втянуть пластик',
};
const errText = c => ERR[c] || 'Ошибка принтера, код ' + c + ': подробности в приложении Anycubic';

const md5 = s => crypto.createHash('md5').update(s).digest('hex');

// ---------- облако Anycubic (режим Slicer Next) ----------
const CLOUD = 'https://cloud-universe.anycubic.com/p/p/workbench/api';
const C_APP = 'f9b3528877c94d5c9c5af32245db46ef', C_SEC = '0cf75926606049a3937f56b0373b99fb', C_VER = 'V3.0.0';
const CLOUD_EVERY = 60e3;       // как часто спрашиваем облако
const JWT = /(?:accessToken\s*=\s*|id_token=)(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;
const jwtExp = t => { try { return +JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')).exp * 1000 || 0; } catch (_) { return 0; } };
// ключ входа из журнала Slicer Next: самый свежий журнал, последний ключ в нём
function slicerToken(env) {
  const dir = join(env.ANYCUBIC_SLICER_LOG || join(process.env.APPDATA || '', 'AnycubicSlicerNext', 'log'));
  let files = [];
  try { files = readdirSync(dir).filter(f => /^debug_.*\.log$/i.test(f)).map(f => ({ f: join(dir, f), t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t); } catch (_) { return { why: 'не нашёл Anycubic Slicer Next на этом компьютере' }; }
  for (const { f } of files.slice(0, 5)) {
    let txt = '';
    try { const b = readFileSync(f); txt = b.subarray(Math.max(0, b.length - 64 * 1024 * 1024)).toString('latin1'); } catch (_) { continue; }
    const all = [...txt.matchAll(JWT)].map(m => m[1]);
    if (all.length) { const tok = all[all.length - 1]; return { tok, exp: jwtExp(tok) }; }
  }
  return { why: files.length ? 'Slicer Next не сохранил вход: откройте его и войдите в аккаунт Anycubic' : 'Slicer Next ещё ни разу не запускали' };
}
function cloudCall(path, { token, body, query } = {}) {
  const ts = Date.now(), nonce = crypto.randomUUID();
  const h = {
    'Xx-Device-Type': 'pcf', 'Xx-Is-Cn': '1', 'Xx-Nonce': nonce, 'Xx-Timestamp': String(ts), 'Xx-Version': C_VER,
    'Xx-Signature': md5(C_APP + ts + C_VER + C_SEC + nonce + C_APP), 'Content-Type': 'application/json', 'XX-LANGUAGE': 'US',
  };
  if (token) h['XX-Token'] = token;
  const url = CLOUD + path + (query ? '?' + new URLSearchParams(query) : '');
  const data = body ? JSON.stringify(body) : null;
  return new Promise((ok, bad) => {
    const rq = https.request(url, { method: data ? 'POST' : 'GET', headers: h, timeout: 15e3 }, r => {
      let b = ''; r.setEncoding('utf8'); r.on('data', c => (b += c));
      r.on('end', () => { try { ok(JSON.parse(b)); } catch (_) { bad(new Error('облако Anycubic ответило не JSON (' + r.statusCode + ')')); } });
    });
    rq.on('timeout', () => rq.destroy(new Error('облако Anycubic не отвечает')));
    rq.on('error', bad);
    rq.end(data || undefined);
  });
}

function getJson(url, method = 'GET', timeout = 8000) {
  return new Promise((ok, bad) => {
    const rq = http.request(url, { method, timeout }, r => {
      let b = ''; r.setEncoding('utf8'); r.on('data', c => (b += c));
      r.on('end', () => { try { ok(JSON.parse(b)); } catch (_) { bad(new Error('принтер ответил не JSON')); } });
    });
    rq.on('timeout', () => rq.destroy(new Error('нет ответа')));
    rq.on('error', bad);
    rq.end();
  });
}

// логин MQTT принтера по его токену (как в Anycubic Slicer Next)
async function credentials(ip, pcId) {
  const info = await getJson(`http://${ip}:18910/info`);
  if (!info?.token || !info?.ctrlInfoUrl) throw new Error('принтер не отдал токен: включён ли режим LAN?');
  const ts = String(Date.now()), nonce = crypto.randomBytes(4).toString('hex').slice(0, 6);
  const sign = md5(md5(info.token.slice(0, 16)) + ts + nonce);
  const u = new URL(info.ctrlInfoUrl);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) u.hostname = ip;
  Object.entries({ ts, nonce, sign, did: pcId }).forEach(([k, v]) => u.searchParams.set(k, v));
  const ctrl = await getJson(u.toString(), 'POST');
  if (ctrl?.code !== 200 || !ctrl.data?.info) throw new Error('принтер не дал доступ: ' + JSON.stringify(ctrl).slice(0, 120));
  const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(info.token.slice(16, 32)), Buffer.from(ctrl.data.token));
  const c = JSON.parse(Buffer.concat([d.update(Buffer.from(ctrl.data.info, 'base64')), d.final()]).toString('utf8'));
  return { ip, broker: c.broker, deviceId: c.deviceId, modeId: String(c.modeId ?? c.modelId), model: c.modelName || NAME, username: c.username, password: c.password || c.passWd };
}

// ищем принтер в сети студии: у кого открыт порт 18910 и /info похож на Anycubic
async function scan(log) {
  const nets = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal && /^(10|172|192)\./.test(a.address)) nets.push(a.address.split('.').slice(0, 3).join('.'));
  }
  for (const sub of [...new Set(nets)]) {
    const ips = Array.from({ length: 254 }, (_, i) => sub + '.' + (i + 1));
    for (let i = 0; i < ips.length; i += 32) {
      const hits = await Promise.all(ips.slice(i, i + 32).map(ip => getJson(`http://${ip}:18910/info`, 'GET', 1500).then(j => (j?.token ? ip : null), () => null)));
      const ip = hits.find(Boolean);
      if (ip) return ip;
    }
  }
  log('Anycubic: принтер в сети не найден (сети: ' + (nets.join(', ') || 'нет') + ')');
  await survey(nets, log);
  return null;
}

// Принтер не нашёлся — записываем, какие устройства вообще видны в сети и какие у них открыты порты
// (файл anycubic-scan.txt рядом с ботом). По нему видно, где принтер и включён ли на нём режим LAN:
// у Anycubic в LAN-режиме открыты 18910 и 9883, у Bambu — 990, 8883, 6000. Не чаще раза в час.
const PORTS = [18910, 9883, 990, 8883, 6000, 80, 443, 554, 7125, 8080];
let surveyedAt = 0;
const tcpOpen = (ip, port, ms = 700) => new Promise(ok => {
  const s = net.connect({ host: ip, port });
  const done = v => { s.destroy(); ok(v); };
  s.setTimeout(ms, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false));
});
async function survey(nets, log) {
  if (Date.now() - surveyedAt < 60 * 60e3) return;
  surveyedAt = Date.now();
  const rows = [];
  for (const n of [...new Set(nets)]) {
    const ips = Array.from({ length: 254 }, (_, i) => n + '.' + (i + 1));
    for (let i = 0; i < ips.length; i += 64) {
      await Promise.all(ips.slice(i, i + 64).map(async ip => {
        const open = (await Promise.all(PORTS.map(p => tcpOpen(ip, p).then(o => (o ? p : 0))))).filter(Boolean);
        if (open.length) rows.push({ ip, open });
      }));
    }
  }
  let arp = '';
  try { arp = execFileSync('arp', ['-a'], { encoding: 'utf8', timeout: 10e3, windowsHide: true }); } catch (_) {}
  const mac = ip => (arp.match(new RegExp('\\b' + ip.replace(/\./g, '\\.') + '\\s+([0-9a-f]{2}[-:][0-9a-f-:]{14})', 'i')) || [])[1] || '';
  const guess = o => o.includes(18910) || o.includes(9883) ? 'похоже на Anycubic' : o.includes(990) || o.includes(6000) ? 'похоже на Bambu Lab' : '';
  rows.sort((a, b) => +a.ip.split('.')[3] - +b.ip.split('.')[3]);
  const txt = [`Проверка сети ${new Date().toLocaleString('ru-RU')}; сети: ${nets.join(', ')}`,
    ...rows.map(r => `${r.ip}\t${mac(r.ip)}\tпорты ${r.open.join(',')}\t${guess(r.open)}`),
    '', 'Все устройства из arp -a:', arp].join('\n');
  try { writeFileSync(join(DIR0, 'anycubic-scan.txt'), txt); } catch (_) {}
  log('Anycubic: в сети видно ' + rows.length + ' устройств с открытыми портами' + (rows.some(r => guess(r.open).includes('Anycubic')) ? ', есть похожее на Anycubic' : ', Anycubic среди них нет') + ' (подробно в anycubic-scan.txt)');
}
let DIR0 = '.';

// ---------- маленький клиент MQTT 3.1.1 (только то, что нужно) ----------
const str = s => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };
function pkt(type, body) {
  const len = []; let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 0x80; len.push(d); } while (n);
  return Buffer.concat([Buffer.from([type, ...len]), body]);
}
const connectPkt = (id, u, p) => pkt(0x10, Buffer.concat([str('MQTT'), Buffer.from([4, 0xC2, 0, 60]), str(id), str(u), str(p)]));
const subPkt = topic => pkt(0x82, Buffer.concat([Buffer.from([0, 1]), str(topic), Buffer.from([0])]));
const pubPkt = (topic, obj) => pkt(0x30, Buffer.concat([str(topic), Buffer.from(JSON.stringify(obj), 'utf8')]));

export function startAnycubic({ fs, env, log, DIR }) {
  const rt = fs?.rt;
  if (!rt) return;
  DIR0 = DIR;
  const file = join(DIR, 'anycubic.json');
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch (_) {}
  if (!cfg.pcId) cfg.pcId = crypto.randomBytes(16).toString('hex').toUpperCase();
  const save = () => { try { writeFileSync(file, JSON.stringify(cfg, null, 1)); } catch (_) {} };
  save();

  const st = { work: '', pstate: '', proj: {}, code: 0, seen: 0, since: 0, lastOnline: cfg.lastOnline || 0, problem: '' };
  let sock = null, buf = Buffer.alloc(0), timer = null, lastSent = '', sentAt = 0, failN = 0;

  // ---------- что отдаём учёту ----------
  function summary() {
    const online = st.seen > 0 && Date.now() - st.seen < SEEN_TTL;
    const p = st.proj || {};
    let raw = String(st.pstate || p.state || '').toLowerCase();
    if (!raw && p.print_status != null) raw = PRINT_STATUS[+p.print_status] || '';
    let state = STATE[raw] || '';
    const work = String(st.work || '').toLowerCase();
    if (work === 'free' && state !== 'FINISH' && state !== 'FAILED') state = 'IDLE';
    if (!state && work === 'busy') state = 'RUNNING';
    if (!state && online) state = 'IDLE';
    const busy = ['RUNNING', 'PREPARE', 'PAUSE'].includes(state);
    const err = st.code && ![0, 200].includes(+st.code) && (busy || state === 'FAILED') ? +st.code : 0;
    return {
      name: cfg.model && !/^anycubic/i.test(cfg.model) ? 'Anycubic ' + cfg.model : cfg.model || NAME,
      online: online ? true : st.seen || cfg.cred ? false : null,
      state: online ? state : '',
      progress: online && busy && p.progress != null ? Math.round(+p.progress) || 0 : null,
      remain: online && busy && p.remain_time != null ? Math.round(+p.remain_time) || 0 : null, // минуты
      file: online && busy ? String(p.filename || p.task_name || '').slice(0, 80) : '',
      error: err || null, errorText: err ? errText(err) : '',
      since: online ? st.since : null, lastOnline: st.lastOnline || null,
      problem: online ? '' : st.problem,
    };
  }
  async function push(force) {
    const s = summary(), key = JSON.stringify({ ...s, lastOnline: s.online ? 0 : s.lastOnline }); // «был в сети» меняется каждые 30 с — само по себе не повод писать
    if (!force && key === lastSent && Date.now() - sentAt < BEAT_EVERY) return;
    try { await rt.set(SIG, { ...s, updated: Date.now(), at: Date.now() }); lastSent = key; sentAt = Date.now(); }
    catch (e) { log('Anycubic: не записал состояние:', e?.message || e); }
  }

  // ---------- разбор ответов принтера ----------
  function onReport(topic, j) {
    if (!j || typeof j !== 'object') return;
    const now = Date.now();
    if (!st.seen || now - st.seen >= SEEN_TTL) st.since = now;
    st.seen = now; st.lastOnline = now;
    if (now - (cfg.lastOnline || 0) > 10 * 60e3) { cfg.lastOnline = now; save(); }
    const type = j.type || topic.split('/').filter(x => x !== 'report').pop();
    const d = j.data && typeof j.data === 'object' ? j.data : {};
    if (type === 'status') { if (d.state || j.state) st.work = d.state || j.state; }
    else if (type === 'info') {
      if (d.state) st.work = d.state;
      if (d.project && typeof d.project === 'object') { st.proj = { ...st.proj, ...d.project }; if (d.project.state) st.pstate = d.project.state; }
      else if (String(d.state || '').toLowerCase() === 'free' && !['finished', 'failed'].includes(String(st.pstate).toLowerCase())) { st.proj = {}; st.pstate = ''; }
    } else if (type === 'print') {
      st.proj = { ...st.proj, ...d };
      if (j.state) st.pstate = j.state;
      const c = +j.code;
      if (Number.isFinite(c) && c) st.code = c;
      if (['printing', 'preheating', 'checking', 'auto_leveling', 'resumed'].includes(String(j.state).toLowerCase()) && (!c || c === 200)) st.code = 0;
    }
    push();
  }
  function onData(chunk) {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      let len = 0, mul = 1, i = 1, b;
      do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
      if (buf.length < i + len) return;
      const type = buf[0], body = buf.subarray(i, i + len);
      buf = buf.subarray(i + len);
      if ((type & 0xF0) === 0x20 && body[1] !== 0) { st.problem = 'принтер не пустил (код ' + body[1] + ')'; cfg.cred = null; save(); sock?.destroy(); return; }
      if ((type & 0xF0) !== 0x30) continue;
      const tl = body.readUInt16BE(0), topic = body.subarray(2, 2 + tl).toString('utf8');
      const off = 2 + tl + ((type & 0x06) ? 2 : 0);
      try { onReport(topic, JSON.parse(body.subarray(off).toString('utf8'))); } catch (_) {}
    }
  }
  const ask = type => {
    if (!sock || !cfg.cred) return;
    const c = cfg.cred;
    sock.write(pubPkt(`anycubic/anycubicCloud/v1/web/printer/${c.modeId}/${c.deviceId}/${type}`,
      { type, action: 'query', timestamp: Date.now(), msgid: crypto.randomUUID(), data: null }));
  };

  // ---------- подключение ----------
  async function findAndLogin() {
    const ip = (env.ANYCUBIC_IP || '').trim() || cfg.ip || await scan(log);
    if (!ip) { st.problem = 'принтер не найден в сети студии'; return false; }
    try {
      cfg.cred = await credentials(ip, cfg.pcId);
      cfg.ip = ip; cfg.model = cfg.cred.model; save();
      log('Anycubic: нашёл принтер ' + cfg.model + ' по адресу ' + ip);
      return true;
    } catch (e) {
      st.problem = String(e?.message || e);
      log('Anycubic (' + ip + '):', st.problem);
      if (!env.ANYCUBIC_IP) { cfg.ip = ''; save(); } // адрес мог смениться — в следующий раз поищем заново
      return false;
    }
  }
  function connect() {
    const c = cfg.cred;
    let port = 9883, host = c.ip || cfg.ip;
    try { const u = new URL(String(c.broker).replace(/^mqtts?:/, 'http:')); if (u.port) port = +u.port; if (u.hostname && /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) host = u.hostname; } catch (_) {}
    return new Promise(done => {
      const s = tls.connect({ host, port, rejectUnauthorized: false, timeout: 15e3 }, () => {
        s.setTimeout(0);
        s.write(connectPkt('raz_' + cfg.pcId.slice(-8), c.username, c.password));
        s.write(subPkt(`anycubic/anycubicCloud/v1/printer/+/${c.modeId}/${c.deviceId}/#`));
        sock = s; buf = Buffer.alloc(0); failN = 0; st.problem = '';
        ['status', 'info'].forEach(ask);
      });
      s.on('data', onData);
      s.on('timeout', () => s.destroy(new Error('нет ответа')));
      s.on('error', e => { st.problem = 'нет связи с принтером (' + (e?.code || e?.message || e) + ')'; });
      s.on('close', () => { if (sock === s) sock = null; done(); });
    });
  }
  async function loop() {
    for (;;) {
      if (!cfg.cred && Date.now() - cloud.ok < 5 * 60e3) { await new Promise(f => setTimeout(f, SCAN_EVERY)); continue; } // облако работает — сеть не перебираем
      if (!cfg.cred && !(await findAndLogin())) { await push(); await new Promise(f => setTimeout(f, SCAN_EVERY)); continue; }
      await connect();
      await push();
      // принтер выключили или сменился адрес: после трёх неудач подряд заново ищем его и берём свежий логин
      if (++failN >= 3) { failN = 0; cfg.cred = null; if (!env.ANYCUBIC_IP) cfg.ip = ''; save(); }
      await new Promise(f => setTimeout(f, 30e3));
    }
  }

  // ---------- облако (без LAN) ----------
  const cloud = { ok: 0, why: '', acc: '', said: '' };
  const lanAlive = () => sock && st.seen && Date.now() - st.seen < SEEN_TTL;
  const say = m => { if (m !== cloud.said) { cloud.said = m; log('Anycubic (облако):', m); } };
  async function cloudLogin() {
    const t = slicerToken(env);
    if (!t.tok) { cloud.why = t.why; return false; }
    if (t.exp && t.exp < Date.now()) { cloud.why = 'вход в Slicer Next устарел: откройте Slicer Next и войдите заново'; return false; }
    if (cfg.cloud && cfg.cloud.acc === md5(t.tok) && cfg.cloud.token) return true;
    const r = await cloudCall('/v3/public/loginWithAccessToken', { body: { device_type: 'pcf', access_token: t.tok } });
    if (!r?.data?.token) { cloud.why = 'облако Anycubic не приняло вход (' + (r?.msg || r?.code || 'нет ответа') + '): откройте Slicer Next и войдите заново'; return false; }
    cfg.cloud = { acc: md5(t.tok), token: r.data.token }; save();
    say('вошёл в облако через Slicer Next');
    return true;
  }
  async function cloudPoll() {
    if (lanAlive()) return; // принтер и так слышно по локальной сети
    if (!(await cloudLogin())) { say(cloud.why); if (!st.seen || Date.now() - st.seen >= SEEN_TTL) st.problem = cloud.why; return; }
    const pr = await cloudCall('/work/printer/getPrinters', { token: cfg.cloud.token });
    if (!Array.isArray(pr?.data)) { // ключ облака отозван — в следующий раз войдём заново
      cfg.cloud = null; save(); cloud.why = 'облако Anycubic: ' + (pr?.msg || 'нет списка принтеров'); say(cloud.why); return;
    }
    const want = String(env.ANYCUBIC_NAME || '').toLowerCase();
    const p = pr.data.find(x => want && String(x.name || '').toLowerCase().includes(want)) || pr.data.find(x => /kobra\s*x/i.test(x.model || x.name || '')) || pr.data[0];
    if (!p) { cloud.why = 'в аккаунте Anycubic нет принтеров'; st.problem = cloud.why; say(cloud.why); return; }
    cloud.ok = Date.now();
    if (p.model) { const m = String(p.model); if (cfg.model !== m) { cfg.model = m; save(); } }
    if (+p.device_status !== 1) { st.problem = 'принтер выключен или не в сети'; say('принтер не в сети'); return; }
    let proj = null;
    try {
      const pj = await cloudCall('/work/project/getProjects', { token: cfg.cloud.token, query: { page: '1', limit: '10' } });
      proj = (Array.isArray(pj?.data) ? pj.data : []).find(x => +x.printer_id === +p.id) || null;
    } catch (_) {}
    const now = Date.now();
    if (!st.seen || now - st.seen >= SEEN_TTL) st.since = now;
    st.seen = now; st.lastOnline = now; st.problem = '';
    if (now - (cfg.lastOnline || 0) > 10 * 60e3) { cfg.lastOnline = now; save(); }
    const ps = proj ? +proj.print_status : 0, ended = proj && +proj.end_time ? +proj.end_time * (+proj.end_time < 1e12 ? 1000 : 1) : 0;
    const busy = [1, 4, 5, 6, 9, 10, 11].includes(ps);
    if (busy) {
      st.work = 'busy'; st.pstate = +proj.pause === 1 ? 'paused' : PRINT_STATUS[ps] || 'printing';
      st.proj = { progress: proj.progress, remain_time: proj.remain_time, filename: proj.gcode_name || proj.name || '' };
    } else {
      st.work = 'free'; st.proj = {};
      st.pstate = ps === 2 && ended && now - ended < 30 * 60e3 ? 'finished' : ps === 3 && ended && now - ended < 30 * 60e3 ? 'failed' : '';
    }
    st.code = 0;
    say('на связи');
    push();
  }
  (async () => {
    for (;;) {
      try { await cloudPoll(); } catch (e) { say(String(e?.message || e)); }
      await new Promise(f => setTimeout(f, CLOUD_EVERY));
    }
  })();

  timer = setInterval(() => {
    if (sock) { try { sock.write(Buffer.from([0xC0, 0])); ['status', 'info'].forEach(ask); } catch (_) {} }
    push();
  }, ASK_EVERY);
  loop().catch(e => log('Anycubic:', e?.message || e));
  log('Anycubic: слежу за принтером (по локальной сети или через облако Slicer Next)');
  return { stop: () => { clearInterval(timer); sock?.destroy(); } };
}
