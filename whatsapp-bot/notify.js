// Уведомления команде на телефон через бесплатного бота в Telegram:
//   - Анна позвала менеджера в WhatsApp;
//   - пришёл новый заказ Kaspi (бот сам раз в 5 минут спрашивает воркер kaspi-orders, учёт открывать не нужно).
// Подписка: открыть своего бота в Telegram и отправить ему /start. Список подписчиков — wa_anna/telegram.
// В .env: TELEGRAM_BOT_TOKEN (выдаёт @BotFather). Для Kaspi почта бота (BOT_EMAIL) должна быть в ALLOWED_EMAILS воркера.

const KASPI_API = 'https://kaspi-orders.design-onegin.workers.dev';
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

  // Новые подписчики: кто написал боту /start
  async function poll() {
    let offset = 0;
    for (;;) {
      try {
        const r = await tg(env, 'getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
        if (!r.ok) { log('Telegram:', r.description || 'ошибка'); await new Promise(f => setTimeout(f, 60e3)); continue; }
        for (const u of r.result) {
          offset = u.update_id + 1;
          const m = u.message;
          if (!m?.chat || !/^\/start/.test(m.text || '')) continue;
          const list = await subscribers();
          const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || '';
          if (!list.some(c => c.id === m.chat.id)) {
            list.push({ id: m.chat.id, name, at: Date.now() });
            await fs.set('wa_anna/telegram', { chats: list });
            log('Telegram: подписался', name);
          }
          await tg(env, 'sendMessage', { chat_id: m.chat.id, text: 'Готово! Сюда будут приходить уведомления студии: новые заказы Kaspi и когда Анна зовёт менеджера в WhatsApp.' });
        }
      } catch (e) {
        await new Promise(f => setTimeout(f, 30e3));
      }
    }
  }

  // Новые заказы Kaspi: сравниваем с уже виденными (wa_anna/kaspi_seen); при первом запуске просто запоминаем
  async function checkKaspi() {
    try {
      const r = await fetch(KASPI_API + '/?mode=active', { headers: { Authorization: 'Bearer ' + await idToken() } });
      if (!r.ok) { log('Kaspi для уведомлений недоступен:', r.status === 403 ? 'почты бота нет в ALLOWED_EMAILS воркера' : r.status); return; }
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
    checkKaspi();
    setInterval(checkKaspi, KASPI_EVERY);
  }
  return {
    managerNeeded: (chat, reason) => send(`🔔 Нужен менеджер в WhatsApp\n${chat.name || 'Клиент'}${chat.phone ? ' +' + chat.phone : ''}: ${reason}${chat.phone ? '\nhttps://wa.me/' + chat.phone : ''}`),
  };
}
