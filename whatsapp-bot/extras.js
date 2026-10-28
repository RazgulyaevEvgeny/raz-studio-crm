// Фоновые дела бота, которые не связаны с ответами в чате:
//   - каждую ночь сохраняет копию всей базы учёта в папку backup рядом с ботом (хранит 30 последних дней);
//   - «Кому можно написать»: если клиент спрашивал, замолчал на сутки и заказ не оформил, Аня НЕ пишет ему сама,
//     а оставляет подсказку менеджеру (wa_chats.lead), учёт показывает её в виджете Ани;
//   - просьба об отзыве в 2ГИС через 2 дня после «Выдан» — выключена (REVIEWS_ON): Аня первой клиентам не пишет;
//   - раз в 6 часов проверяет цены конкурентов на Kaspi и пишет в Telegram, если у кого-то дешевле (учёт открывать не нужно);
//   - сообщает в Telegram, если у Ани кончился бесплатный лимит Gemini и отвечает запасной ИИ.

import { mkdir, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { appendChat, normPhone, isWorkTime, botToken } from './brain.js';
import { leadHint } from './anna.js';

const DAY = 24 * 3600e3;
const kz = (t = Date.now()) => new Date(t + 5 * 3600e3);
const today = () => kz().toISOString().slice(0, 10);

const BACKUP_KEEP = 30;           // сколько дней хранить копии базы
const BACKUP_HOUR = 3;            // во сколько ночью (по Павлодару) сохранять копию
const BACKUP_COLS = ['orders', 'tasks', 'prices', 'projects', 'office', 'supplies', 'kaspi_orders', 'requests', 'marketing',
  'wa_chats', 'wa_anna', 'wa_anna_q', 'staff'];

// Правило Евгения (21.10): Аня не дожимает и сама первой клиентам не пишет. Вместо этого подсказывает менеджеру, кому можно написать.
const LEAD_MIN = 20 * 3600e3;     // подсказываем, если клиент молчит от 20 часов…
const LEAD_MAX = 7 * DAY;         // …до недели
const LEAD_PER_DAY = 15;          // не больше 15 разборов в день, чтобы не тратить бесплатный лимит Gemini

const REVIEWS_ON = false;         // просьба об отзыве — тоже сообщение первой, поэтому выключена

const REVIEW_AFTER = 2 * DAY;     // просим отзыв через 2 дня после выдачи
const REVIEW_LINK = 'https://2gis.kz/pavlodar/firm/70000001103891578/tab/reviews';
const REVIEW_TEXT = '{client}спасибо, что выбрали студию брендирования Разгуляев! Если вам всё понравилось, будем очень рады отзыву в 2ГИС, это займёт минуту:\n' + REVIEW_LINK;

const KASPI_API = 'https://kaspi-orders.design-onegin.workers.dev';
const PRICES_EVERY = 6 * 3600e3;

export function startExtras({ fs, env, log, notify, send, online, sock, aiOn, DIR }) {
  const alert = text => { if (notify?.alert) notify.alert(text).catch(() => {}); };

  /* ---------- копия базы ---------- */
  let backupDay = '', backupWarned = '';
  async function backup() {
    const d = kz();
    if (d.getUTCHours() < BACKUP_HOUR || backupDay === today()) return;
    const dir = join(DIR, 'backup'), file = join(dir, today() + '.json');
    // пустая копия (база не читалась — например, кончилась квота) не считается: пробуем снова через 10 минут
    const ok = await stat(file).then(s => s.size > 2000).catch(() => false);
    if (ok) { backupDay = today(); return; }
    backupDay = today();
    try {
      const out = { at: new Date().toISOString(), collections: {} };
      for (const c of BACKUP_COLS) out.collections[c] = Object.fromEntries((await fs.list(c)).map(({ id, ...x }) => [id, x]));
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify(out));
      const old = (await readdir(dir)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -BACKUP_KEEP);
      for (const f of old) await rm(join(dir, f)).catch(() => {});
      const n = Object.keys(out.collections.orders || {}).length;
      log('Копия базы сохранена:', file);
      alert(`💾 Копия базы за ${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, '0')} сохранена на рабочем компьютере: ${n} заказов. Хранятся последние ${BACKUP_KEEP} дней.`);
    } catch (e) {
      backupDay = ''; // не получилось — попробуем при следующей проверке
      log('копия базы не сохранилась', e?.message || e);
      if (backupWarned !== today()) { backupWarned = today(); alert('⚠️ Не получилось сохранить ночную копию базы, пробую снова каждые 10 минут: ' + String(e?.message || e).slice(0, 200)); }
    }
  }

  /* ---------- «Кому можно написать»: клиент спрашивал, замолчал и не заказал ---------- */
  // Клиенту ничего не отправляем: только записываем в чат подсказку lead {at, why, ask, text, lastAt}, менеджер решает сам
  let leadDay = '', leadN = 0, leadBusy = false;
  async function leads() {
    if (!aiOn || leadBusy || !isWorkTime()) return;
    if (leadDay !== today()) { leadDay = today(); leadN = 0; }
    if (leadN >= LEAD_PER_DAY) return;
    leadBusy = true;
    try {
      const chats = [];
      for (const role of ['bot', 'manager']) {
        chats.push(...await fs.query('wa_chats', {
          where: { fieldFilter: { field: { fieldPath: 'lastRole' }, op: 'EQUAL', value: { stringValue: role } } },
        }).catch(() => []));
      }
      // заказы за последний месяц: у кого заказ уже есть, тому писать не нужно
      const orders = await fs.query('orders', {
        where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(Date.now() - 30 * DAY) } } },
      }).catch(() => []);
      const ordered = new Set(orders.filter(o => !o.deletedAt && o.status !== 'cancel').map(o => normPhone(o.phone)).filter(Boolean));
      for (const chat of chats) {
        if (leadN >= LEAD_PER_DAY) break;
        const last = chat.lastAt || chat.updatedAt || 0, quiet = Date.now() - last;
        const clientMsgs = (chat.messages || []).filter(m => m.role === 'client').length;
        // разбираем один раз на разговор: заново — только если клиент потом снова писал
        if (quiet < LEAD_MIN || quiet > LEAD_MAX || (chat.leadAt || 0) >= last || chat.needsManager || !clientMsgs) continue;
        if (chat.phone && ordered.has(normPhone(chat.phone))) continue;
        await fs.patch('wa_chats/' + chat.id, { leadAt: Date.now() });
        leadN++;
        const hint = await leadHint(env, chat).catch(e => { log('Кому написать: ИИ не ответил', e?.message || e); return null; });
        if (!hint) continue;
        await fs.patch('wa_chats/' + chat.id, { leadOpen: true, lead: { ...hint, at: Date.now(), lastAt: last } });
        log('Кому можно написать: подсказка менеджеру', chat.phone || chat.id, '—', hint.why);
      }
    } catch (e) {
      log('ошибка подсказок «Кому написать»', e?.message || e);
    } finally { leadBusy = false; }
  }

  /* ---------- просьба об отзыве после выдачи заказа ---------- */
  let reviewBusy = false;
  async function reviews() {
    if (!REVIEWS_ON || reviewBusy || !online() || !isWorkTime()) return;
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
  setInterval(() => leads().catch(() => {}), 10 * 60e3);
  setInterval(() => reviews().catch(() => {}), 15 * 60e3);
  setInterval(() => kaspiPrices().catch(() => {}), 30 * 60e3);
  setTimeout(() => { backup().catch(() => {}); kaspiPrices().catch(() => {}); }, 60e3);
  return { reserveUsed };
}
