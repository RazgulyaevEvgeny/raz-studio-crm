// Фоновые дела бота, которые не связаны с ответами в чате:
//   - каждую ночь сохраняет копию всей базы учёта в папку backup рядом с ботом (хранит 30 последних дней);
//   - дожим: если клиент обсуждал заказ и замолчал на сутки, Аня один раз мягко напоминает о себе (только в рабочее время);
//   - через 2 дня после статуса «Выдан» просит оставить отзыв в 2ГИС (один раз на заказ, только в рабочее время);
//   - раз в 6 часов проверяет цены конкурентов на Kaspi и пишет в Telegram, если у кого-то дешевле (учёт открывать не нужно);
//   - сообщает в Telegram, если у Ани кончился бесплатный лимит Gemini и отвечает запасной ИИ.

import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runAgent, appendChat, normPhone, isWorkTime, botToken } from './brain.js';

const DAY = 24 * 3600e3;
const kz = (t = Date.now()) => new Date(t + 5 * 3600e3);
const today = () => kz().toISOString().slice(0, 10);

const BACKUP_KEEP = 30;           // сколько дней хранить копии базы
const BACKUP_HOUR = 3;            // во сколько ночью (по Павлодару) сохранять копию
const BACKUP_COLS = ['orders', 'tasks', 'prices', 'projects', 'office', 'supplies', 'kaspi_orders', 'requests', 'marketing',
  'wa_chats', 'wa_anna', 'wa_anna_q', 'staff'];

const FOLLOW_MIN = 20 * 3600e3;   // напоминаем, если клиент молчит от 20 часов…
const FOLLOW_MAX = 72 * 3600e3;   // …до 3 суток
const FOLLOW_PER_DAY = 10;        // не больше 10 напоминаний в день: WhatsApp не любит массовые сообщения

const REVIEW_AFTER = 2 * DAY;     // просим отзыв через 2 дня после выдачи
const REVIEW_LINK = 'https://2gis.kz/pavlodar/firm/70000001103891578/tab/reviews';
const REVIEW_TEXT = '{client}спасибо, что выбрали студию брендирования Разгуляев! Если вам всё понравилось, будем очень рады отзыву в 2ГИС, это займёт минуту:\n' + REVIEW_LINK;

const KASPI_API = 'https://kaspi-orders.design-onegin.workers.dev';
const PRICES_EVERY = 6 * 3600e3;

export function startExtras({ fs, env, log, notify, send, online, sock, aiOn, DIR }) {
  const alert = text => { if (notify?.alert) notify.alert(text).catch(() => {}); };

  /* ---------- копия базы ---------- */
  let backupDay = '';
  async function backup() {
    const d = kz();
    if (d.getUTCHours() < BACKUP_HOUR || backupDay === today()) return;
    const dir = join(DIR, 'backup'), file = join(dir, today() + '.json');
    const files = await readdir(dir).catch(() => []);
    if (files.includes(today() + '.json')) { backupDay = today(); return; }
    backupDay = today();
    try {
      const out = { at: new Date().toISOString(), collections: {} };
      for (const c of BACKUP_COLS) out.collections[c] = Object.fromEntries((await fs.list(c).catch(() => [])).map(({ id, ...x }) => [id, x]));
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify(out));
      const old = (await readdir(dir)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -BACKUP_KEEP);
      for (const f of old) await rm(join(dir, f)).catch(() => {});
      const n = Object.keys(out.collections.orders || {}).length;
      log('Копия базы сохранена:', file);
      alert(`💾 Копия базы за ${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, '0')} сохранена на рабочем компьютере: ${n} заказов. Хранятся последние ${BACKUP_KEEP} дней.`);
    } catch (e) {
      log('копия базы не сохранилась', e?.message || e);
      alert('⚠️ Не получилось сохранить ночную копию базы: ' + String(e?.message || e).slice(0, 200));
    }
  }

  /* ---------- дожим: клиент замолчал после разговора ---------- */
  let followDay = '', followN = 0, followBusy = false;
  async function followUps() {
    if (!aiOn || followBusy || !online() || !isWorkTime()) return;
    if (followDay !== today()) { followDay = today(); followN = 0; }
    if (followN >= FOLLOW_PER_DAY) return;
    followBusy = true;
    try {
      const chats = [];
      for (const role of ['bot', 'manager']) {
        chats.push(...await fs.query('wa_chats', {
          where: { fieldFilter: { field: { fieldPath: 'lastRole' }, op: 'EQUAL', value: { stringValue: role } } },
        }).catch(() => []));
      }
      for (const chat of chats) {
        if (followN >= FOLLOW_PER_DAY) break;
        const quiet = Date.now() - (chat.lastAt || chat.updatedAt || 0);
        const clientMsgs = (chat.messages || []).filter(m => m.role === 'client').length;
        if (quiet < FOLLOW_MIN || quiet > FOLLOW_MAX || chat.followUpAt || chat.needsManager || clientMsgs < 2) continue;
        const jid = chat.jid || (chat.phone ? chat.phone + '@s.whatsapp.net' : '');
        if (!jid) continue;
        await fs.patch('wa_chats/' + chat.id, { followUpAt: Date.now() }); // решаем один раз на разговор
        const r = await runAgent(fs, env, chat.phone || '', chat, { followUp: true });
        if (!r.text) { log('Дожим: Аня решила не напоминать', chat.phone || chat.id, r.silent ? '— ' + r.silent : ''); continue; }
        const id = await send(jid, r.text, true);
        await appendChat(fs, chat.id, { role: 'bot', text: r.text, at: Date.now(), ...(id ? { id } : {}) });
        followN++;
        log('Дожим: Аня напомнила о себе', chat.phone || chat.id);
      }
    } catch (e) {
      log('ошибка дожима', e?.message || e);
    } finally { followBusy = false; }
  }

  /* ---------- просьба об отзыве после выдачи заказа ---------- */
  let reviewBusy = false;
  async function reviews() {
    if (reviewBusy || !online() || !isWorkTime()) return;
    reviewBusy = true;
    try {
      // Только заказы, выданные после включения этой функции (у них есть время статуса statusAt.done)
      const list = await fs.query('orders', {
        where: { fieldFilter: { field: { fieldPath: 'statusAt.done' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(Date.now() - 10 * DAY) } } },
      }).catch(() => []);
      for (const o of list) {
        const sent = o.waSent && typeof o.waSent === 'object' ? o.waSent : {};
        const phone = normPhone(o.phone);
        if (o.status !== 'done' || o.deletedAt || sent.review || !phone || o.service === 'kaspi' || (o.kaspi || []).length) continue;
        if (Date.now() - (o.statusAt?.done || 0) < REVIEW_AFTER) continue;
        await fs.patch('orders/' + o.id, { waSent: { ...sent, review: Date.now() } }); // один раз, даже если не дошло
        const [wa] = await sock().onWhatsApp(phone).catch(() => []);
        if (!wa?.exists) continue;
        const chat = await fs.get('wa_chats/' + phone).catch(() => null);
        const name = String(chat?.clientName || o.client || '').trim();
        const text = REVIEW_TEXT.replace('{client}', name && !/^тоо|^ип\b/i.test(name) ? name + ', ' : '').replace(/^./, c => c.toUpperCase());
        const id = await send(wa.jid, text, true);
        await appendChat(fs, phone, { role: 'notice', text, at: Date.now(), ...(id ? { id } : {}) });
        log('Просьба об отзыве отправлена', phone, 'заказ', o.num);
      }
    } catch (e) {
      log('ошибка просьбы об отзыве', e?.message || e);
    } finally { reviewBusy = false; }
  }

  /* ---------- цены конкурентов на Kaspi ---------- */
  let pricesBusy = false;
  const shopKey = s => String(s || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '');
  async function kaspiPrices() {
    if (pricesBusy) return;
    pricesBusy = true;
    try {
      const meta = (await fs.get('kaspi_orders/_meta')) || {};
      if (Date.now() - (+meta.pricesAt || 0) < PRICES_EVERY) return;
      const products = (await fs.query('kaspi_orders', {
        where: { fieldFilter: { field: { fieldPath: 'kind' }, op: 'EQUAL', value: { stringValue: 'product' } } },
      }).catch(() => [])).filter(p => p.code && p.available !== false);
      if (!products.length) return;
      const shop = shopKey(meta.shopName), city = meta.cityId || '551010000';
      const cheaper = [];
      for (let i = 0; i < products.length; i += 25) {
        const part = products.slice(i, i + 25);
        const r = await fetch(`${KASPI_API}/?mode=offers&ids=${part.map(p => p.code).join(',')}&city=${city}`, { headers: { Authorization: 'Bearer ' + await botToken(env) } });
        if (!r.ok) throw new Error(r.status === 403 ? 'почты бота нет в ALLOWED_EMAILS воркера kaspi-orders' : 'воркер ответил ' + r.status);
        const d = await r.json();
        if (!d?.offers) throw new Error('обновите код воркера kaspi-orders');
        for (const p of part) {
          const res = d.offers[p.code];
          if (!res || res.error) continue;
          const all = (res.offers || []).filter(o => o.price != null).sort((a, b) => a.price - b.price);
          const mine = shop ? all.filter(o => shopKey(o.merchantName) === shop) : [];
          const other = shop ? all.filter(o => shopKey(o.merchantName) !== shop) : all;
          const offers = {
            at: Date.now(), n: all.length, min: all[0]?.price ?? null, minName: all[0]?.merchantName || '',
            minOther: other[0]?.price ?? null, minOtherName: other[0]?.merchantName || '', ours: mine[0]?.price ?? null,
            top: all.slice(0, 5).map(o => ({ n: o.merchantName, p: o.price })), err: '',
            alerted: p.offers?.alerted ?? null,
          };
          const ours = offers.ours || +p.price || 0;
          if (offers.minOther && ours && offers.minOther < ours) {
            if (offers.alerted !== offers.minOther) cheaper.push(`• ${p.name}: у «${offers.minOtherName}» ${fmt(offers.minOther)}, у нас ${fmt(ours)} (на ${fmt(ours - offers.minOther)} дороже)`);
            offers.alerted = offers.minOther;
          } else offers.alerted = null;
          await fs.patch('kaspi_orders/' + p.id, { offers });
        }
      }
      await fs.patch('kaspi_orders/_meta', { pricesAt: Date.now() });
      if (cheaper.length) alert('🏷 Kaspi: у конкурентов дешевле\n' + cheaper.slice(0, 15).join('\n'));
      log('Цены конкурентов Kaspi проверены, дешевле:', cheaper.length);
    } catch (e) {
      log('ошибка проверки цен Kaspi', e?.message || e);
    } finally { pricesBusy = false; }
  }
  const fmt = n => Math.round(n).toLocaleString('ru-RU') + ' ₸';

  /* ---------- запасной ИИ ---------- */
  let reserveDay = '';
  function reserveUsed(why) {
    if (reserveDay === today()) return;
    reserveDay = today();
    log('Gemini недоступен, отвечает запасной ИИ:', why);
    alert('⚠️ У Ани закончился бесплатный лимит Gemini на сегодня. Пока она отвечает через запасной ИИ: проще и без оформления заказов. Завтра лимит восстановится сам.');
  }

  setInterval(() => backup().catch(() => {}), 10 * 60e3);
  setInterval(() => followUps().catch(() => {}), 10 * 60e3);
  setInterval(() => reviews().catch(() => {}), 15 * 60e3);
  setInterval(() => kaspiPrices().catch(() => {}), 30 * 60e3);
  setTimeout(() => { backup().catch(() => {}); kaspiPrices().catch(() => {}); }, 60e3);
  return { reserveUsed };
}
