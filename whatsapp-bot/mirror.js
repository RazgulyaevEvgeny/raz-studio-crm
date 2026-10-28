// Переписка WhatsApp живёт в отдельном проекте raz-anna (см. brain.js). Учёт туда не ходит, поэтому бот сам кладёт
// в Realtime Database два коротких списка для виджета Ани:
//   sig/anna/waiting/<ключ> — кто ждёт менеджера {id, clientName, name, phone, managerReason, managerCalledAt, updatedAt, lastAt}
//   sig/anna/leads/<ключ>   — «Кому можно написать» {id, clientName, name, phone, lastAt, lead}
// Кнопки учёта «Снять» и «Убрать» пишут sig/anna/chatDone/<ключ> {id, kind:'manager'|'lead', at, by},
// бот отмечает это в чате и стирает заявку.
// Здесь же разовый перенос старых чатов и архива переписки из основного проекта в raz-anna (метка sig/chatsMovedAt).

const keyOf = id => String(id).replace(/[.#$[\]/]/g, '_');
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] != null && o[k] !== '').map(k => [k, o[k]]));
const W_KEYS = ['id', 'clientName', 'name', 'phone', 'managerReason', 'managerCalledAt', 'updatedAt', 'lastAt'];
const L_KEYS = ['id', 'clientName', 'name', 'phone', 'lastAt', 'lead'];
const EQ = (field, v) => ({ where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { booleanValue: v } } } });

export function startChatMirror({ fs, log }) {
  const rt = fs.rt;
  let busy = false, again = false, timer = null, lastErr = '';

  async function refresh() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const [wait, leads] = await Promise.all([fs.query('wa_chats', EQ('needsManager', true)), fs.query('wa_chats', EQ('leadOpen', true))]);
      const w = Object.fromEntries(wait.map(c => [keyOf(c.id), pick(c, W_KEYS)]));
      const l = Object.fromEntries(leads.map(c => [keyOf(c.id), pick(c, L_KEYS)]));
      // пишем, только если список правда изменился: Realtime Database бесплатна, но лишний трафик ни к чему
      if (JSON.stringify(rt.get('sig/anna/waiting') || {}) !== JSON.stringify(w)) await rt.set('sig/anna/waiting', w);
      if (JSON.stringify(rt.get('sig/anna/leads') || {}) !== JSON.stringify(l)) await rt.set('sig/anna/leads', l);
      lastErr = '';
    } catch (e) {
      const why = String(e?.message || e);
      if (why !== lastErr) log('списки Ани для учёта не обновились:', why);
      lastErr = why;
    } finally {
      busy = false;
      if (again) { again = false; soon(); }
    }
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 4000); };

  // Нажали «Снять» / «Убрать» в учёте
  async function applyDone() {
    const all = rt.get('sig/anna/chatDone') || {};
    for (const [k, d] of Object.entries(all)) {
      try {
        if (d && d.id) {
          if (d.kind === 'lead') await fs.patch('wa_chats/' + d.id, { leadOpen: false, leadDoneAt: d.at || Date.now(), leadDoneBy: d.by || '' });
          else await fs.patch('wa_chats/' + d.id, { needsManager: false, managerDoneAt: d.at || Date.now(), managerDoneBy: d.by || '' });
        }
        await rt.remove('sig/anna/chatDone/' + k);
      } catch (e) { log('не получилось отметить чат из учёта:', e?.message || e); }
    }
    soon();
  }

  fs.onChatFlags(soon);
  fs.onSignal(path => { if (path === '/' || path.startsWith('/anna/chatDone')) applyDone(); });
  rt.ready().then(() => { applyDone(); refresh(); });
  setInterval(refresh, 10 * 60e3); // на всякий случай: менеджер ответил с телефона — пометку снимает сам бот, но сверяемся раз в 10 минут
  return { refresh };
}

// Разовый перенос чатов и архива переписки в raz-anna. Если чат уже успел появиться в raz-anna (клиент написал
// во время переноса), сообщения склеиваются, ничего не теряется.
export async function moveChats({ fs, log }) {
  await fs.rt.ready();
  if (fs.rt.get('sig/chatsMovedAt')) return;
  const main = fs.main();
  const merge = (a = [], b = []) => {
    const seen = new Set(), out = [];
    for (const m of [...a, ...b].sort((x, y) => (x.at || 0) - (y.at || 0))) {
      const k = (m.id || '') + '|' + (m.at || 0) + '|' + (m.role || '') + '|' + String(m.text || '').slice(0, 40);
      if (!seen.has(k)) { seen.add(k); out.push(m); }
    }
    return out;
  };
  let n = 0;
  for (const col of ['wa_chats', 'wa_log']) {
    const old = await main.list(col);
    if (!old.length) continue;
    const have = new Map((await fs.anna.list(col)).map(d => [d.id, d]));
    for (const { id, _ts, ...doc } of old) {
      const cur = have.get(id);
      const data = cur ? { ...doc, ...cur, messages: merge(doc.messages, cur.messages) } : doc;
      delete data.id; delete data._ts;
      await fs.anna.set(col + '/' + id, data);
      n++;
    }
  }
  await fs.rt.set('sig/chatsMovedAt', Date.now());
  log('Переписка перенесена в проект raz-anna:', n, 'документов. В основной базе её копия пока остаётся — для подстраховки.');
}
