// WhatsApp-бот студии. Работает на рабочем компьютере и подключается к рабочему WhatsApp
// как связанное устройство (как WhatsApp Web): один раз сканируете QR-код с телефона.
//
// Что делает:
//   - отвечает клиентам ИИ-консультантом (логика в brain.js);
//   - отправляет клиентам уведомления о заказах: учёт кладёт задание в коллекцию wa_outbox, бот его забирает;
//   - если менеджер сам написал клиенту с телефона, бот молчит в этом чате 12 часов;
//   - сообщения не отмечает прочитанными, чтобы менеджеры видели новые чаты в телефоне.
// Состояние и QR-код: http://localhost:3777 на этом компьютере.
//
// Настройки — в файле .env рядом (образец: .env.example). Запуск: start.bat, автозапуск ставит install.bat.

import { createServer } from 'node:http';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, isJidGroup, isJidBroadcast, isLidUser, isPnUser } from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { firestore, prepareNotice, markNoticeSent, runAgent, appendChat, normPhone, PAUSE_AFTER_MANAGER } from './brain.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(DIR, 'auth');          // вход в WhatsApp; если удалить папку — снова попросит QR
const PORT = 3777;
const REPLY_DELAY = 8e3;                     // ждём, пока клиент допишет: отвечаем через 8 с после последнего сообщения
const MAX_AGE = 30 * 60e3;                   // на сообщения старше 30 минут (пришли, пока компьютер был выключен) не отвечаем сами
const OUTBOX_EVERY = 15e3;                   // как часто проверять задания на уведомления
const OUTBOX_TTL = 7 * 24 * 3600e3;          // задания старше недели выбрасываем
const SEND_GAP = 3e3;                        // не чаще одного сообщения в 3 секунды

const env = process.env;
const missing = ['FIREBASE_API_KEY', 'FIREBASE_PROJECT', 'BOT_EMAIL', 'BOT_PASSWORD'].filter(k => !String(env[k] || '').trim());
const fs = firestore(env);

const state = { status: 'starting', qr: '', since: Date.now(), note: missing.length ? 'В файле .env не заполнено: ' + missing.join(', ') : '' };
const log = (...a) => console.log(new Date().toLocaleString('ru-RU'), ...a);

let sock = null;
const sentByBot = new Set();   // id сообщений, которые отправил сам бот (чтобы не принять их за ответ менеджера)
const pending = new Map();     // чат → таймер ответа

/* ---------- подключение к WhatsApp ---------- */

async function connect() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({}));
  sock = makeWASocket({
    auth,
    version,
    logger: pino({ level: 'silent' }),
    browser: Browsers.windows('Desktop'),
    markOnlineOnConnect: false,  // чтобы телефон продолжал получать уведомления о сообщениях
    syncFullHistory: false,
  });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      state.status = 'qr';
      state.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      log('Нужно отсканировать QR-код: откройте http://localhost:' + PORT);
    }
    if (connection === 'open') {
      Object.assign(state, { status: 'online', qr: '', since: Date.now() });
      log('WhatsApp подключён');
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        // Устройство отвязали в телефоне: забываем вход и показываем новый QR
        Object.assign(state, { status: 'logged_out', qr: '', since: Date.now() });
        log('Бот отвязан от WhatsApp в телефоне. Нужен новый QR-код.');
        await rm(AUTH_DIR, { recursive: true, force: true });
      } else {
        Object.assign(state, { status: 'reconnecting', since: Date.now() });
        log('Связь с WhatsApp прервалась (код ' + (code || '?') + '), переподключаюсь');
      }
      setTimeout(() => connect().catch(e => log('ошибка подключения', e?.message || e)), code === DisconnectReason.loggedOut ? 1e3 : 5e3);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return; // история переписки при первом подключении нам не нужна
    for (const m of messages) onMessage(m).catch(e => log('ошибка обработки сообщения', e?.message || e));
  });
}

/* ---------- входящие и исходящие сообщения ---------- */

async function onMessage(m) {
  const jid = m.key?.remoteJid || '';
  if (!jid || isJidGroup(jid) || isJidBroadcast(jid) || jid.endsWith('@newsletter')) return; // группы, статусы и каналы — мимо
  const text = textOf(m.message);
  if (text === null) return; // реакции, удаления, служебные сообщения
  const { chatId, phone } = who(m.key);
  if (!chatId) return;
  const at = (+m.messageTimestamp || 0) * 1000 || Date.now();

  if (m.key.fromMe) {
    if (sentByBot.has(m.key.id)) return;
    // Менеджер написал клиенту сам (с телефона или компьютера): бот уступает чат
    await appendChat(fs, chatId, { role: 'manager', text, at }, {
      phone, needsManager: false, botPausedUntil: Date.now() + PAUSE_AFTER_MANAGER * 3600e3,
    });
    clearTimeout(pending.get(chatId));
    return;
  }

  await appendChat(fs, chatId, { role: 'client', text, at, id: m.key.id || '' }, {
    phone, unread: true, ...(m.pushName ? { name: m.pushName } : {}),
  });
  if (!String(env.ANTHROPIC_API_KEY || '').trim() || Date.now() - at > MAX_AGE) return;

  // Клиенты часто пишут несколькими сообщениями подряд: отвечаем, когда допишет
  clearTimeout(pending.get(chatId));
  pending.set(chatId, setTimeout(() => {
    pending.delete(chatId);
    answer(jid, chatId, phone).catch(e => log('ошибка ответа', e?.message || e));
  }, REPLY_DELAY));
}

async function answer(jid, chatId, phone) {
  const chat = await fs.get('wa_chats/' + chatId);
  if (!chat || chat.needsManager || (chat.botPausedUntil || 0) > Date.now()) return;
  if (chat.lastRole !== 'client') return; // пока ждали, ответил менеджер
  const reply = await runAgent(fs, env, phone, chat);
  if (!reply.text) return;
  let ok = true;
  try { await send(jid, reply.text, true); } catch (e) { ok = false; log('не отправлено', e?.message || e); }
  await appendChat(fs, chatId, { role: 'bot', text: ok ? reply.text : '[не отправлено] ' + reply.text, at: Date.now() },
    reply.handoff ? { needsManager: true, managerReason: reply.handoff, botPausedUntil: Date.now() + PAUSE_AFTER_MANAGER * 3600e3 } : {});
  if (reply.handoff) log('Нужен менеджер в чате', phone || chatId, '—', reply.handoff);
}

// Отправка с паузой «печатает…», как у живого человека, и не чаще одного сообщения в SEND_GAP
let lastSend = 0;
async function send(jid, text, typing) {
  const wait = Math.max(0, lastSend + SEND_GAP - Date.now());
  lastSend = Date.now() + wait;
  if (wait) await sleep(wait);
  if (typing) {
    await sock.sendPresenceUpdate('composing', jid).catch(() => {});
    await sleep(Math.min(8e3, 1500 + text.length * 40));
    await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  }
  const res = await sock.sendMessage(jid, { text });
  if (res?.key?.id) {
    sentByBot.add(res.key.id);
    if (sentByBot.size > 2000) sentByBot.delete(sentByBot.values().next().value);
  }
  lastSend = Date.now();
}

// Собеседник: номер телефона (если WhatsApp его показывает) и ключ чата в учёте
function who(key) {
  const ids = [key.remoteJid, key.remoteJidAlt, key.senderPn].filter(Boolean);
  const pn = ids.find(j => isPnUser(j) || j.endsWith('@s.whatsapp.net'));
  const digits = pn ? pn.split('@')[0].split(':')[0] : '';
  const phone = normPhone(digits) || digits;
  if (phone) return { chatId: phone, phone };
  const lid = ids.find(j => isLidUser(j));
  return lid ? { chatId: 'lid_' + lid.split('@')[0].split(':')[0], phone: '' } : {};
}

function textOf(message) {
  let m = message || {};
  for (const wrap of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage', 'editedMessage']) {
    if (m[wrap]?.message) m = m[wrap].message;
  }
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.buttonsResponseMessage) return m.buttonsResponseMessage.selectedDisplayText || '';
  if (m.listResponseMessage) return m.listResponseMessage.title || '';
  const kinds = {
    imageMessage: 'фото', videoMessage: 'видео', audioMessage: 'голосовое сообщение', documentMessage: 'файл',
    stickerMessage: 'стикер', locationMessage: 'геолокацию', liveLocationMessage: 'геолокацию', contactMessage: 'контакт', contactsArrayMessage: 'контакты',
  };
  const kind = Object.keys(kinds).find(k => m[k]);
  if (!kind) return null;
  const caption = m[kind].caption ? ': ' + m[kind].caption : '';
  return `[клиент прислал ${kinds[kind]}${caption}]`;
}

/* ---------- уведомления о заказах (задания от учёта в wa_outbox) ---------- */

let outboxBusy = false;
async function processOutbox() {
  if (outboxBusy || state.status !== 'online' || missing.length) return;
  outboxBusy = true;
  try {
    const jobs = (await fs.list('wa_outbox')).sort((a, b) => (a.at || 0) - (b.at || 0));
    for (const job of jobs) {
      if (!job.orderId || Date.now() - (job.at || 0) > OUTBOX_TTL) { await fs.remove('wa_outbox/' + job.id); continue; }
      const n = await prepareNotice(fs, job.orderId, job.event);
      if (n.text) {
        const [wa] = await sock.onWhatsApp(n.phone).catch(() => []);
        if (!wa?.exists) {
          log('Уведомление не отправлено: номера', n.phone, 'нет в WhatsApp');
        } else {
          try {
            await send(wa.jid, n.text, false);
            await markNoticeSent(fs, job.orderId, n);
            log('Уведомление клиенту', n.phone, '—', n.key);
          } catch (e) {
            log('Уведомление не ушло, попробую позже:', e?.message || e);
            continue; // задание остаётся до следующей проверки
          }
        }
      }
      await fs.remove('wa_outbox/' + job.id);
    }
  } catch (e) {
    log('ошибка проверки уведомлений', e?.message || e);
  } finally {
    outboxBusy = false;
  }
}

/* ---------- страница состояния: http://localhost:3777 ---------- */

const TITLES = {
  starting: 'Запускается…',
  qr: 'Отсканируйте QR-код',
  online: 'Работает',
  reconnecting: 'Переподключается к WhatsApp…',
  logged_out: 'Бот отвязан от WhatsApp, сейчас появится новый QR-код',
};
createServer((req, res) => {
  const body = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="5">
<title>WhatsApp-бот RAZ</title>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#222">
<h1 style="font-size:22px">WhatsApp-бот: ${TITLES[state.status] || state.status}</h1>
${state.note ? `<p style="color:#b00">${state.note}</p>` : ''}
${!env.ANTHROPIC_API_KEY ? '<p style="color:#b60">ИИ-ответы выключены: в .env нет ANTHROPIC_API_KEY. Уведомления о заказах работают.</p>' : ''}
${state.status === 'qr' ? `<img src="${state.qr}" alt="QR" style="width:320px;height:320px">
<ol><li>На телефоне с рабочим WhatsApp откройте <b>Настройки → Связанные устройства</b>.</li>
<li>Нажмите <b>Привязка устройства</b> и наведите камеру на этот код.</li></ol>` : ''}
${state.status === 'online' ? `<p>Подключён с ${new Date(state.since).toLocaleString('ru-RU')}. Эту страницу можно закрыть, бот работает в фоне.</p>` : ''}
</body>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}).on('error', e => {
  // Бот уже запущен (страница занята) — второй экземпляр не нужен. Код 3 = не перезапускать (см. start.bat)
  if (e.code === 'EADDRINUSE') { log('Бот уже работает, второй экземпляр закрывается'); process.exit(3); }
  throw e;
}).listen(PORT, '127.0.0.1', () => {
  log('Страница бота: http://localhost:' + PORT);
  if (missing.length) log(state.note);
  connect().catch(e => log('ошибка подключения', e?.message || e));
  setInterval(processOutbox, OUTBOX_EVERY);
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
