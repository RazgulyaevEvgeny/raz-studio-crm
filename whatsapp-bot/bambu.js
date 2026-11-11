// Принтеры Bambu Lab по сети студии — без облака Bambu.
// С 11.11.2026 облако Bambu не отдаёт список принтеров панели тревоги bambu-watch (Cloudflare),
// поэтому бот на рабочем компьютере слушает принтеры напрямую в локальной сети, официальным способом Bambu:
//   - принтеры сами рассказывают о себе в сети (SSDP, порт 2021): адрес, серийный номер, модель, название;
//   - состояние печати бот получает по MQTT принтера (порт 8883, логин bblp + «Access Code» с экрана принтера).
// Коды доступа Евгений вписывает сам в файл bambu-codes.txt рядом с ботом (в git не попадает):
//   Белый = 12345678
// Результат → Realtime Database sig/printers/bambu = { at, list: [{ name, model, ip, online, state, progress, remain, task, error, hms, ... }] }
// Учёт (виджет «Оборудование в студии») показывает его, когда облако Bambu не отвечает.
// Тревоги (принтер пропал из сети, ошибка печати) бот шлёт через bambu-watch /api/alarm (ключ в alarm.json),
// но только пока облако Bambu недоступно панели — иначе звонит она сама. Отключённые на панели принтеры и пауза тревоги учитываются.

import tls from 'node:tls';
import dgram from 'node:dgram';
import { readFileSync, writeFileSync, existsSync, watchFile } from 'node:fs';
import { join } from 'node:path';

const WATCH = 'https://bambu-watch.design-onegin.workers.dev';
const SEEN_TTL = 2 * 60e3;            // принтер не слышно столько — считаем, что он не в сети
const OFFLINE_ALERT = 3 * 60e3, REPEAT = 15 * 60e3;
const PUSH_EVERY = 60e3;
const PRINT_STATES = ['RUNNING', 'PREPARE', 'PAUSE'];
const CALM_STATES = ['RUNNING', 'PREPARE', 'IDLE', 'FINISH'];
const IGNORE_ERRORS = ['07FF_8007', '0300_400C', '0300_8001'];
const ERR_TEXT = {
  '0300_8004': 'Закончился пластик: вставьте новый', '1201_8015': 'Пластик застрял или оборвался в экструдере',
  '07FF_8003': 'Оборвался пластик: уберите остаток с держателя катушки', '0300_4006': 'Засорилось сопло', '0300_8016': 'Засорилось сопло',
  '0700_8007': 'Пластик не подаётся, возможно засор экструдера', '0300_8009': 'Проблема с нагревом стола',
  '0300_8008': 'Печать остановлена: проблема с температурой сопла', '0500_403A': 'Слишком холодно в помещении, принтер не печатает',
  '0300_4008': 'AMS не смог сменить пластик', '0700_8004': 'AMS не смог вытянуть пластик назад',
  '0C00_8001': 'Дефект первого слоя: проверьте и продолжите', '0300_8002': 'Дефект первого слоя: проверьте и продолжите',
  '0300_8003': 'Печать сорвалась («спагетти»)', '0C00_8002': 'Печать сорвалась («спагетти»)',
  '0300_8017': 'Посторонний предмет на столе: уберите и продолжите', '0300_8005': 'Слетела передняя крышка головы',
  '0300_800F': 'Открыта дверца, печать на паузе', '0300_400D': 'Не удалось продолжить после отключения света',
  '0300_8007': 'Печать прервана отключением света', '0300_4009': 'Ошибка калибровки осей X и Y', '0300_4000': 'Ошибка калибровки оси Z',
};
const hex8 = n => (Number(n) >>> 0).toString(16).toUpperCase().padStart(8, '0');
const errKey = n => { if (!Number(n)) return ''; const h = hex8(n); return h.slice(0, 4) + '_' + h.slice(4); };
const errText = k => ERR_TEXT[k] || (/^07[0-9A-F]{2}_8011$/.test(k) ? 'В AMS закончился пластик' : `Ошибка принтера, код ${k}: подробности в Bambu Handy`);

// ---------- минимальный MQTT 3.1.1 ----------
const str = s => { const b = Buffer.from(String(s), 'utf8'); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
function pkt(type, body) {
  const len = []; let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0);
  return Buffer.concat([Buffer.from([type, ...len]), body]);
}
const connectPkt = (id, u, p) => pkt(0x10, Buffer.concat([str('MQTT'), Buffer.from([4, 0xC2, 0, 60]), str(id), str(u), str(p)]));
const subPkt = topic => pkt(0x82, Buffer.concat([Buffer.from([0, 1]), str(topic), Buffer.from([0])]));
const pubPkt = (topic, obj) => pkt(0x30, Buffer.concat([str(topic), Buffer.from(JSON.stringify(obj), 'utf8')]));
const PING = Buffer.from([0xC0, 0]);

export function startBambuLan({ fs, env, log, DIR }) {
  const rt = fs?.rt;
  if (!rt) return;
  const codesFile = join(DIR, 'bambu-codes.txt'), cacheFile = join(DIR, 'bambu-lan.json');
  let cache = {}; try { cache = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch (_) {}
  cache.p = cache.p || {}; // серийный номер → { name, model, ip }
  const saveCache = () => { try { writeFileSync(cacheFile, JSON.stringify(cache, null, 1)); } catch (_) {} };
  const said = {};
  const say = (k, m) => { if (said[k] !== m) { said[k] = m; log(m); } };

  let alarmKey = String(env.ALARM_TOKEN || '').trim();
  if (!alarmKey) try { alarmKey = String(JSON.parse(readFileSync(join(DIR, 'alarm.json'), 'utf8')).token || '').trim(); } catch (_) {}

  // ---------- коды доступа ----------
  let codes = {};
  function readCodes() {
    const out = {};
    try {
      for (const line of readFileSync(codesFile, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([^#=]+?)\s*=\s*(\S+)\s*$/.exec(line);
        if (m) out[m[1].trim().toLowerCase()] = m[2];
      }
    } catch (_) {}
    codes = out;
  }
  const codeFor = p => codes[String(p.name || '').toLowerCase()] || codes[p.ip] || codes[String(p.sn).toLowerCase()] || '';
  function writeTemplate() { // файл-заготовка с найденными названиями: человеку остаётся вписать коды
    const names = Object.values(cache.p).map(p => p.name).filter(Boolean);
    let old = ''; try { old = readFileSync(codesFile, 'utf8'); } catch (_) {}
    const have = new Set(old.split(/\r?\n/).map(l => (/^\s*([^#=]+?)\s*=/.exec(l) || [])[1]?.trim().toLowerCase()).filter(Boolean));
    const add = names.filter(n => !have.has(n.toLowerCase()));
    if (!old) old = '# Коды доступа принтеров Bambu Lab для бота студии.\r\n# Код (Access Code, 8 символов) есть на экране принтера: Настройки → WLAN или Network → Access Code.\r\n# Впишите код после знака «=», сохраните файл (Ctrl+S) и закройте. Бот подхватит сам.\r\n';
    if (!add.length && existsSync(codesFile)) return;
    try { writeFileSync(codesFile, old.replace(/\s*$/, '\r\n') + add.map(n => n + ' = \r\n').join('')); } catch (_) {}
  }
  readCodes();
  watchFile(codesFile, { interval: 5000 }, (c, p) => { if (c.mtimeMs !== p.mtimeMs) { readCodes(); log('Bambu (сеть): обновил коды доступа'); for (const [sn, p] of Object.entries(P)) { if (p.mq) reconnect(sn); else mqtt(p); } } });

  // ---------- состояние принтеров ----------
  const P = {}; // серийный номер → { sn, name, model, ip, seen, mq: {sock, buf, ok, err}, rep: {...print}, since, lastOnline }
  const pr = sn => P[sn] || (P[sn] = { sn, ...(cache.p[sn] || {}), seen: 0, rep: {}, since: 0, lastOnline: 0, mq: null, err: '' });
  const online = p => !!(p.seen && Date.now() - p.seen < SEEN_TTL);

  // ---------- поиск принтеров в сети (SSDP) ----------
  function onSsdp(msg, rinfo) {
    const t = msg.toString('utf8');
    if (!/bambu/i.test(t)) return;
    const h = {};
    for (const line of t.split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
    const sn = (h.usn || '').trim();
    if (!sn) return;
    const p = pr(sn), ip = h.location || rinfo.address, name = h['devname.bambu.com'] || p.name || sn, model = h['devmodel.bambu.com'] || p.model || '';
    const was = online(p);
    p.seen = Date.now(); p.lastOnline = p.seen;
    if (!was) p.since = p.seen;
    if (p.ip !== ip || p.name !== name || p.model !== model) {
      p.ip = ip; p.name = name; p.model = model;
      cache.p[sn] = { name, model, ip }; saveCache();
      say('ssdp' + sn, `Bambu (сеть): нашёл «${name}» (${model || 'модель ?'}) по адресу ${ip}`);
      writeTemplate();
    }
    if (!p.mq) mqtt(p);
  }
  function listen(port) {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('message', onSsdp);
    s.on('error', e => say('udp' + port, `Bambu (сеть): не могу слушать порт ${port} (${e.code || e.message})`));
    s.bind(port, () => { try { s.setBroadcast(true); } catch (_) {} });
    return s;
  }
  const udp = [listen(2021), listen(1990)];
  const ask = () => { // просим принтеры откликнуться сразу, не дожидаясь их объявления
    const m = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1990\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:bambulab-com:device:3dprinter:1\r\n\r\n');
    for (const [host, port] of [['239.255.255.250', 1990], ['255.255.255.255', 2021]]) try { udp[0].send(m, port, host); } catch (_) {}
  };

  // ---------- MQTT принтера ----------
  function reconnect(sn) { const p = P[sn]; if (p?.mq?.sock) try { p.mq.sock.destroy(); } catch (_) {} }
  function mqtt(p) {
    const code = codeFor(p);
    if (!code) { p.err = 'нет кода доступа'; say('code' + p.sn, `Bambu (сеть): для «${p.name}» нет кода доступа в bambu-codes.txt`); return; }
    if (!p.ip) return;
    const mq = p.mq = { sock: null, buf: Buffer.alloc(0), ok: false };
    const s = tls.connect({ host: p.ip, port: 8883, rejectUnauthorized: false, timeout: 15e3 }, () => {
      s.setTimeout(0);
      s.write(connectPkt('raz_' + p.sn.slice(-6) + '_' + Math.random().toString(36).slice(2, 6), 'bblp', code));
    });
    mq.sock = s;
    let ping = null;
    s.on('data', chunk => {
      mq.buf = Buffer.concat([mq.buf, chunk]);
      for (;;) {
        const b = mq.buf; if (b.length < 2) return;
        let len = 0, mul = 1, i = 1, d;
        do { if (i >= b.length) return; d = b[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
        if (b.length < i + len) return;
        const type = b[0] >> 4, flags = b[0] & 15, body = b.subarray(i, i + len);
        mq.buf = b.subarray(i + len);
        if (type === 2) { // CONNACK
          if (body[1] !== 0) { p.err = body[1] === 4 || body[1] === 5 ? 'код доступа не подошёл' : 'принтер не пустил (код ' + body[1] + ')'; say('mq' + p.sn, `Bambu (сеть): «${p.name}»: ${p.err}`); s.destroy(); return; }
          mq.ok = true; p.err = '';
          s.write(subPkt(`device/${p.sn}/report`));
          s.write(pubPkt(`device/${p.sn}/request`, { pushing: { sequence_id: '0', command: 'pushall' } }));
          let n = 0;
          ping = setInterval(() => { try { s.write(PING); if (++n % 10 === 0) s.write(pubPkt(`device/${p.sn}/request`, { pushing: { sequence_id: String(n), command: 'pushall' } })); } catch (_) {} }, 30e3);
          say('mq' + p.sn, `Bambu (сеть): «${p.name}» на связи`);
        } else if (type === 13) { // ответ на ping: принтер на связи
          const was = online(p); p.seen = Date.now(); p.lastOnline = p.seen; if (!was) { p.since = p.seen; changed(); }
        } else if (type === 3) {
          const tl = (body[0] << 8) | body[1], off = 2 + tl + (((flags >> 1) & 3) ? 2 : 0);
          let j; try { j = JSON.parse(body.subarray(off).toString('utf8')); } catch (_) { continue; }
          if (j?.print) {
            const was = online(p);
            p.rep = { ...p.rep, ...j.print }; p.seen = Date.now(); p.lastOnline = p.seen; p.updated = p.seen;
            if (!was) p.since = p.seen;
            changed();
          }
        }
      }
    });
    s.on('timeout', () => s.destroy(new Error('нет ответа')));
    s.on('error', e => { if (!p.err || mq.ok) p.err = 'нет связи с принтером (' + (e?.code || e?.message || e) + ')'; });
    s.on('close', () => {
      clearInterval(ping);
      if (p.mq === mq) p.mq = null;
      setTimeout(() => { if (!p.mq && (online(p) || p.ip)) mqtt(p); }, p.err === 'код доступа не подошёл' ? 5 * 60e3 : 30e3);
    });
  }

  // ---------- в учёт ----------
  let sent = '', sentAt = 0, pushT = null;
  const changed = () => { if (!pushT) pushT = setTimeout(() => { pushT = null; push(); }, 3000); };
  function snapshot() {
    return Object.values(P).filter(p => p.name).map(p => {
      const on = online(p), r = p.rep || {};
      const fresh = on && p.mq?.ok;
      return {
        name: p.name, model: p.model || '', ip: p.ip || '', online: on,
        since: on ? p.since || null : null, lastOnline: on ? null : p.lastOnline || null,
        state: fresh ? r.gcode_state || null : null,
        progress: fresh && r.mc_percent != null ? +r.mc_percent : null,
        remain: fresh && r.mc_remaining_time != null ? +r.mc_remaining_time : null,
        task: fresh ? r.subtask_name || null : null,
        error: fresh ? Number(r.print_error) || 0 : 0,
        hms: fresh && Array.isArray(r.hms) ? r.hms.slice(0, 5).map(h => ({ attr: h.attr, code: h.code })) : [],
        updated: fresh ? p.updated || null : null,
        note: on && !fresh ? (p.err === 'нет кода доступа' ? 'впишите код доступа принтера в bambu-codes.txt на рабочем компьютере' : p.err || 'подключаюсь к принтеру…') : '',
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }
  async function push() {
    const list = snapshot();
    const key = JSON.stringify(list.map(p => ({ ...p, updated: 0, remain: p.remain == null ? null : Math.round(p.remain / 5) })));
    if (key === sent && Date.now() - sentAt < PUSH_EVERY) return;
    sent = key; sentAt = Date.now();
    try { await rt.set('sig/printers/bambu', { at: Date.now(), list }); } catch (e) { say('w', 'Bambu (сеть): не записал в учёт: ' + (e?.message || e)); }
  }

  // ---------- тревоги ----------
  async function bark(title, body, critical = true) {
    if (!alarmKey) return false;
    try {
      const r = await fetch(WATCH + '/api/alarm', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ token: alarmKey, title, body, critical }), signal: AbortSignal.timeout(15e3) });
      return !!(await r.json().catch(() => ({}))).ok;
    } catch (e) { log('Bambu (сеть): тревога не ушла: ' + (e?.message || e)); return false; }
  }
  let panel = { at: 0, cloudOk: true, muted: [], paused: false };
  async function readPanel() { // облако Bambu у панели работает? какие принтеры отключены вручную? пауза?
    if (Date.now() - panel.at < 3 * 60e3) return;
    try {
      const j = await fetch(WATCH + '/api/status', { signal: AbortSignal.timeout(20e3) }).then(r => r.json());
      panel = { at: Date.now(), cloudOk: !!j.ok, muted: j.muted || [], paused: !!j.pausedUntil };
    } catch (_) { panel.at = Date.now(); }
  }
  cache.al = cache.al || {};
  async function alarms() {
    await readPanel();
    if (panel.cloudOk) return; // облако работает — звонит сама панель
    const now = Date.now(), al = cache.al;
    let dirty = false;
    // пропали из сети
    const known = Object.values(P).filter(p => p.name && !panel.muted.includes(p.name));
    const off = known.filter(p => !online(p) && p.lastOnline && now - p.lastOnline >= OFFLINE_ALERT);
    if (!off.length) {
      if (al.offAlerted) { await bark('✅ Снова в сети', known.map(p => p.name).join(', ') + ' в сети', false); al.offAlerted = 0; dirty = true; }
    } else if (!panel.paused && (!al.offAlerted || now - al.offAlerted >= REPEAT)) {
      const mins = Math.round((now - Math.max(...off.map(p => p.lastOnline))) / 6e4);
      await bark('🚨 Мастерская не в сети', off.map(p => p.name).join(', ') + ' офлайн уже ' + mins + ' мин. Возможно, пропал свет или Wi‑Fi.');
      al.offAlerted = now; dirty = true;
    }
    // ошибки печати
    al.err = al.err || {};
    for (const p of known) {
      if (!online(p) || !p.mq?.ok) continue;
      const r = p.rep || {}, k = errKey(r.print_error), prev = al.err[p.name];
      if (k && !IGNORE_ERRORS.includes(k) && PRINT_STATES.includes(r.gcode_state)) {
        if (!prev || prev.k !== k) {
          if (!panel.paused) await bark(`${p.name}: ${errText(k)}`, r.subtask_name ? 'Задание: ' + r.subtask_name : 'Откройте Bambu Handy');
          al.err[p.name] = { k, at: now, alerted: !panel.paused }; dirty = true;
        }
      } else if (prev && !k && CALM_STATES.includes(r.gcode_state)) {
        if (prev.alerted) await bark(`${p.name}: ошибка устранена`, r.gcode_state === 'RUNNING' || r.gcode_state === 'PREPARE' ? 'Печать продолжается' : 'Принтер свободен', false);
        delete al.err[p.name]; dirty = true;
      }
    }
    if (dirty) saveCache();
  }

  // ---------- запуск ----------
  for (const [sn, c] of Object.entries(cache.p)) { const p = pr(sn); Object.assign(p, c); } // знакомые принтеры: подключаемся, не дожидаясь объявления
  setTimeout(() => { for (const p of Object.values(P)) if (!p.mq) mqtt(p); }, 3000);
  ask(); setInterval(ask, 60e3);
  setInterval(() => { push(); alarms().catch(e => log('Bambu (сеть): ' + (e?.message || e))); }, PUSH_EVERY);
  setTimeout(push, 10e3);
  log('Bambu (сеть): слушаю принтеры в сети студии');
}
