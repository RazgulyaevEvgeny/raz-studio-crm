// Бот команды в Telegram (бесплатно). Уведомления:
//   - Анна позвала менеджера в WhatsApp;
//   - пришёл новый заказ Kaspi (бот сам раз в 5 минут спрашивает воркер kaspi-orders, учёт открывать не нужно).
// Подписка: открыть своего бота в Telegram и отправить ему /start. Список подписчиков — wa_anna/telegram.
// Подписчики могут писать или наговаривать Ане вопросы и задачи (ответ готовит tgAssistant в anna.js).
// В .env: TELEGRAM_BOT_TOKEN (выдаёт @BotFather). Для Kaspi почта бота (BOT_EMAIL) должна быть в ALLOWED_EMAILS воркера.

import { tgAssistant } from './anna.js';
import { transcribe } from './brain.js';

const KASPI_API = 'https://kaspi-orders.design-onegin.workers.dev';
// Как Аня обращается к сотрудникам в Telegram (по имени в Telegram)
const CALL = [[/мил/i, 'Милаша'], [/евген|женя/i, 'Евгений Кириллович']];
const callOf = c => (CALL.find(([re]) => re.test(c.name || '')) || [])[1] || (c.name || '').split(' ')[0] || 'коллега';
const KASPI_EVERY = 5 * 60e3;
const tg = (env, method, body) => fetch(`https://api.telegram.org/bot${String(env.TELEGRAM_BOT_TOKEN).trim()}/${method}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then(r => r.json());

export function startNotify(fs, env, idToken, log) {
  const on = !!String(env.TELEGRAM_BOT_TOKEN || '').trim();
  let chats = null;
  const subscribers = async () => chats || (chats = ((await fs.get('wa_anna/telegram'))?.chats) || []);

  async function send(text) {
    if (!on) return;
    for (const c of await subscribers()) {
      const r = await tg(env, 'sendMessage', { chat_id: c.id, text, disable_web_page_preview: true }).catch(e => ({ description: e?.message }));
      if (!r.ok) log('Telegram: не доставлено', c.name || c.id, '—', r.description || '');
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
          if (/^\/start/.test(m.text || '')) {
            const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || '';
            if (!list.some(c => c.id === m.chat.id)) {
              list.push({ id: m.chat.id, name, at: Date.now() });
              await fs.set('wa_anna/telegram', { chats: list });
              log('Telegram: подписался', name);
            }
            await tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Готово! Сюда будут приходить уведомления студии: новые заказы Kaspi и когда Аня зовёт менеджера в WhatsApp. А ещё мне можно писать или наговаривать голосовые: «Аня, запиши задачу на завтра…», «Аня, что по Kaspi?»' });
            continue;
          }
          const me = list.find(c => c.id === m.chat.id);
          if (me) ask(m, me).catch(e => log('Telegram: ошибка ответа', e?.message || e));
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
    const { reply, task } = await tgAssistant(fs, env, text, callOf(me));
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: (voice ? `🎤 «${text.slice(0, 300)}»\n\n` : '') + reply, disable_web_page_preview: true });
    log('Telegram: Аня ответила', me.name || me.id, task ? '(записала задачу: ' + task.title + ')' : '');
  }

  // Один раз после обновления: тестовое уведомление всем подписчикам, чтобы проверить, что всё доходит
  async function testOnce() {
    const doc = await fs.get('wa_anna/telegram');
    if (!doc?.chats?.length || doc.testSent) return;
    await send('🛒 Тестовое уведомление: новый заказ Kaspi № 000000\nОшейник для прогулки — упаковать и передать курьеру\n(это проверка, настоящего заказа нет)');
    await fs.set('wa_anna/telegram', { ...doc, testSent: Date.now() });
    log('Telegram: отправлено тестовое уведомление');
  }

  let kaspiErr = '';
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
      const doc = await fs.get('wa_anna/kaspi_seen');
      const seen = new Set(doc?.ids || []);
      const fresh = orders.filter(o => !seen.has(o.id));
      if (doc) for (const o of fresh) {
        const items = (o.items || []).map(i => `${i.name}${i.qty > 1 ? ' × ' + i.qty : ''}`).join(', ');
        await send(`🛒 Новый заказ Kaspi № ${o.code}\n${items || 'состав уточняется'}\n${o.total != null ? o.total.toLocaleString('ru-RU') + ' ₸' : ''}${o.town ? ', ' + o.town : ''}`.trim());
        log('Уведомление о заказе Kaspi', o.code);
      }
      if (fresh.length || !doc) await fs.set('wa_anna/kaspi_seen', { ids: [...seen, ...fresh.map(o => o.id)].slice(-500), at: Date.now() });
    } catch (e) {
      log('ошибка проверки Kaspi', e?.message || e);
    }
  }

  if (on) {
    poll();
    testOnce().catch(e => log('Telegram: тест не отправлен', e?.message || e));
    checkKaspi();
    setInterval(checkKaspi, KASPI_EVERY);
  }
  return {
    managerNeeded: (chat, reason) => send(`🔔 Нужен менеджер в WhatsApp\n${chat.name || 'Клиент'}${chat.phone ? ' +' + chat.phone : ''}: ${reason}${chat.phone ? '\nhttps://wa.me/' + chat.phone : ''}`),
  };
}
