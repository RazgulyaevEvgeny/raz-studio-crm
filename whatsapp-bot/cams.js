// Камеры Imou в учёте (вкладка «Камеры»): живая картинка без приложения Imou и без платных сервисов.
//
// Как это работает:
//   1) Камеры в сети студии отдают видео по RTSP (порт 554). Вход: admin + код с наклейки камеры (Safety Code).
//      Коды человек вписывает сам в cameras.txt рядом с ботом (в git не попадает, в чат не присылать):
//        Принтер в мастерской = ABCDEFGH
//   2) Бот сам находит камеры в сети, подбирает, какой код к какой подходит, и держит с каждой постоянную связь
//      через ffmpeg (бесплатная программа, бот скачивает её сам в папку tools). Последний кадр всегда лежит в памяти,
//      поэтому при открытии вкладки картинка появляется сразу.
//   3) Маленький веб-сервер бота (только на этом компьютере, порт 3778) отдаёт кадры, а бесплатный туннель
//      Cloudflare (cloudflared, «quick tunnel», без аккаунта) делает его доступным учёту с любого телефона.
//      Адрес туннеля и ключ доступа бот кладёт в Realtime Database: sig/studio/cams (читают только сотрудники).
//      Видео через базу НЕ идёт — только короткая сводка, лимиты Firebase не тратятся.
//   4) Без ключа сервер ничего не показывает. Пока вкладку никто не смотрит, в интернет не уходит ни одного кадра.
//
// sig/studio/cams: { url, key, list:[{ id, name, ok, w, h, problem }], need, note, at }

import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const HTTP_PORT = 3778;
const WIN = process.platform === 'win32';
const FFMPEG_ZIPS = ['https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'];
const CLOUDFLARED_EXE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
const FPS = 4, HD_FPS = 8, HD_IDLE = 25e3, WAIT_FRAME = 4e3;

const TEMPLATE = `# Камеры Imou для вкладки «Камеры» в учёте.
# Для каждой камеры после знака «=» впишите код с наклейки на камере
# (снизу или сзади: Safety Code, SC или «Код безопасности», обычно 8 латинских букв).
# Если код с наклейки не подходит — впишите пароль камеры, который задавали в приложении Imou Life.
# Сохраните файл (Ctrl+S) — бот подхватит его сам за полминуты, перезапускать ничего не нужно.
# Строки с решёткой в начале бот не читает.

Принтер в мастерской =
Камера в мастерской 2 =
`;

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
const findFile = (dir, name) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { const r = findFile(p, name); if (r) return r; }
    else if (f.toLowerCase() === name) return p;
  }
  return '';
};
const slug = s => 'c' + crypto.createHash('md5').update(String(s)).digest('hex').slice(0, 8);

export function startCams({ fs, env, log, DIR }) {
  const rt = fs?.rt;
  if (!rt) return;
  const codesFile = join(DIR, 'cameras.txt'), cfgFile = join(DIR, 'cameras.json'), TOOLS = join(DIR, 'tools'), pidFile = join(TOOLS, 'pids.json');
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(cfgFile, 'utf8')); } catch (_) {}
  cfg.ip = cfg.ip || {};
  if (!cfg.key) cfg.key = crypto.randomBytes(18).toString('hex');
  const save = () => { try { writeFileSync(cfgFile, JSON.stringify(cfg, null, 1)); } catch (_) {} };
  save();
  const said = {};
  const say = (k, m) => { if (said[k] !== m) { said[k] = m; log(m); } };
  try { mkdirSync(TOOLS, { recursive: true }); } catch (_) {}

  // ---------- хвосты прошлого запуска (бота закрыли «Стоп» — ffmpeg и туннель могли остаться) ----------
  const kids = new Set();
  const savePids = () => { try { writeFileSync(pidFile, JSON.stringify([...kids].map(c => c.pid).filter(Boolean))); } catch (_) {} };
  try {
    for (const pid of JSON.parse(readFileSync(pidFile, 'utf8'))) {
      try { if (WIN) execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', timeout: 5000 }); else process.kill(pid); } catch (_) {}
    }
  } catch (_) {}
  savePids();
  const run = (bin, args) => {
    const c = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    kids.add(c); savePids();
    c.once('exit', () => { kids.delete(c); savePids(); });
    c.once('error', () => {});
    return c;
  };
  process.on('exit', () => { for (const c of kids) try { c.kill(); } catch (_) {} });

  // ---------- сводка для учёта ----------
  const state = { url: '', need: '', note: '' };
  const cams = new Map(); // id → камера
  let sent = '', sentAt = 0;
  async function publish(force) {
    const list = [...cams.values()].map(c => ({ id: c.id, name: c.name, ok: !!c.frame && Date.now() - c.at < 20e3, w: c.w || 0, h: c.h || 0, problem: c.problem || '' }));
    const v = { url: state.url, key: state.url ? cfg.key : '', list, need: state.need, note: state.note };
    const k = JSON.stringify(v);
    if (!force && k === sent && Date.now() - sentAt < 5 * 60e3) return;
    sent = k; sentAt = Date.now();
    try { await rt.set('sig/studio/cams', { ...v, at: Date.now() }); } catch (e) { say('pub', 'Камеры: не записал сводку: ' + (e?.message || e)); }
  }

  // ---------- программы: ffmpeg и cloudflared (бесплатные, скачиваются один раз) ----------
  const which = n => { try { return execFileSync(WIN ? 'where' : 'which', [n], { encoding: 'utf8', timeout: 5000 }).split(/\r?\n/)[0].trim(); } catch (_) { return ''; } };
  async function download(url, to) {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60e3) });
    if (!r.ok) throw new Error('скачивание не удалось (' + r.status + ')');
    writeFileSync(to, Buffer.from(await r.arrayBuffer()));
  }
  async function ffmpegPath() {
    if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
    const local = join(TOOLS, WIN ? 'ffmpeg.exe' : 'ffmpeg');
    if (existsSync(local)) return local;
    const sys = which('ffmpeg'); if (sys) return sys;
    if (!WIN) throw new Error('нет ffmpeg');
    state.note = 'Скачиваю программу для видео (ffmpeg, ~90 МБ), это один раз…'; publish(true);
    log('Камеры: скачиваю ffmpeg (один раз)…');
    const zip = join(TOOLS, 'ffmpeg.zip'), tmp = join(TOOLS, 'ffmpeg-tmp');
    let last;
    for (const u of FFMPEG_ZIPS) { try { await download(u, zip); last = null; break; } catch (e) { last = e; } }
    if (last) throw last;
    try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    mkdirSync(tmp, { recursive: true });
    execFileSync('tar', ['-xf', zip, '-C', tmp], { timeout: 5 * 60e3, stdio: 'ignore' });
    const exe = findFile(tmp, 'ffmpeg.exe');
    if (!exe) throw new Error('в архиве ffmpeg не нашлось ffmpeg.exe');
    copyFileSync(exe, local);
    try { rmSync(tmp, { recursive: true, force: true }); rmSync(zip, { force: true }); } catch (_) {}
    log('Камеры: ffmpeg готов');
    return local;
  }
  async function cloudflaredPath() {
    if (env.CLOUDFLARED_PATH) return env.CLOUDFLARED_PATH;
    const local = join(TOOLS, WIN ? 'cloudflared.exe' : 'cloudflared');
    if (existsSync(local)) return local;
    const sys = which('cloudflared'); if (sys) return sys;
    if (!WIN) throw new Error('нет cloudflared');
    log('Камеры: скачиваю cloudflared (один раз)…');
    await download(CLOUDFLARED_EXE, local + '.part');
    copyFileSync(local + '.part', local); rmSync(local + '.part', { force: true });
    return local;
  }

  // ---------- коды из cameras.txt ----------
  let codes = [], codesRaw = null;
  function readCodes() {
    let txt;
    try { txt = readFileSync(codesFile, 'utf8'); } catch (_) { try { writeFileSync(codesFile, '﻿' + TEMPLATE.replace(/\n/g, '\r\n')); } catch (_) {} txt = TEMPLATE; }
    if (txt === codesRaw) return false;
    codesRaw = txt;
    const out = [];
    for (const line of txt.replace(/^﻿/, '').split(/\r?\n/)) {
      const m = /^\s*([^#=][^=]*?)\s*=\s*(\S+)\s*$/.exec(line);
      if (m) out.push({ name: m[1].trim(), code: m[2] });
    }
    codes = out;
    return true;
  }

  // ---------- поиск камер в сети студии ----------
  let scanAt = 0, hosts = [];
  async function scan() {
    if (Date.now() - scanAt < 5 * 60e3 && hosts.length) return hosts;
    scanAt = Date.now();
    const skip = new Set(String(env.STUDIO_SKIP_IPS || '').split(',').map(s => s.trim()).filter(Boolean));
    const given = String(env.CAMERA_IPS || '').split(',').map(s => s.trim()).filter(Boolean); // адреса из .env проверяем всегда
    let ips = [];
    try { ips.push(...[...execFileSync('arp', ['-a'], { encoding: 'utf8', timeout: 5000 }).matchAll(/(\d+\.\d+\.\d+\.\d+)/g)].map(m => m[1])); } catch (_) {}
    const nets = myNets();
    for (const n of nets) for (let i = 2; i < 255; i++) ips.push(n + '.' + i);
    ips = [...new Set([...given, ...ips.filter(ip => !skip.has(ip) && !/\.(0|1|255)$/.test(ip) && nets.some(n => ip.startsWith(n + '.')))])];
    const found = [];
    for (let i = 0; i < ips.length; i += 50) {
      const part = ips.slice(i, i + 50);
      const hits = await Promise.all(part.map(ip => tcpOpen(ip, 554, 800)));
      part.forEach((ip, k) => { if (hits[k]) found.push(ip); });
    }
    hosts = found;
    say('scan', 'Камеры: в сети студии видео отдают ' + (found.length ? found.join(', ') : 'ни одного устройства'));
    return found;
  }
  const rtsp = (ip, code, hd) => `rtsp://admin:${encodeURIComponent(code)}@${ip}:554/cam/realmonitor?channel=1&subtype=${hd ? 0 : 1}`;
  // пробуем взять один кадр: подходит ли код к этой камере
  function probe(ff, ip, code) {
    return new Promise(ok => {
      const c = run(ff, ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', rtsp(ip, code), '-frames:v', '1', '-f', 'null', '-']);
      let err = '';
      c.stderr.on('data', d => { err += d; });
      const t = setTimeout(() => { try { c.kill(); } catch (_) {} }, 15e3);
      c.once('exit', code => { clearTimeout(t); ok(code === 0 ? '' : (/401|Unauthorized/i.test(err) ? 'auth' : 'fail')); });
    });
  }

  // ---------- постоянная связь с камерой: ffmpeg → кадры JPEG в памяти ----------
  function startStream(ff, cam, hd) {
    const s = hd ? cam.hd : cam;
    const args = ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', rtsp(cam.ip, cam.code, hd), '-an',
      '-vf', `fps=${hd ? HD_FPS : FPS},scale='min(${hd ? 1920 : 960},iw)':-2`, '-q:v', hd ? '5' : '7', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'];
    const c = run(ff, args);
    s.proc = c; s.started = Date.now();
    let buf = Buffer.alloc(0), err = '';
    c.stdout.on('data', d => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      for (;;) {
        const st = buf.indexOf(Buffer.from([0xff, 0xd8]));
        if (st < 0) { buf = Buffer.alloc(0); break; }
        const en = buf.indexOf(Buffer.from([0xff, 0xd9]), st + 2);
        if (en < 0) { if (st > 0) buf = buf.subarray(st); break; }
        const jpg = Buffer.from(buf.subarray(st, en + 2));
        buf = buf.subarray(en + 2);
        s.frame = jpg; s.seq = (s.seq || 0) + 1; s.at = Date.now();
        if (!hd && !cam.w) { const sz = jpegSize(jpg); if (sz) { cam.w = sz[0]; cam.h = sz[1]; } }
        if (!hd) { cam.fails = 0; if (cam.problem) { cam.problem = ''; publish(); } }
        const w = s.waiters; s.waiters = [];
        for (const f of w || []) f();
      }
    });
    c.stderr.on('data', d => { err = (err + d).slice(-400); });
    c.once('exit', () => {
      if (s.proc !== c) return;
      s.proc = null;
      if (hd) return;
      cam.fails = (cam.fails || 0) + 1;
      cam.problem = /401|Unauthorized/i.test(err) ? 'код не подошёл' : 'нет связи с камерой';
      say('cam' + cam.id, 'Камеры: «' + cam.name + '» — ' + cam.problem + (err ? ' (' + err.trim().split('\n').pop() + ')' : ''));
      publish();
      if (cam.stopped) return;
      if (cam.fails >= 3) { delete cfg.ip[cam.name]; save(); cam.dead = true; return; } // адрес мог смениться — найдём заново
      setTimeout(() => { if (!cam.stopped && !cam.proc) startStream(ff, cam, false); }, Math.min(60e3, 5e3 * cam.fails));
    });
  }
  function jpegSize(b) { // ширина и высота из заголовка SOF
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
    return null;
  }
  // завис: кадров нет 20 секунд — перезапускаем
  setInterval(() => {
    for (const cam of cams.values()) {
      if (cam.proc && Date.now() - Math.max(cam.at || 0, cam.started || 0) > 20e3) { try { cam.proc.kill(); } catch (_) {} }
      if (cam.hd.proc && Date.now() - cam.hd.last > HD_IDLE) { const p = cam.hd.proc; cam.hd.proc = null; cam.hd.frame = null; try { p.kill(); } catch (_) {} }
    }
    publish();
  }, 10e3);

  // ---------- подбор: какой код к какой камере ----------
  let ff = '', busy = false;
  async function sync() {
    if (busy) return; busy = true;
    try {
      const changed = readCodes();
      const ready = codes.filter(c => c.code);
      if (!ready.length) {
        state.need = 'codes';
        for (const cam of cams.values()) stopCam(cam);
        cams.clear();
        await publish(); return;
      }
      state.need = '';
      if (!ff) ff = await ffmpegPath();
      // камеры, которых больше нет в файле или поменялся код
      for (const cam of [...cams.values()]) {
        const c = ready.find(x => x.name === cam.name);
        if (!c || c.code !== cam.code || cam.dead) { stopCam(cam); cams.delete(cam.id); }
      }
      const todo = ready.filter(c => ![...cams.values()].some(x => x.name === c.name));
      if (todo.length) {
        const all = await scan();
        const used = new Set([...cams.values()].map(x => x.ip));
        for (const c of todo) {
          let ip = cfg.ip[c.name] && all.includes(cfg.ip[c.name]) && !used.has(cfg.ip[c.name]) ? cfg.ip[c.name] : '';
          let why = '';
          if (!ip) {
            for (const h of all.filter(h => !used.has(h))) {
              const r = await probe(ff, h, c.code);
              if (!r) { ip = h; break; }
              if (r === 'auth') why = 'код не подошёл ни к одной камере';
            }
          }
          if (!ip) {
            const id = slug(c.name);
            cams.set(id, { id, name: c.name, code: c.code, ip: '', problem: why || (all.length ? 'камера с этим кодом не найдена' : 'камер в сети студии не нашёл'), hd: {}, stopped: true });
            say('miss' + c.name, 'Камеры: «' + c.name + '» — ' + (why || 'не нашёл в сети'));
            if (changed || !why) scanAt = 0;
            continue;
          }
          used.add(ip);
          if (cfg.ip[c.name] !== ip) { cfg.ip[c.name] = ip; save(); }
          const id = slug(c.name);
          const cam = { id, name: c.name, code: c.code, ip, problem: '', hd: { waiters: [] }, waiters: [] };
          cams.set(id, cam);
          log('Камеры: «' + c.name + '» → ' + ip + ', показываю в учёте');
          startStream(ff, cam, false);
        }
      }
      if ([...cams.values()].some(c => !c.stopped)) await ensureTunnel();
      await publish();
    } catch (e) {
      state.note = 'Камеры: ' + (e?.message || e);
      say('err', state.note);
      await publish();
    } finally { busy = false; }
  }
  function stopCam(cam) {
    cam.stopped = true;
    for (const p of [cam.proc, cam.hd?.proc]) if (p) try { p.kill(); } catch (_) {}
    cam.proc = null; if (cam.hd) cam.hd.proc = null;
  }
  // камеры без ответа (не найдены) пробуем снова раз в 5 минут
  setInterval(() => { for (const cam of [...cams.values()]) if (cam.stopped && !cam.proc) cams.delete(cam.id); }, 5 * 60e3);

  // ---------- веб-сервер кадров (только на этом компьютере) ----------
  const keyBuf = Buffer.from(cfg.key);
  const okKey = k => { const b = Buffer.from(String(k || '')); return b.length === keyBuf.length && crypto.timingSafeEqual(b, keyBuf); };
  createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Seq, X-At', 'Cache-Control': 'no-store' };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...H, 'Access-Control-Allow-Headers': '*' }); return res.end(); }
    if (u.pathname === '/ping') { res.writeHead(200, { ...H, 'Content-Type': 'text/plain' }); return res.end('ok'); }
    const m = /^\/cam\/(c[0-9a-f]{8})\.jpg$/.exec(u.pathname);
    if (!m || !okKey(u.searchParams.get('k'))) { res.writeHead(m ? 403 : 404, H); return res.end(); }
    const cam = cams.get(m[1]);
    if (!cam || cam.stopped) { res.writeHead(404, H); return res.end(); }
    const hd = u.searchParams.get('hd') === '1';
    let s = cam;
    if (hd) {
      cam.hd.last = Date.now();
      if (!cam.hd.proc) { cam.hd.waiters = cam.hd.waiters || []; startStream(ff, cam, true); }
      if (cam.hd.frame) s = cam.hd;
    }
    const after = String(u.searchParams.get('after') || '');
    const send = () => {
      const src = hd && cam.hd.frame ? cam.hd : cam;
      if (!src.frame) { res.writeHead(503, H); return res.end(); }
      res.writeHead(200, { ...H, 'Content-Type': 'image/jpeg', 'Content-Length': src.frame.length, 'X-Seq': (src === cam.hd ? 'h' : 's') + src.seq, 'X-At': String(src.at) });
      res.end(src.frame);
    };
    if (s.frame && after !== (s === cam.hd ? 'h' : 's') + s.seq) return send();
    // этот кадр учёт уже показал — ждём следующий (до 4 секунд)
    let done = false;
    const fire = () => { if (done) return; done = true; clearTimeout(t); send(); };
    const t = setTimeout(fire, WAIT_FRAME);
    (s.waiters = s.waiters || []).push(fire);
    if (hd && s === cam) (cam.hd.waiters = cam.hd.waiters || []).push(fire);
    req.on('close', () => { done = true; clearTimeout(t); });
  }).on('error', e => say('http', 'Камеры: веб-сервер кадров не запустился: ' + (e?.message || e)))
    .listen(HTTP_PORT, '127.0.0.1');

  // ---------- бесплатный туннель Cloudflare ----------
  let tun = null, tunFails = 0, tunStarting = false;
  async function ensureTunnel() {
    if (tun || tunStarting) return;
    tunStarting = true;
    try {
      const bin = await cloudflaredPath();
      const c = run(bin, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:' + HTTP_PORT]);
      tun = c;
      const onOut = d => {
        const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d));
        if (m && state.url !== m[0]) { state.url = m[0]; tunFails = 0; log('Камеры: учёт смотрит через ' + state.url); publish(true); }
      };
      c.stdout.on('data', onOut); c.stderr.on('data', onOut);
      c.once('exit', () => {
        if (tun !== c) return;
        tun = null; state.url = ''; publish(true);
        say('tun', 'Камеры: туннель закрылся, открываю снова через 15 секунд');
        setTimeout(() => { said.tun = ''; ensureTunnel(); }, 15e3);
      });
    } catch (e) {
      state.note = 'Камеры: не получилось запустить туннель: ' + (e?.message || e);
      say('tunerr', state.note);
    } finally { tunStarting = false; }
  }
  // проверяем туннель снаружи раз в 3 минуты; три промаха подряд — открываем новый
  setInterval(async () => {
    if (!tun || !state.url) return;
    let ok = false;
    try { ok = (await fetch(state.url + '/ping', { signal: AbortSignal.timeout(15e3) })).ok; } catch (_) {}
    if (ok) { tunFails = 0; return; }
    if (++tunFails >= 3) { tunFails = 0; log('Камеры: туннель не отвечает, открываю новый'); try { tun.kill(); } catch (_) {} }
  }, 3 * 60e3);

  sync();
  setInterval(sync, 30e3);
}
