// Бот команды в Telegram (бесплатно). Уведомления:
//   - Аня позвала менеджера в WhatsApp;
//   - пришёл новый заказ Kaspi (бот сам раз в 5 минут спрашивает воркер kaspi-orders, учёт открывать не нужно);
//   - посылки из Китая (учёт → Kaspi → «Из Китая»): сменился этап, посылка задерживается, лежит в карго 2+ дня (раз в 5 минут, с 8 до 22);
//   - то, о чём попросили Аню: «оповести, когда принтер закончит печать / закроется заказ / выполнят задачу» (раз в минуту).
// Подписка: открыть своего бота в Telegram и отправить ему /start. Список подписчиков — wa_anna/telegram.
// Подписчики могут писать или наговаривать Ане вопросы и задачи (ответ готовит tgAssistant в anna.js).
// В .env: TELEGRAM_BOT_TOKEN (выдаёт @BotFather). Для Kaspi почта бота (BOT_EMAIL) должна быть в ALLOWED_EMAILS воркера.

import { tgAssistant, checkWatches, activeParcels, CN_ORD } from './anna.js';
import { transcribe } from './brain.js';

const KASPI_API = 'https://kaspi-orders.design-onegin.workers.dev';
// Как Аня обращается к сотрудникам в Telegram (по имени в Telegram)
const CALL = [[/мил/i, 'Милаша'], [/евген|женя/i, 'Евгений Кириллович']];
const callOf = c => (CALL.find(([re]) => re.test(c.name || '')) || [])[1] || (c.name || '').split(' ')[0] || 'коллега';
const KASPI_EVERY = 5 * 60e3;
const PARCELS_EVERY = 30 * 60e3; // посылки: раз в 30 минут, а сразу — когда L7 Cargo сменил этап (l7.js зовёт parcelsChanged)
const tg = (env, method, body) => fetch(`https://api.telegram.org/bot${String(env.TELEGRAM_BOT_TOKEN).trim()}/${method}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.json());

export function startNotify(fs, env, idToken, log) {
  const on = !!String(env.TELEGRAM_BOT_TOKEN || '').trim();
  let chats = null;
  // Номер чата храним в поле chat: поле id запись в базу отбрасывает (см. toFields в brain.js)
  const subscribers = async () => chats || (chats = ((await fs.get('wa_anna/telegram'))?.chats) || []);

  async function send(text) {
    if (!on) return;
    for (const c of (await subscribers()).filter(c => c.chat)) {
      const r = await tg(env, 'sendMessage', { chat_id: c.chat, text, disable_web_page_preview: true }).catch(e => ({ description: e?.message }));
      if (!r.ok) log('Telegram: не доставлено', c.name || c.chat, '—', r.description || '');
    }
  }

  // Сообщения боту: /start — подписка; от подписчиков текст или голосовое — вопрос или задача для Ани
  async function poll() {
    let offset = 0;
    for (;;) {
      try {
        const r = await tg(env, 'getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
        if (!r.ok) { log('Telegram:', r.description || 'ошибка'); await new Promise(f => setTimeout(f, 60e3)); continue; }
        for (const u of r.result) {
          offset = u.update_id + 1;
          const m = u.message;
          if (!m?.chat) continue;
          const list = await subscribers();
          const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || '';
          let me = list.find(c => c.chat === m.chat.id);
          // Подписались до исправления (номер чата не сохранился) — узнаём по имени и дописываем номер
          if (!me) { me = list.find(c => !c.chat && c.name === name); if (me) { me.chat = m.chat.id; await fs.patch('wa_anna/telegram', { chats: list }); log('Telegram: восстановлен чат', name); } }
          if (/^\/start/.test(m.text || '')) {
            if (!me) {
              list.push({ chat: m.chat.id, name, at: Date.now() });
              await fs.patch('wa_anna/telegram', { chats: list });
              log('Telegram: подписался', name);
            }
            await tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Готово! Сюда будут приходить уведомления студии: новые заказы Kaspi и когда Аня зовёт менеджера в WhatsApp. А ещё мне можно писать или наговаривать голосовые: «Аня, запиши задачу на завтра…», «Аня, что по Kaspi?»' });
            testOnce().catch(e => log('Telegram: тест не отправлен', e?.message || e));
            continue;
          }
          if (me && /^\/test/.test(m.text || '')) { const r = await tg(env, 'sendMessage', { chat_id: m.chat.id, text: TEST }); log('Telegram: /test', me.name, r.ok ? 'отправлено' : r.description || ''); continue; }
          if (me) { testOnce().catch(e => log('Telegram: тест не отправлен', e?.message || e)); ask(m, me).catch(e => log('Telegram: ошибка ответа', e?.message || e)); }
        }
      } catch (e) {
        await new Promise(f => setTimeout(f, 30e3));
      }
    }
  }

  async function ask(m, me) {
    let text = m.text || m.caption || '';
    const voice = m.voice || m.audio;
    if (voice) {
      tg(env, 'sendChatAction', { chat_id: m.chat.id, action: 'typing' }).catch(() => {});
      const f = await tg(env, 'getFile', { file_id: voice.file_id });
      const buf = f.ok ? Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${String(env.TELEGRAM_BOT_TOKEN).trim()}/${f.result.file_path}`)).arrayBuffer()) : null;
      text = buf ? await transcribe(env, buf, voice.mime_type || 'audio/ogg') : '';
      if (!text) return tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Не расслышала голосовое, повторите, пожалуйста, или напишите текстом.' });
    }
    if (!text.trim()) return;
    tg(env, 'sendChatAction', { chat_id: m.chat.id, action: 'typing' }).catch(() => {});
    const { reply, task, watch } = await tgAssistant(fs, env, text, callOf(me), m.chat.id);
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: ((voice ? `🎤 «${text.slice(0, 300)}»\n\n` : '') + reply).slice(0, 4000), disable_web_page_preview: true });
    log('Telegram: Аня ответила', me.name || me.chat, task ? '(записала задачу: ' + task.title + ')' : watch ? '(поставила оповещение: ' + watch.kind + ' ' + watch.ref + ')' : '');
  }

  // Один раз после обновления: тестовое уведомление всем подписчикам, чтобы проверить, что всё доходит
  const TEST = '🛒 Тестовое уведомление: новый заказ Kaspi № 000000\nОшейник для прогулки — упаковать и передать курьеру\n(это проверка, настоящего заказа нет)';
  async function testOnce() {
    const list = await subscribers();
    const fresh = list.filter(c => c.chat && !c.tested);
    for (const c of fresh) {
      const r = await tg(env, 'sendMessage', { chat_id: c.chat, text: TEST });
      log('Telegram: тестовое уведомление', c.name, r.ok ? 'отправлено' : 'не доставлено — ' + (r.description || ''));
      c.tested = Date.now();
    }
    if (fresh.length) await fs.patch('wa_anna/telegram', { chats: list });
  }

  let watchErr = '';
  async function watchTick() {
    try {
      for (const { w, text } of await checkWatches(fs)) {
        const me = (await subscribers()).find(c => c.chat === w.chat) || { name: w.who };
        const r = await tg(env, 'sendMessage', { chat_id: w.chat, text: `🔔 ${callOf(me)}, ${text}.` });
        log('Telegram: оповещение', me.name || w.chat, '—', text, r.ok ? '' : '(не доставлено: ' + (r.description || '') + ')');
      }
      watchErr = '';
    } catch (e) {
      const why = String(e?.message || e);
      if (why !== watchErr) log('ошибка проверки оповещений', why);
      watchErr = why;
    }
  }

  let kaspiErr = '', seenDoc = null;
  // Новые заказы Kaspi: сравниваем с уже виденными (wa_anna/kaspi_seen); при первом запуске просто запоминаем
  async function checkKaspi() {
    try {
      const r = await fetch(KASPI_API + '/?mode=active', { headers: { Authorization: 'Bearer ' + await idToken() } });
      if (!r.ok) {
        const why = r.status === 403 ? 'почты бота нет в ALLOWED_EMAILS воркера' : String(r.status);
        if (why !== kaspiErr) log('Kaspi для уведомлений недоступен:', why); // одна и та же причина — в журнал один раз
        kaspiErr = why;
        return;
      }
      kaspiErr = '';
      const { orders = [] } = await r.json();
      // список уже виденных заказов читаем из базы один раз, дальше держим в памяти
      const doc = seenDoc || (seenDoc = await fs.get('wa_anna/kaspi_seen'));
      const seen = new Set(doc?.ids || []);
      const fresh = orders.filter(o => !seen.has(o.id));
      if (doc) for (const o of fresh) {
        const items = (o.items || []).map(i => `${i.name}${i.qty > 1 ? ' × ' + i.qty : ''}`).join(', ');
        await send(`🛒 Новый заказ Kaspi № ${o.code}\n${items || 'состав уточняется'}\n${o.total != null ? o.total.toLocaleString('ru-RU') + ' ₸' : ''}${o.town ? ', ' + o.town : ''}`.trim());
        log('Уведомление о заказе Kaspi', o.code);
      }
      if (fresh.length || !doc) { seenDoc = { ids: [...seen, ...fresh.map(o => o.id)].slice(-500), at: Date.now() }; await fs.set('wa_anna/kaspi_seen', seenDoc); }
    } catch (e) {
      log('ошибка проверки Kaspi', e?.message || e);
    }
  }

  // Посылки из Китая: о смене этапа пишем один раз — что уже сообщили, помечаем в самой посылке (tgStage, tgLate, tgRemind)
  const CN_TXT = { sent: 'отправлена продавцом', left: 'покинула Китай', customs: 'прошла таможню', ready: 'готова к выдаче в карго' };
  const kzNow = () => new Date(Date.now() + 5 * 3600e3);
  const dm = iso => { const [, m, d] = String(iso).split('-').map(Number); return d + ' ' + ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][m - 1]; };
  const rub = n => Math.round(n).toLocaleString('ru-RU') + ' ₸';
  let cnErr = '';
  async function checkParcels() {
    const h = kzNow().getUTCHours();
    if (h < 8 || h >= 22) return; // ночью не будим, утром придёт всё накопившееся
    try {
      const today = kzNow().toISOString().slice(0, 10);
      for (const p of await activeParcels(fs)) {
        const st = CN_ORD.includes(p.stage) ? p.stage : 'ordered', i = CN_ORD.indexOf(st);
        const name = `«${p.title || 'посылка'}»${p.qty ? ', ' + p.qty + ' шт' : ''}`;
        const patch = {};
        const cargo = (+p.cargo || 0) + (+p.extra || 0);
        if (p.tgStage == null) patch.tgStage = st; // первую встречу просто запоминаем, иначе после обновления пришла бы пачка старых новостей
        else if (i > CN_ORD.indexOf(p.tgStage)) {
          patch.tgStage = st;
          if (CN_TXT[st]) {
            const tail = st === 'ready'
              ? (cargo ? `\nКарго ${rub(cargo)}${p.weight ? ' за ' + String(p.weight).replace('.', ',') + ' кг' : ''}` : '\nВес и сумму карго впишите в учёт, когда увидите в приложении')
              : p.eta ? `\nПридёт примерно ${dm(p.eta)}` : '';
            await send(`📦 Посылка ${name} ${CN_TXT[st]}${tail}${p.track ? '\nТрек ' + p.track : ''}`);
            log('Telegram: посылка', p.title, st);
          }
        }
        if (i < 4 && p.eta && p.eta < today && p.tgLate !== p.eta) {
          patch.tgLate = p.eta;
          await send(`⏳ Посылка ${name} задерживается: ждали примерно ${dm(p.eta)}, а она пока «${{ ordered: 'заказали', sent: 'отправлена', left: 'покинула Китай', customs: 'прошла таможню' }[st]}». Проверьте в приложении карго.`);
        }
        const rd = p.dates?.ready;
        if (st === 'ready' && rd && patch.tgStage !== 'ready' && (Date.parse(today) - Date.parse(rd)) / 864e5 >= 2 && !p.tgRemind) {
          patch.tgRemind = today;
          await send(`📦 Посылка ${name} уже ${Math.round((Date.parse(today) - Date.parse(rd)) / 864e5)} дн. ждёт в карго — заберите${cargo ? ', карго ' + rub(cargo) : ''}.`);
        }
        if (Object.keys(patch).length) await fs.patch('kaspi_orders/' + p.id, patch);
      }
      cnErr = '';
    } catch (e) {
      const why = String(e?.message || e);
      if (why !== cnErr) log('ошибка проверки посылок', why);
      cnErr = why;
    }
  }

  if (on) {
    poll();
    testOnce().catch(e => log('Telegram: тест не отправлен', e?.message || e));
    checkKaspi();
    setInterval(watchTick, 60e3);
    setInterval(checkKaspi, KASPI_EVERY);
    checkParcels();
    setInterval(checkParcels, PARCELS_EVERY);
  }
  return {
    alert: text => send(text),
    parcelsChanged: () => { if (on) setTimeout(checkParcels, 3000); },
    managerNeeded: (chat, reason) => send(`🔔 Нужен менеджер в WhatsApp\n${chat.name || 'Клиент'}${chat.phone ? ' +' + chat.phone : ''}: ${reason}${chat.phone ? '\nhttps://wa.me/' + chat.phone : ''}`),
  };
}
