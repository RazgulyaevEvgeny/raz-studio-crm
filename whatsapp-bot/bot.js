// WhatsApp-бот студии. Работает на рабочем компьютере и подключается к рабочему WhatsApp
// как связанное устройство (как WhatsApp Web): один раз сканируете QR-код с телефона.
//
// Что делает:
//   - отвечает клиентам ИИ-консультантом на бесплатном Google Gemini (логика в brain.js);
//   - отправляет клиентам уведомления о заказах: учёт кладёт задание в коллекцию wa_outbox, бот его забирает;
//   - если менеджер сам написал клиенту, бот молчит в этом чате 30 минут, а потом читает переписку и сам решает,
//     нужно ли отвечать (на «спасибо» и «хорошо» молчит, на новый вопрос отвечает: «менеджер сейчас занят заказом»); под каждым сообщением Ани подпись «💁‍♀️ Виртуальный помощник Аня»;
//   - если бот позвал менеджера, а тот не ответил за 10 минут, бот извиняется перед клиентом (один раз);
//   - готовит для учёта сводку «Менеджер Аня» (утром и по кнопке «Обновить») и отвечает на вопросы сотрудников (anna.js);
//   - присылает команде в Telegram уведомления: Аня зовёт менеджера, новый заказ Kaspi (notify.js);
//   - сообщения не отмечает прочитанными, чтобы менеджеры видели новые чаты в телефоне;
//   - фото клиента смотрит через Gemini, делает из логотипа визуализацию на футболке или худи (mockup.js), примеры работ присылает из учёта; после включения компьютера отвечает всем, кто ждал;
//   - копия базы каждую ночь, подсказки менеджеру «Кому можно написать» (сама Аня первой не пишет), цены конкурентов Kaspi (extras.js).
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
import { firestore, prepareNotice, markNoticeSent, runAgent, appendChat, normPhone, transcribe, describeImage, botToken, PAUSE_AFTER_MANAGER, isWorkTime, isClosed, hasQuestion, busyText, workStartedAt } from './brain.js';
import { startExtras } from './extras.js';
import { makeDigest, digestDue, answerQuestions, makeInsights, insightsDue } from './anna.js';
import { startNotify } from './notify.js';
import { rememberPhoto, warmUp } from './mockup.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(DIR, 'auth');          // вход в WhatsApp; если удалить папку — снова попросит QR
const PORT = 3777;
// В рабочее время даём менеджеру 7 минут ответить самому; вечером, в обед и в выходные Аня отвечает сразу,
// выждав 15 секунд, чтобы клиент успел дописать (отсчёт с последнего сообщения клиента)
// Днём (и в обед) Аня ждёт менеджера 7 минут; вечером, ночью и в выходные отвечает через 15 секунд
const replyDelay = () => (isClosed() ? 15e3 : 7 * 60e3);
const OFF_HOURS_PAUSE = 3 * 60e3;             // в нерабочее время после сообщения менеджера Аня ждёт только 3 минуты
const MAX_AGE = 3 * 24 * 3600e3;             // компьютер был выключен: после включения отвечаем всем, кто ждал до 3 дней (с извинением за ожидание)
const OUTBOX_EVERY = 15e3;                   // как часто проверять задания на уведомления
const OUTBOX_TTL = 7 * 24 * 3600e3;          // задания старше недели выбрасываем
const SEND_GAP = 3e3;                        // не чаще одного сообщения в 3 секунды
const MANAGER_WAIT = 10 * 60e3;              // если менеджер не ответил за 10 минут после вызова — извиняемся перед клиентом

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
    // notify — новые сообщения; append — то, что WhatsApp досылает после включения компьютера
    // (в том числе ответы менеджера с телефона). Досланное только записываем: ответит проверка раз в минуту
    if (type !== 'notify' && type !== 'append') return;
    for (const m of messages) {
      if (type === 'append' && Date.now() - (+m.messageTimestamp || 0) * 1000 > MAX_AGE) continue;
      m._late = type === 'append';
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
    const paused = Math.max(at + PAUSE_AFTER_MANAGER * 60e3, Date.now() - 1);
    await appendChat(fs, chatId, { role: 'manager', text, at, id: m.key.id || '' }, {
      phone, jid, needsManager: false, busyNoticeAt: 0, botPausedUntil: paused,
    });
    clearTimeout(pending.get(chatId));
    return;
  }

  const heard = (await voiceText(m)) || (await photoText(m, text));
  await appendChat(fs, chatId, { role: 'client', text: heard || text, at, id: m.key.id || '' }, {
    phone, jid, unread: true, ...(m.pushName ? { name: m.pushName } : {}),
  });
  if (!aiOn || m._late || Date.now() - at > MAX_AGE) return;
  log('Сообщение от клиента', phone || chatId, '— отвечу через', Math.round(replyDelay() / 1000), 'с');

  // Клиенты часто пишут несколькими сообщениями подряд: отвечаем, когда допишет
  clearTimeout(pending.get(chatId));
  pending.set(chatId, setTimeout(() => {
    pending.delete(chatId);
    answer(jid, chatId, phone).catch(e => log('ошибка ответа', e?.message || e));
  }, replyDelay()));
}

// Фото от клиента → описание для Ани (Gemini). Не получилось — '' и в чат попадёт просто «[клиент прислал фото]»
async function photoText(m, text) {
  let msg = m.message || {};
  for (const wrap of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']) if (msg[wrap]?.message) msg = msg[wrap].message;
  const img = msg.imageMessage;
  if (!img || !env.GEMINI_API_KEY || m.key.fromMe) return '';
  try {
    const buf = await downloadMediaMessage(m, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
    await rememberPhoto(who(m.key).chatId, buf); // из этого фото Аня сделает визуализацию макета
    const t = await describeImage(env, buf, img.mimetype, img.caption || '');
    return t ? `${text} На фото: ${t}` : '';
  } catch (e) {
    log('не удалось посмотреть фото', e?.message || e);
    return '';
  }
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
  if (skipped(chat)) { log('Аня не отвечает в чате', phone || chatId, '— уже решила раньше:', chat.botSkipReason || ''); return; } // Аня уже решила, что на эти сообщения отвечать не нужно
  if (!hasQuestion(chat.messages)) { log('Аня не отвечает в чате', phone || chatId, '— в сообщении клиента нет вопроса'); return; } // правило Евгения 20.10, днём и ночью
  // Менеджер недавно писал в этом чате: ждём конца паузы, и если клиенту так и не ответили — отвечаем сами
  // В нерабочее время Аня отвечает сразу; уступает только живому разговору менеджера (писал меньше 3 минут назад)
  let paused = (chat.botPausedUntil || 0) - Date.now();
  if (isClosed()) paused = Math.min(paused, (chat.botPausedUntil || 0) - PAUSE_AFTER_MANAGER * 60e3 + OFF_HOURS_PAUSE - Date.now());
  if (paused > 0 && paused <= PAUSE_AFTER_MANAGER * 60e3) {
    log('Аня ждёт: в чате', phone || chatId, 'недавно писал менеджер, отвечу через', Math.ceil(paused / 1000), 'с'); // длиннее — пауза осталась от старой версии бота (12 ч), не считаем
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
  let ok = true, id = '';
  try { id = await send(jid, reply.text, true); } catch (e) { ok = false; log('не отправлено', e?.message || e); }
  // Менеджера зовём один раз: повторный вызов, пока он не подключился, не сбрасывает 10-минутное ожидание
  const call = reply.handoff && !chat.needsManager;
  await appendChat(fs, chatId, { role: 'bot', text: ok ? reply.text : '[не отправлено] ' + reply.text, at: Date.now(), ...(id ? { id } : {}) },
    call ? { needsManager: true, managerReason: reply.handoff, managerCalledAt: Date.now(), busyNoticeAt: 0 } : {});
  if (ok && reply.media?.length) await sendExamples(jid, chatId, reply.media);
  if (ok && reply.mockup) try {
    const mid = await send(jid, { image: reply.mockup }, false);
    await appendChat(fs, chatId, { role: 'bot', text: '[Аня отправила визуализацию макета: ' + (chat.lastMockup?.what || '') + ']', at: Date.now(), ...(mid ? { id: mid } : {}) });
  } catch (e) { log('визуализация не отправлена', e?.message || e); }
  if (reply.reserve) extras?.reserveUsed(reply.reserve);
  if (call) {
    log('Нужен менеджер в чате', phone || chatId, '—', reply.handoff);
    notify?.managerNeeded({ name: chat.clientName || chat.name, phone }, reply.handoff).catch(() => {});
  }
}

// Отправка с паузой «печатает…», как у живого человека, и не чаще одного сообщения в SEND_GAP
let lastSend = 0;
// Подпись под каждым текстом Ани клиенту (правило Евгения 20.10: вместо того, чтобы Аня представлялась).
// В историю чата в учёте подпись не пишем — там видно, что это сообщение Ани
// В WhatsApp нельзя уменьшить шрифт: самое неброское — тонкая короткая черта и курсив
const SIGN = '\n\n┈┈┈┈┈┈\n💁‍♀️ _Виртуальный помощник Аня_';
async function send(jid, text, typing) {
  if (typeof text === 'string') text = text.trim() + SIGN;
  const wait = Math.max(0, lastSend + SEND_GAP - Date.now());
  lastSend = Date.now() + wait;
  if (wait) await sleep(wait);
  if (typing) {
    await sock.sendPresenceUpdate('composing', jid).catch(() => {});
    await sleep(Math.min(8e3, 1500 + text.length * 40));
    await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  }
  const res = await sock.sendMessage(jid, typeof text === 'string' ? { text } : text);
  if (res?.key?.id) {
    sentByBot.add(res.key.id);
    if (sentByBot.size > 2000) sentByBot.delete(sentByBot.values().next().value);
  }
  lastSend = Date.now();
  return res?.key?.id || '';
}

// Примеры работ из учёта (wa_anna/portfolio → картинки в коллекции blobs)
async function sendExamples(jid, chatId, ids) {
  let n = 0;
  for (const id of ids) {
    try {
      const b = await fs.get('blobs/' + id);
      const data = String(b?.data || '');
      if (!data.startsWith('data:image')) continue;
      const mid = await send(jid, { image: Buffer.from(data.split(',')[1], 'base64') }, false);
      await appendChat(fs, chatId, { role: 'bot', text: '[Аня отправила фото наших работ]', at: Date.now(), ...(mid ? { id: mid } : {}) });
      n++;
    } catch (e) { log('фото работы не отправлено', e?.message || e); }
  }
  if (n) log('Аня отправила примеры работ:', n);
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
      const age = Date.now() - (chat.lastAt || chat.updatedAt || 0);
      if (pending.has(chat.id) || answering.has(chat.id) || age < replyDelay() || age > MAX_AGE || skipped(chat) || !hasQuestion(chat.messages)) continue;
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
      // В нерабочее время Аня уже сказала, когда ответит Милана; извиняемся только в рабочие часы,
      // если менеджер не подключился за 10 минут (утром — считая от открытия студии)
      if (!isWorkTime() || chat.busyNoticeAt || !chat.managerCalledAt || Date.now() - Math.max(chat.managerCalledAt, workStartedAt()) < MANAGER_WAIT) continue;
      const jid = chat.jid || (chat.phone ? chat.phone + '@s.whatsapp.net' : '');
      if (!jid) continue;
      const text = busyText();
      const id = await send(jid, text, true);
      await appendChat(fs, chat.id, { role: 'bot', text, at: Date.now(), ...(id ? { id } : {}) }, { busyNoticeAt: Date.now() });
      log('Менеджер не ответил за 10 минут, клиенту', chat.phone || chat.id, 'отправлено извинение');
    }
  } catch (e) {
    log('ошибка проверки ожидающих чатов', e?.message || e);
  }
}

/* ---------- «Менеджер Аня» в учёте: сводка и вопросы ---------- */

let notify = null; // уведомления команде в Telegram (notify.js)
let extras = null; // копии базы, «Кому можно написать», проверка цен Kaspi (extras.js)
let annaBusy = false, annaErr = '';
async function checkAnna() {
  if (annaBusy || missing.length || !aiOn) return;
  annaBusy = true;
  try {
    const n = await answerQuestions(fs, env);
    if (n) log('Аня ответила на вопросы из учёта:', n);
    const why = await digestDue(fs);
    if (why) { await makeDigest(fs, env); log('Аня подготовила сводку для учёта (' + why + ')'); }
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
            const id = await send(wa.jid, n.text, false);
            await markNoticeSent(fs, job.orderId, n, id);
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
  warmUp();
  setInterval(processOutbox, OUTBOX_EVERY);
  setInterval(checkWaitingChats, 60e3);
  setInterval(checkAnna, 30e3);
  if (!missing.length) notify = startNotify(fs, env, () => botToken(env), log);
  if (!missing.length) extras = startExtras({ fs, env, log, notify, send, online: () => state.status === 'online' && !!sock, sock: () => sock, aiOn, DIR });
  // Обновили бота или настройки — перезапускаемся, start.bat поднимет новую версию через 10 секунд
  for (const f of ['brain.js', 'anna.js', 'notify.js', 'extras.js', 'mockup.js', 'bot.js', '.env']) {
    watchFile(join(DIR, f), { interval: 5000 }, (cur, prev) => {
      if (cur.mtimeMs !== prev.mtimeMs) { log('Файл ' + f + ' изменился, перезапускаюсь'); process.exit(0); }
    });
  }
});

// Аня уже решила промолчать на последние сообщения клиента (новое сообщение сдвигает updatedAt, и решение пересматривается)
// В нерабочее время решение «не отвечать» не действует: Аня обязана ответить
function skipped(chat) { return !isClosed() && (chat.botSkippedAt || 0) >= (chat.updatedAt || 0) && !!chat.botSkippedAt; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
