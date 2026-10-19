// WhatsApp-бот студии. Работает на рабочем компьютере и подключается к рабочему WhatsApp
// как связанное устройство (как WhatsApp Web): один раз сканируете QR-код с телефона.
//
// Что делает:
//   - отвечает клиентам ИИ-консультантом на бесплатном Google Gemini (логика в brain.js);
//   - отправляет клиентам уведомления о заказах: учёт кладёт задание в коллекцию wa_outbox, бот его забирает;
//   - если менеджер сам написал клиенту, бот молчит в этом чате 30 минут, а потом читает переписку и сам решает,
//     нужно ли отвечать (на «спасибо» и «хорошо» молчит, на новый вопрос отвечает и представляется: «Милана сейчас занята заказом»);
//   - если бот позвал менеджера, а тот не ответил за 10 минут, бот извиняется перед клиентом (один раз);
//   - готовит для учёта сводку «Менеджер Анна» (утром и по кнопке «Обновить») и отвечает на вопросы сотрудников (anna.js);
//   - присылает команде в Telegram уведомления: Анна зовёт менеджера, новый заказ Kaspi (notify.js);
//   - сообщения не отмечает прочитанными, чтобы менеджеры видели новые чаты в телефоне.
// Состояние и QR-код: http://localhost:3777 на этом компьютере.
//
// Настройки — в файле .env рядом (образец: .env.example). Запуск: start.bat, автозапуск ставит install.bat.

import { createServer } from 'node:http';
import { rm } from 'node:fs/promises';
import { watchFile } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import makeWASocket, { downloadMediaMessage, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, isJidGroup, isJidBroadcast, isLidUser, isPnUser } from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { firestore, prepareNotice, markNoticeSent, runAgent, appendChat, normPhone, transcribe, botToken, PAUSE_AFTER_MANAGER } from './brain.js';
import { makeDigest, digestDue, answerQuestions, makeInsights, insightsDue } from './anna.js';
import { startNotify } from './notify.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(DIR, 'auth');          // вход в WhatsApp; если удалить папку — снова попросит QR
const PORT = 3777;
const REPLY_DELAY = 7 * 60e3;                // даём менеджеру 7 минут ответить самому; не ответил — Анна отвечает сама (отсчёт с последнего сообщения клиента)
const MAX_AGE = 30 * 60e3;                   // на сообщения старше 30 минут (пришли, пока компьютер был выключен) не отвечаем сами
const OUTBOX_EVERY = 15e3;                   // как часто проверять задания на уведомления
const OUTBOX_TTL = 7 * 24 * 3600e3;          // задания старше недели выбрасываем
const SEND_GAP = 3e3;                        // не чаще одного сообщения в 3 секунды
const MANAGER_WAIT = 10 * 60e3;              // если менеджер не ответил за 10 минут после вызова — извиняемся перед клиентом
const BUSY_TEXT = 'Извините, к сожалению, у менеджеров сейчас большая загрузка. Как только они освободятся, они вам ответят.';

const env = process.env;
const missing = ['FIREBASE_API_KEY', 'FIREBASE_PROJECT', 'BOT_EMAIL', 'BOT_PASSWORD'].filter(k => !String(env[k] || '').trim());
const fs = firestore(env);
const aiOn = !!String(env.GEMINI_API_KEY || env.ANTHROPIC_API_KEY || '').trim();

const state = { status: 'starting', qr: '', since: Date.now(), note: missing.length ? 'В файле .env не заполнено: ' + missing.join(', ') : '' };
const log = (...a) => console.log(new Date().toLocaleString('ru-RU'), ...a);

let sock = null;
const sentByBot = new Set();   // id сообщений, которые отправил сам бот (чтобы не принять их за ответ менеджера)
const pending = new Map();     // чат → таймер ответа
const answering = new Set();   // чаты, где Аня прямо сейчас думает и пишет ответ (чтобы не ответить дважды)
const inbox = new Map();       // чат → очередь входящих: сообщения одного чата (альбом из нескольких фото) обрабатываем по одному

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
    for (const m of messages) {
      // По одному на чат: иначе сообщения альбома одновременно перезаписывают переписку в учёте и часть теряется
      const key = m.key?.remoteJid || '';
      const next = (inbox.get(key) || Promise.resolve()).then(() => onMessage(m)).catch(e => log('ошибка обработки сообщения', e?.message || e));
      inbox.set(key, next);
      next.finally(() => { if (inbox.get(key) === next) inbox.delete(key); });
    }
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
      phone, jid, needsManager: false, busyNoticeAt: 0, botPausedUntil: Date.now() + PAUSE_AFTER_MANAGER * 60e3,
    });
    clearTimeout(pending.get(chatId));
    return;
  }

  const heard = await voiceText(m);
  await appendChat(fs, chatId, { role: 'client', text: heard || text, at, id: m.key.id || '' }, {
    phone, jid, unread: true, ...(m.pushName ? { name: m.pushName } : {}),
  });
  if (!aiOn || Date.now() - at > MAX_AGE) return;

  // Клиенты часто пишут несколькими сообщениями подряд: отвечаем, когда допишет
  clearTimeout(pending.get(chatId));
  pending.set(chatId, setTimeout(() => {
    pending.delete(chatId);
    answer(jid, chatId, phone).catch(e => log('ошибка ответа', e?.message || e));
  }, REPLY_DELAY));
}

// Голосовое от клиента → текст (Gemini). Не получилось — вернёт '' и в чат попадёт «[клиент прислал голосовое сообщение]»
async function voiceText(m) {
  let msg = m.message || {};
  if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
  const audio = msg.audioMessage;
  if (!audio || !env.GEMINI_API_KEY) return '';
  try {
    const buf = await downloadMediaMessage(m, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
    const t = await transcribe(env, buf, audio.mimetype);
    return t ? '[голосовое сообщение] ' + t : '';
  } catch (e) {
    log('не удалось расшифровать голосовое', e?.message || e);
    return '';
  }
}

async function answer(jid, chatId, phone) {
  // Пока Аня думает над ответом (ИИ отвечает несколько секунд, потом «печатает…»), ежеминутная проверка
  // видела, что последним писал клиент, и запускала второй такой же ответ. Теперь второй запуск просто пропускается.
  if (answering.has(chatId)) return;
  answering.add(chatId);
  try { await answerNow(jid, chatId, phone); } finally { answering.delete(chatId); }
}

async function answerNow(jid, chatId, phone) {
  const chat = await fs.get('wa_chats/' + chatId);
  if (!chat || chat.lastRole !== 'client') return; // пока ждали, ответил менеджер
  if (skipped(chat)) return; // Аня уже решила, что на эти сообщения отвечать не нужно
  // Менеджер недавно писал в этом чате: ждём конца паузы, и если клиенту так и не ответили — отвечаем сами
  const paused = (chat.botPausedUntil || 0) - Date.now();
  if (paused > 0 && paused <= PAUSE_AFTER_MANAGER * 60e3) { // длиннее — пауза осталась от старой версии бота (12 ч), не считаем
    clearTimeout(pending.get(chatId));
    pending.set(chatId, setTimeout(() => {
      pending.delete(chatId);
      answer(jid, chatId, phone).catch(e => log('ошибка ответа', e?.message || e));
    }, paused + 1000));
    return;
  }
  const reply = await runAgent(fs, env, phone, chat);
  if (reply.silent) {
    // Запоминаем решение до следующего сообщения клиента, чтобы проверка раз в минуту не спрашивала ИИ снова
    await fs.patch('wa_chats/' + chatId, { botSkippedAt: chat.updatedAt || Date.now(), botSkipReason: reply.silent.slice(0, 200) });
    log('Аня решила не отвечать в чате', phone || chatId, '—', reply.silent);
    return;
  }
  if (!reply.text) return;
  let ok = true;
  try { await send(jid, reply.text, true); } catch (e) { ok = false; log('не отправлено', e?.message || e); }
  // Менеджера зовём один раз: повторный вызов, пока он не подключился, не сбрасывает 10-минутное ожидание
  const call = reply.handoff && !chat.needsManager;
  await appendChat(fs, chatId, { role: 'bot', text: ok ? reply.text : '[не отправлено] ' + reply.text, at: Date.now() },
    call ? { needsManager: true, managerReason: reply.handoff, managerCalledAt: Date.now(), busyNoticeAt: 0 } : {});
  if (call) {
    log('Нужен менеджер в чате', phone || chatId, '—', reply.handoff);
    notify?.managerNeeded({ name: chat.clientName || chat.name, phone }, reply.handoff).catch(() => {});
  }
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

/* ---------- менеджер не ответил за 10 минут ---------- */

async function checkWaitingChats() {
  if (state.status !== 'online' || missing.length) return;
  // После перезапуска бота таймеры ответа теряются: подбираем чаты, где клиент ждёт дольше 7 минут, а ответа нет
  if (aiOn) try {
    const silent = await fs.query('wa_chats', {
      where: { fieldFilter: { field: { fieldPath: 'lastRole' }, op: 'EQUAL', value: { stringValue: 'client' } } },
    });
    for (const chat of silent) {
      const age = Date.now() - (chat.updatedAt || 0);
      if (pending.has(chat.id) || answering.has(chat.id) || age < REPLY_DELAY || age > MAX_AGE || skipped(chat)) continue;
      const jid = chat.jid || (chat.phone ? chat.phone + '@s.whatsapp.net' : '');
      if (!jid) continue;
      pending.set(chat.id, null); // отметка «уже отвечаем», чтобы следующая проверка не ответила второй раз
      await answer(jid, chat.id, chat.phone || '').finally(() => { if (pending.get(chat.id) === null) pending.delete(chat.id); });
    }
  } catch (e) {
    log('ошибка проверки неотвеченных чатов', e?.message || e);
  }
  try {
    const waiting = await fs.query('wa_chats', {
      where: { fieldFilter: { field: { fieldPath: 'needsManager' }, op: 'EQUAL', value: { booleanValue: true } } },
    });
    for (const chat of waiting) {
      if (chat.busyNoticeAt || !chat.managerCalledAt || Date.now() - chat.managerCalledAt < MANAGER_WAIT) continue;
      const jid = chat.jid || (chat.phone ? chat.phone + '@s.whatsapp.net' : '');
      if (!jid) continue;
      await send(jid, BUSY_TEXT, true);
      await appendChat(fs, chat.id, { role: 'bot', text: BUSY_TEXT, at: Date.now() }, { busyNoticeAt: Date.now() });
      log('Менеджер не ответил за 10 минут, клиенту', chat.phone || chat.id, 'отправлено извинение');
    }
  } catch (e) {
    log('ошибка проверки ожидающих чатов', e?.message || e);
  }
}

/* ---------- «Менеджер Анна» в учёте: сводка и вопросы ---------- */

let notify = null; // уведомления команде в Telegram (notify.js)
let annaBusy = false, annaErr = '';
async function checkAnna() {
  if (annaBusy || missing.length || !aiOn) return;
  annaBusy = true;
  try {
    const n = await answerQuestions(fs, env);
    if (n) log('Анна ответила на вопросы из учёта:', n);
    const why = await digestDue(fs);
    if (why) { await makeDigest(fs, env); log('Анна подготовила сводку для учёта (' + why + ')'); }
    const per = await insightsDue(fs);
    if (per) { await makeInsights(fs, env, per); log('Аня подготовила аналитику переписок за', per === 'month' ? 'месяц' : 'неделю'); }
    annaErr = '';
  } catch (e) {
    // Одна и та же ошибка (например, правила wa_anna ещё не опубликованы) — пишем в журнал один раз
    const msg = String(e?.message || e);
    if (msg !== annaErr) log('ошибка сводки Анны', msg);
    annaErr = msg;
  } finally {
    annaBusy = false;
  }
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
${!aiOn ? '<p style="color:#b60">ИИ-ответы выключены: в .env нет GEMINI_API_KEY.</p>' : ''}
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
  setInterval(checkWaitingChats, 60e3);
  setInterval(checkAnna, 30e3);
  if (!missing.length) notify = startNotify(fs, env, () => botToken(env), log);
  // Обновили бота или настройки — перезапускаемся, start.bat поднимет новую версию через 10 секунд
  for (const f of ['brain.js', 'anna.js', 'notify.js', 'bot.js', '.env']) {
    watchFile(join(DIR, f), { interval: 5000 }, (cur, prev) => {
      if (cur.mtimeMs !== prev.mtimeMs) { log('Файл ' + f + ' изменился, перезапускаюсь'); process.exit(0); }
    });
  }
});

// Аня уже решила промолчать на последние сообщения клиента (новое сообщение сдвигает updatedAt, и решение пересматривается)
function skipped(chat) { return (chat.botSkippedAt || 0) >= (chat.updatedAt || 0) && !!chat.botSkippedAt; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
