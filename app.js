/* Домашняя библиотека — приложение. Данные: Supabase (общая база) или память телефона (локально). */
(function () {
'use strict';
const E = window.Engine;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const PERMS = [['scan', 'Сканировать и добавлять книги'], ['edit', 'Редактировать и удалять книги, собрания'], ['arrange', 'Переставлять книги и делать расстановку'], ['setup', 'Настраивать шкафы и жанры']];
const STATUS = [['read', 'Прочитал'], ['liked', 'Понравилось'], ['disliked', 'Не понравилось'], ['want', 'Хочу прочитать']];
const LOOKS = [['beautiful', 'Красивый переплёт'], ['normal', 'Обычный'], ['worn', 'Потрёпанный']];

/* ================= хранилища ================= */
function LocalStore() {
  const KEY = 'lib.local';
  let db = LS.get(KEY) || { settings: null, layout: null, books: [], collections: [], marks: [], profiles: [{ id: 'local', name: 'Я', is_owner: true, perms: {} }] };
  const save = () => { if (!LS.set(KEY, db)) toast('Память телефона переполнена — сохрани резервную копию'); };
  return {
    mode: 'local',
    async session() { return true; },
    async me() { return db.profiles[0]; },
    async load() { return JSON.parse(JSON.stringify(db)); },
    async getLayout() { return db.layout; },
    async saveSettings(d) { db.settings = d; save(); },
    async saveLayout(d) { db.layout = d; save(); },
    async insertBook(b) { const r = Object.assign({ id: uid(), created_at: new Date().toISOString(), created_by: 'local' }, b); db.books.push(r); save(); return r; },
    async updateBook(id, p) { const b = db.books.find(x => x.id === id); if (b) Object.assign(b, p); save(); return b; },
    async deleteBook(id) { db.books = db.books.filter(x => x.id !== id); db.marks = db.marks.filter(m => m.book_id !== id); save(); },
    async insertCollection(c) { const r = Object.assign({ id: uid() }, c); db.collections.push(r); save(); return r; },
    async updateCollection(id, p) { const c = db.collections.find(x => x.id === id); if (c) Object.assign(c, p); save(); },
    async deleteCollection(id) { db.collections = db.collections.filter(x => x.id !== id); db.books.forEach(b => { if (b.collection_id === id) b.collection_id = null; }); save(); },
    async setMark(book_id, m) { db.marks = db.marks.filter(x => !(x.book_id === book_id && x.user_id === 'local')); if (m.status || m.rating) db.marks.push({ user_id: 'local', book_id, status: m.status || null, rating: m.rating || null }); save(); },
    async updateProfile(id, p) { const u = db.profiles.find(x => x.id === id); if (u) Object.assign(u, p); save(); },
    async importAll(d) { db = { settings: d.settings, layout: d.layout, books: d.books || [], collections: d.collections || [], marks: (d.marks || []).map(m => Object.assign({}, m, { user_id: 'local' })), profiles: db.profiles }; save(); },
    async signOut() {}
  };
}

function CloudStore(url, key) {
  const sb = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  const chk = ({ data, error }) => { if (error) throw error; return data; };
  async function all(table, order) {
    let out = [], from = 0;
    for (;;) {
      let q = sb.from(table).select('*').range(from, from + 999);
      if (order) q = q.order(order);
      const d = chk(await q); out = out.concat(d); if (d.length < 1000) break; from += 1000;
    }
    return out;
  }
  const S = {
    mode: 'cloud', sb,
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) { chk(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password, name) { const d = chk(await sb.auth.signUp({ email, password, options: { data: { name } } })); return d; },
    async signOut() { await sb.auth.signOut(); },
    async me() { const { data } = await sb.auth.getUser(); if (!data.user) return null; const p = chk(await sb.from('profiles').select('*').eq('id', data.user.id).maybeSingle()); return p || { id: data.user.id, name: data.user.email, perms: {} }; },
    async load() {
      const [st, ly, books, collections, marks, profiles] = await Promise.all([
        sb.from('settings').select('*').eq('id', 1).maybeSingle().then(chk), sb.from('layout').select('*').eq('id', 1).maybeSingle().then(chk),
        all('books', 'created_at'), all('collections'), all('marks'), all('profiles', 'created_at')]);
      return { settings: st && st.data, layout: ly && ly.data, books, collections, marks, profiles };
    },
    async getLayout() { const r = chk(await sb.from('layout').select('*').eq('id', 1).maybeSingle()); return r && r.data; },
    async saveSettings(d) { chk(await sb.from('settings').upsert({ id: 1, data: d, updated_at: new Date().toISOString() })); },
    async saveLayout(d) { chk(await sb.from('layout').upsert({ id: 1, data: d, updated_at: new Date().toISOString() })); },
    async insertBook(b) { return chk(await sb.from('books').insert(b).select().single()); },
    async updateBook(id, p) { return chk(await sb.from('books').update(p).eq('id', id).select().single()); },
    async deleteBook(id) { chk(await sb.from('books').delete().eq('id', id)); },
    async insertCollection(c) { return chk(await sb.from('collections').insert(c).select().single()); },
    async updateCollection(id, p) { chk(await sb.from('collections').update(p).eq('id', id)); },
    async deleteCollection(id) { chk(await sb.from('collections').delete().eq('id', id)); },
    async setMark(book_id, m) {
      const me = App.me.id;
      if (!m.status && !m.rating) chk(await sb.from('marks').delete().eq('book_id', book_id).eq('user_id', me));
      else chk(await sb.from('marks').upsert({ user_id: me, book_id, status: m.status || null, rating: m.rating || null, updated_at: new Date().toISOString() }));
    },
    async updateProfile(id, p) { chk(await sb.from('profiles').update(p).eq('id', id)); },
    async importAll(d) {
      if (d.settings) await S.saveSettings(d.settings);
      if (d.layout) await S.saveLayout(d.layout);
      const pick = (o, ks) => Object.fromEntries(ks.filter(k => k in o).map(k => [k, o[k]]));
      const CK = ['id', 'name', 'author', 'genre', 'total'];
      const BK = ['id', 'title', 'author', 'author_key', 'genre', 'collection_id', 'volume', 'year', 'publisher', 'isbn', 'annotation', 'thick', 'width', 'height', 'look', 'pin', 'note'];
      for (let i = 0; i < (d.collections || []).length; i += 200) chk(await sb.from('collections').upsert(d.collections.slice(i, i + 200).map(c => pick(c, CK))));
      for (let i = 0; i < (d.books || []).length; i += 200) chk(await sb.from('books').upsert(d.books.slice(i, i + 200).map(b => pick(b, BK))));
    }
  };
  return S;
}

/* ================= состояние ================= */
const App = { store: null, me: null, st: null, layout: null, books: [], bookMap: new Map(), collections: [], colMap: new Map(), marks: [], profiles: [], pos: new Map(), view: 'scan', scan: null, catLimit: 150, loadedAt: 0 };
window.App = App;
const can = p => !!(App.me && (App.me.is_owner || (App.me.perms && App.me.perms[p])));
const gById = id => App.st.genres.find(g => g.id === id);
const myMark = id => App.marks.find(m => m.book_id === id && m.user_id === App.me.id) || {};
function index() {
  App.bookMap = new Map(App.books.map(b => [b.id, b]));
  App.colMap = new Map(App.collections.map(c => [c.id, c]));
  App.pos = E.posIndex(App.layout);
}
const shelfMap = () => Object.fromEntries(E.seq(App.st).map(s => [s.id, s]));
const shelfLabel = (s, row) => s ? `${s.cabName} · полка ${s.num}${row === 'b' ? ' · задний ряд' : ''}` : '—';
function placeShort(id) { const p = App.pos.get(id); if (!p) return ''; const s = shelfMap()[p.sid]; return s ? `${s.cabName}·${s.num}${p.row === 'b' ? ' зад' : ''}, ${p.i + 1}-я` : ''; }

let tt; function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 3500); }
function fail(e) { console.warn(e); const m = (e && (e.message || e.error_description)) || String(e); toast(/row-level|permission|policy/i.test(m) ? 'Нет прав на это действие' : /fetch|network|Failed/i.test(m) ? 'Нет связи с базой' : 'Ошибка: ' + m); }

async function reload() {
  const d = await App.store.load();
  App.st = d.settings || E.defaultSettings();
  App.layout = d.layout || { phase: 'catalog', zones: {}, shelves: {}, over: [] };
  App.books = d.books || []; App.collections = d.collections || []; App.marks = d.marks || []; App.profiles = d.profiles || [];
  App.me = await App.store.me() || App.me;
  index(); App.loadedAt = Date.now();
  return !d.settings;
}
async function saveLayout() { await App.store.saveLayout(App.layout); App.pos = E.posIndex(App.layout); }
async function saveSettings() { await App.store.saveSettings(App.st); }

/* пересчёт мест для жанров (после добавления, правки, закрепления) */
async function replace(gids) {
  if (App.layout.phase !== 'live') return [];
  if (App.store.mode === 'cloud') { const fresh = await App.store.getLayout(); if (fresh) App.layout = fresh; }
  let moves = [];
  for (const g of [...new Set(gids.filter(Boolean))]) {
    const r = E.placeGenre(App.layout, g, App.st, App.books, App.marks, App.collections);
    App.layout = r.layout; moves = moves.concat(r.moves);
  }
  await saveLayout();
  return moves;
}

/* ================= вход и подключение ================= */
function readConnectHash() {
  const m = location.hash.match(/connect=([^&]+)/);
  if (!m) return;
  try { const c = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1]))))); if (c.url && c.key) LS.set('lib.cfg', { mode: 'cloud', url: c.url, key: c.key }); } catch (e) { toast('Ссылка подключения повреждена'); }
  history.replaceState(null, '', location.pathname + location.search);
}
function gateSetup() {
  $('#app').innerHTML = `<div class="gate">
  <img class="logo" src="icon.svg" alt=""><h1>Домашняя библиотека</h1>
  <p class="mut">Выбери, где хранить каталог. Это можно поменять позже.</p>
  <div class="card"><h3 style="margin-top:0">Общая база для всей семьи</h3>
  <p class="mut">Нужен бесплатный проект Supabase — см. инструкцию. Если тебе прислали ссылку подключения, просто открой её.</p>
  <label class="f">Адрес проекта (Project URL)<input id="cfgUrl" placeholder="https://xxxx.supabase.co" autocomplete="off"></label>
  <label class="f">Ключ (anon public key)<input id="cfgKey" placeholder="eyJ..." autocomplete="off"></label>
  <button class="btn w100" style="margin-top:12px" data-act="cfgCloud">Подключить</button></div>
  <div class="card"><h3 style="margin-top:0">Только на этом телефоне</h3><p class="mut">Без регистрации. Каталог хранится в памяти телефона, переносится резервной копией.</p>
  <button class="btn ghost w100" data-act="cfgLocal">Начать без облака</button></div></div>`;
}
function gateAuth(mode) {
  const up = mode === 'up';
  $('#app').innerHTML = `<div class="gate"><img class="logo" src="icon.svg" alt=""><h1>${up ? 'Регистрация' : 'Вход'}</h1>
  <p class="mut">${up ? 'Первый зарегистрированный становится главным администратором.' : 'Войди под своей почтой.'}</p>
  <form id="authForm" class="card">${up ? '<label class="f">Имя<input id="aName" autocomplete="name" required></label>' : ''}
  <label class="f">Почта<input id="aEmail" type="email" autocomplete="email" required></label>
  <label class="f">Пароль (от 6 символов)<input id="aPass" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="6" required></label>
  <button class="btn w100" style="margin-top:12px" type="submit">${up ? 'Зарегистрироваться' : 'Войти'}</button>
  <p class="mut" style="text-align:center;margin-bottom:0">${up ? 'Уже есть аккаунт?' : 'Нет аккаунта?'} <button type="button" class="lnk" data-act="${up ? 'toIn' : 'toUp'}">${up ? 'Войти' : 'Зарегистрироваться'}</button></p></form>
  <p style="text-align:center"><button class="lnk" data-act="resetCfg">Сменить базу</button></p></div>`;
  $('#authForm').addEventListener('submit', async e => {
    e.preventDefault(); const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
    try {
      if (up) { const d = await App.store.signUp($('#aEmail').value.trim(), $('#aPass').value, $('#aName').value.trim()); if (!d.session) { toast('Подтверди почту по ссылке из письма, затем войди'); gateAuth('in'); return; } }
      else await App.store.signIn($('#aEmail').value.trim(), $('#aPass').value);
      await start();
    } catch (er) { fail(er); btn.disabled = false; }
  });
}
async function boot() {
  readConnectHash();
  const cfg = LS.get('lib.cfg');
  if (!cfg) return gateSetup();
  if (cfg.mode === 'cloud') {
    if (!window.supabase) { $('#app').innerHTML = `<div class="gate"><h1>Нет связи</h1><p class="mut">Не загрузилась библиотека подключения к базе. Проверь интернет и обнови страницу.</p><button class="btn" onclick="location.reload()">Обновить</button></div>`; return; }
    App.store = CloudStore(cfg.url, cfg.key);
    if (!(await App.store.session())) return gateAuth('in');
  } else App.store = LocalStore();
  await start();
}
async function start() {
  $('#app').innerHTML = `<div class="gate row"><span class="spin"></span><span>Загружаю библиотеку…</span></div>`;
  try { const fresh = await reload(); if (fresh && can('setup')) await saveSettings().catch(() => {}); } catch (e) { fail(e); $('#app').innerHTML = `<div class="gate"><h1>Не удалось загрузить</h1><p class="mut">${esc(e.message || e)}</p><button class="btn" onclick="location.reload()">Попробовать снова</button> <button class="btn ghost" data-act="resetCfg">Сменить базу</button></div>`; return; }
  shell(); render();
}

/* ================= каркас ================= */
const ICONS = {
  scan: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  cat: '<path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.6-1 3 15.4-3.6.8z"/>',
  shelves: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M12 3v18"/>',
  mine: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'
};
function shell() {
  const tab = (v, l) => `<button data-act="tab" data-v="${v}" class="${App.view === v ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">${ICONS[v]}</svg>${l}</button>`;
  $('#app').innerHTML = `<header class="top"><h1>Библиотека</h1><button class="ib" data-act="refresh" aria-label="Обновить" title="Обновить">↻</button><div class="who">${esc(App.me.name)}<br>${App.me.is_owner ? 'главный' : App.store.mode === 'local' ? 'на телефоне' : 'читатель'}</div></header>
  <main id="view"></main>
  <nav class="tabs">${tab('scan', 'Сканер')}${tab('cat', 'Каталог')}${tab('shelves', 'Шкафы')}${tab('mine', 'Моё')}${tab('more', 'Ещё')}</nav>`;
}
function render() {
  const v = $('#view'); if (!v) return;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === App.view));
  ({ scan: renderScan, cat: renderCat, shelves: renderShelves, mine: renderMine, more: renderMore, collections: renderCollections, users: renderUsers, settings: renderSettings })[App.view](v);
}

/* ================= общие куски ================= */
function genreOptions(sel, allowEmpty) {
  const groups = {}; App.st.genres.forEach(g => (groups[g.group || 'Другое'] = groups[g.group || 'Другое'] || []).push(g));
  return (allowEmpty ? '<option value="">— выбери жанр —</option>' : '') + Object.keys(groups).map(k => `<optgroup label="${esc(k)}">${groups[k].map(g => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</optgroup>`).join('');
}
function colOptions(sel) {
  return `<option value="">— не в собрании —</option>` + App.collections.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(c => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('') + `<option value="__new">＋ Новое собрание…</option>`;
}
function mapHTML(hl) {
  const zm = {}; for (const g in (App.layout.zones || {})) (App.layout.zones[g] || []).forEach(s => zm[s] = gById(g));
  const seq = E.seq(App.st);
  return '<div class="map">' + App.st.cabinets.map(c => {
    const maxLen = Math.max(...c.shelves.map(s => +s.len || 0));
    return `<div class="cab" style="width:${Math.round(Math.max(38, maxLen * 0.6))}px"><b>${esc(c.name)}</b>` + seq.filter(s => s.cab === c.id).map(s => {
      const r = (App.layout.shelves || {})[s.id] || { f: [], b: [] };
      const usedL = (r.f || []).concat(r.b || []).reduce((a, id) => a + E.dims(App.bookMap.get(id)).t, 0);
      const rows = App.layout.two && s.depth >= 34 ? 2 : 1;
      const pct = Math.min(100, usedL / (s.len * rows || 1) * 100), g = zm[s.id];
      return `<button class="sh${s.id === hl ? ' hl' : ''}${s.cls === 'eye' ? ' eye' : ''}" data-act="shelf" data-sid="${s.id}" aria-label="${esc(c.name)}, полка ${s.num}"${g ? ` style="background:${g.color}2e"` : ''}><i style="width:${pct}%;background:${g ? g.color : 'var(--mute)'}"></i></button>`;
    }).join('') + '</div>';
  }).join('') + '</div>';
}
function placeBlock(id) {
  const b = App.bookMap.get(id); if (!b) return '';
  if (App.layout.phase !== 'live') {
    const g = gById(b.genre);
    return `<div class="place"><span class="mut">Идёт каталогизация</span><strong>Отложи в стопку «${esc(g ? g.name : 'без жанра')}»</strong><span class="mut">В ней уже ${App.books.filter(x => x.genre === b.genre).length} шт. Когда занесёте все книги — Шкафы → «Расставить всё».</span></div>`;
  }
  const p = App.pos.get(id);
  if (!p) return `<div class="note bad">Свободного места в зоне этого жанра нет. Пока отложи книгу, затем Шкафы → «Перераспределить» (или уменьши запас места в настройках).</div>`;
  const s = shelfMap()[p.sid], r = App.layout.shelves[p.sid], arr = p.row === 'b' ? r.b : r.f;
  const L = App.bookMap.get(arr[p.i - 1]), R = App.bookMap.get(arr[p.i + 1]);
  return `<div class="place"><span class="mut">Поставь сюда</span><strong>Шкаф <span class="big">${esc(s.cabName)}</span> · полка ${s.num} <span class="mut" style="font:400 15px Inter">сверху</span></strong>
  <div>${p.row === 'b' ? '<b>Задний ряд</b>, ' : (r.b && r.b.length ? 'Передний ряд, ' : '')}${p.i + 1}-я слева из ${arr.length}${E.lying(b) ? ' · <b>положи плашмя</b> (высокая)' : ''}${b.pin ? ' · место закреплено' : ''}</div>
  <div class="mut">${L ? 'после «' + esc(L.title) + '»' : 'первая в ряду'}${R ? ', перед «' + esc(R.title) + '»' : ''}</div></div>` + mapHTML(p.sid);
}
function movesHTML(moves) {
  if (!moves || !moves.length) return '';
  const sm = shelfMap();
  return `<div class="note"><b>Переставь (${moves.length}):</b>` + moves.slice(0, 40).map(m => { const b = App.bookMap.get(m.id); return `<div style="margin:3px 0">«${esc(b ? b.title : '?')}»: ${m.from ? esc(shelfLabel(sm[m.from.sid], m.from.row)) : 'новая'} → ${esc(shelfLabel(sm[m.to.sid], m.to.row))}</div>`; }).join('') + (moves.length > 40 ? `<div>…и ещё ${moves.length - 40}</div>` : '') + '</div>';
}
function markHTML(id) {
  const m = myMark(id);
  return `<div class="seg">${STATUS.map(([k, l]) => `<button data-act="mark" data-id="${id}" data-s="${k}" class="${m.status === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  <div class="mut">Моя оценка</div><div class="rate">${Array.from({ length: 10 }, (_, i) => `<button data-act="rate" data-id="${id}" data-r="${i + 1}" class="${+m.rating === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('')}</div>`;
}
function othersHTML(id) {
  const ms = App.marks.filter(m => m.book_id === id && +m.rating >= 1);
  if (!ms.length) return '';
  const avg = ms.reduce((a, m) => a + +m.rating, 0) / ms.length;
  const names = ms.map(m => { const p = App.profiles.find(x => x.id === m.user_id); return `${esc(p ? p.name : '?')}: ${m.rating}`; }).join(', ');
  return `<p class="mut">Средняя оценка ${avg.toFixed(1).replace('.', ',')} (${names})</p>`;
}

/* ================= модалка ================= */
function openModal(h) { $('#sheet').innerHTML = `<button class="ib x" data-act="close" aria-label="Закрыть">×</button>` + h; $('#modal').hidden = false; $('#sheet').scrollTop = 0; }
function closeModal() { $('#modal').hidden = true; $('#sheet').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

/* ================= СКАНЕР ================= */
function blank() { return { title: '', author: '', genre: '', collection_id: '', volume: '', year: '', publisher: '', isbn: '', annotation: '', thick: '', width: '', height: '', pages: '', look: 'normal', status: '', rating: 0 }; }
function renderScan(v) {
  const s = App.scan;
  const head = App.layout.phase === 'live'
    ? `<p class="banner">В библиотеке ${App.books.length} кн. Сфотографируй книгу — покажу её место.</p>`
    : `<p class="banner"><b>Этап 1: каталогизация.</b> Занесено ${App.books.length} кн. Сканируйте книги и раскладывайте стопками по жанрам. Когда закончите — Шкафы → «Расставить всё».</p>`;
  if (!s) {
    v.innerHTML = head + (can('scan') ? `<div class="shoot">
    <label for="cam"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Сфотографировать книгу</label>
    <input id="cam" class="hidefile" type="file" accept="image/*" capture="environment">
    <div class="row" style="margin-top:10px"><label for="gal" class="alt grow">Фото из галереи</label><input id="gal" class="hidefile" type="file" accept="image/*">
    <button class="btn ghost grow" data-act="manual">Ввести вручную</button></div></div>
    <p class="mut">Лучше всего читается обложка или титульный лист при хорошем свете. Если на книге есть штрихкод ISBN — сфотографируй его, так точнее всего.</p>`
      : `<div class="card">Чтобы добавлять книги, попроси главного администратора дать право «Сканировать». Узнать о книге можно в Каталоге.</div>`)
      + `<h3>Узнать, где книга</h3><input id="findQ" type="search" placeholder="Название или автор"><ul class="list" id="findRes"></ul>`;
    return;
  }
  if (s.stage === 'busy') { v.innerHTML = `${s.img ? `<img class="prev" src="${s.img}" alt="">` : ''}<div class="card row"><span class="spin"></span><span id="busyMsg">${esc(s.msg || 'Читаю текст…')}</span></div>`; return; }
  if (s.stage === 'done') {
    const b = App.bookMap.get(s.id);
    v.innerHTML = `<div class="card"><div class="ttl">${esc(b ? b.title : '')}</div><div class="au">${esc(b ? b.author : '')}</div>${movesHTML(s.moves)}${placeBlock(s.id)}</div>
    <button class="btn w100" data-act="scanNext">Следующая книга</button>`;
    return;
  }
  // форма
  const d = s.d;
  v.innerHTML = `${s.img ? `<img class="prev" src="${s.img}" alt=""><div class="row" style="margin:6px 0"><button class="btn ghost sm" data-act="rot" data-d="-90">⟲ Повернуть</button><button class="btn ghost sm" data-act="rot" data-d="90">⟳</button><span class="mut">если текст на фото боком</span></div>` : ''}
  ${s.lines && s.lines.length ? `<div class="mut">Распознанный текст — нажми, чтобы вставить в выбранное поле (сейчас: <b>${s.target === 'author' ? 'Автор' : 'Название'}</b>)</div><div class="chips">${s.lines.map((l, i) => `<button data-act="chip" data-i="${i}">${esc(l)}</button>`).join('')}</div>` : (s.img ? '<p class="note">Текст не распознан. Попробуй повернуть фото или введи вручную.</p>' : '')}
  <div class="card">
  <label class="f">Название<input class="sf" data-f="title" value="${esc(d.title)}"></label>
  <label class="f">Автор<input class="sf" data-f="author" value="${esc(d.author)}"></label>
  <button class="btn ghost w100" style="margin-top:10px" data-act="lookup">Найти описание в интернете</button>
  <div id="cands">${s.cands ? candsHTML(s.cands) : ''}</div>
  <label class="f">Жанр<select class="sf" data-f="genre">${genreOptions(d.genre, true)}</select></label>
  <div class="grid2"><label class="f">Собрание сочинений<select class="sf" data-f="collection_id">${colOptions(d.collection_id)}</select></label><label class="f">Том №<input class="sf" data-f="volume" inputmode="decimal" value="${esc(d.volume)}"></label></div>
  <div id="newCol"></div>
  <div class="mut" style="margin-top:12px">Вид книги</div>
  <div class="seg">${LOOKS.map(([k, l]) => `<button data-act="look" data-k="${k}" class="${d.look === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  <details><summary>Размеры, год, издательство</summary>
  <p class="mut" style="margin:0">Если не знаешь — оставь пустым: считаю толщину 3 см, ширину 14, высоту 21. Толщину можно посчитать по страницам.</p>
  <div class="grid3"><label class="f">Толщина, см<input class="sf" data-f="thick" inputmode="decimal" value="${esc(d.thick)}"></label><label class="f">Ширина, см<input class="sf" data-f="width" inputmode="decimal" value="${esc(d.width)}"></label><label class="f">Высота, см<input class="sf" data-f="height" inputmode="decimal" value="${esc(d.height)}"></label></div>
  <div class="grid3"><label class="f">Страниц<input class="sf" data-f="pages" inputmode="numeric" value="${esc(d.pages)}"></label><label class="f">Год<input class="sf" data-f="year" inputmode="numeric" value="${esc(d.year)}"></label><label class="f">ISBN<input class="sf" data-f="isbn" inputmode="numeric" value="${esc(d.isbn)}"></label></div>
  <label class="f">Издательство<input class="sf" data-f="publisher" value="${esc(d.publisher)}"></label></details>
  <label class="f">Аннотация<textarea class="sf" data-f="annotation">${esc(d.annotation)}</textarea></label>
  <div class="mut" style="margin-top:12px">Моя отметка (необязательно)</div>
  <div class="seg">${STATUS.map(([k, l]) => `<button data-act="sStatus" data-k="${k}" class="${d.status === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  <div class="rate">${Array.from({ length: 10 }, (_, i) => `<button data-act="sRate" data-r="${i + 1}" class="${+d.rating === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('')}</div>
  <div class="row" style="margin-top:14px"><button class="btn grow" data-act="saveScan">Сохранить и показать место</button><button class="btn ghost" data-act="scanCancel">Отмена</button></div></div>`;
  if (d.collection_id === '__new') newColForm();
}
function candsHTML(c) {
  if (!c.length) return '<p class="note">Ничего не нашлось. Проверь название или заполни вручную.</p>';
  return '<div class="mut" style="margin-top:8px">Найдено — выбери подходящее:</div>' + c.map((x, i) => `<div class="card" style="margin:6px 0;padding:10px"><b>${esc(x.title)}</b>${x.author ? ' — ' + esc(x.author) : ''}${x.year ? ', ' + x.year : ''}<div class="mut">${esc(x.src)}${x.pages ? ' · ' + x.pages + ' с.' : ''}</div><div style="font-size:14px;margin:4px 0">${esc((x.annotation || '').slice(0, 220))}${(x.annotation || '').length > 220 ? '…' : ''}</div><button class="btn sm" data-act="takeCand" data-i="${i}">Взять</button></div>`).join('');
}
function newColForm() {
  const box = $('#newCol'); if (!box) return;
  const d = App.scan ? App.scan.d : {};
  box.innerHTML = `<div class="card" style="padding:10px"><b>Новое собрание</b>
  <label class="f">Название<input id="ncName" value="${esc(d.author ? 'Собрание сочинений: ' + d.author : 'Собрание сочинений')}"></label>
  <div class="grid2"><label class="f">Автор<input id="ncAuthor" value="${esc(d.author || '')}"></label><label class="f">Всего томов<input id="ncTotal" inputmode="numeric"></label></div></div>`;
}

/* --- распознавание --- */
let tessP = null, tessMsg = null;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Не удалось загрузить распознавание. Проверь интернет.')); document.head.appendChild(s); }); }
function tess() {
  if (!tessP) {
    tessP = (async () => {
      if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
      return Tesseract.createWorker(['rus', 'eng'], 1, { logger: m => { if (tessMsg && m.status) tessMsg(m); } });
    })();
    tessP.catch(() => { tessP = null; });
  }
  return tessP;
}
async function fileToCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
function rotate(c, deg) {
  const r = document.createElement('canvas'); const q = ((deg % 360) + 360) % 360;
  r.width = q % 180 ? c.height : c.width; r.height = q % 180 ? c.width : c.height;
  const x = r.getContext('2d'); x.translate(r.width / 2, r.height / 2); x.rotate(q * Math.PI / 180); x.drawImage(c, -c.width / 2, -c.height / 2);
  return r;
}
function prep(c) {
  const r = document.createElement('canvas'); r.width = c.width; r.height = c.height;
  const x = r.getContext('2d'); x.drawImage(c, 0, 0);
  const im = x.getImageData(0, 0, r.width, r.height), a = im.data;
  for (let i = 0; i < a.length; i += 4) { let g = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; g = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128)); a[i] = a[i + 1] = a[i + 2] = g; }
  x.putImageData(im, 0, 0); return r;
}
const capWords = s => s.toLowerCase().replace(/(^|[\s\-.])([a-zа-яё])/g, (m, p, ch) => p + ch.toUpperCase());
const sentence = s => { const t = s.toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
function cleanLine(t) { return t.replace(/[|_~^`«»"„“”<>\[\]{}*#@]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function guessFields(lines) {
  // lines: [{text,h}] — самая крупная надпись обычно название, строка-имя — автор
  const isName = t => /^([А-ЯЁA-Z][а-яёa-z]+|[А-ЯЁA-Z]\.)(\s*[А-ЯЁA-Z]\.)?\s*[А-ЯЁA-Z][а-яёa-z\-]+$/.test(t) || /^[А-ЯЁA-Z][а-яёa-z]+\s+[А-ЯЁA-Z][а-яёa-z]+(\s+[А-ЯЁA-Z][а-яёa-z]+)?$/.test(t);
  const junk = t => /издательств|москва|ленинград|санкт|^\d{4}$|isbn|серия|библиотек|том\s*\d|^\d+$/i.test(t);
  const norm = lines.map(l => ({ text: l.text, h: l.h, nice: l.text === l.text.toUpperCase() ? capWords(l.text) : l.text }));
  let author = norm.find(l => isName(l.nice) && !junk(l.text));
  const titleL = norm.filter(l => l !== author && !junk(l.text) && /[а-яёa-z]{3}/i.test(l.text)).sort((a, b) => b.h - a.h)[0];
  return { author: author ? author.nice : '', title: titleL ? (titleL.text === titleL.text.toUpperCase() ? sentence(titleL.text) : titleL.text) : '' };
}
async function ocr(canvas) {
  const w = await tess();
  const { data } = await w.recognize(prep(canvas));
  let lines = (data.lines || []).filter(l => l.confidence > 35).map(l => ({ text: cleanLine(l.text), h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0 }));
  if (!lines.length && data.text) lines = data.text.split('\n').map(t => ({ text: cleanLine(t), h: 0 }));
  return lines.filter(l => l.text.length > 1 && /[а-яёa-z]{2}/i.test(l.text));
}
async function findIsbn(canvas) {
  if (!('BarcodeDetector' in window)) return null;
  try { const d = new BarcodeDetector({ formats: ['ean_13'] }); const r = await d.detect(canvas); const c = r.map(x => x.rawValue).find(v => /^97[89]\d{10}$/.test(v)); return c || null; } catch (e) { return null; }
}
async function processPhoto(file) {
  if (!file) return;
  App.scan = { stage: 'busy', d: blank(), msg: 'Готовлю фото…' }; render();
  try {
    const c = await fileToCanvas(file);
    App.scan.canvas = c; App.scan.img = c.toDataURL('image/jpeg', 0.7); render();
    const isbn = await findIsbn(c);
    if (isbn) {
      App.scan.d.isbn = isbn; setBusy('Нашёл штрихкод, ищу книгу…');
      const cands = await gbooks('isbn:' + isbn).catch(() => []);
      App.scan.stage = 'form'; App.scan.cands = cands; if (cands[0]) applyCand(cands[0]);
      render(); return;
    }
    await runOcr(c);
  } catch (e) { fail(e); App.scan = { stage: 'form', d: blank(), target: 'title' }; render(); }
}
function setBusy(m) { if (App.scan) App.scan.msg = m; const el = $('#busyMsg'); if (el) el.textContent = m; }
async function runOcr(c) {
  App.scan.stage = 'busy'; setBusy('Загружаю распознавание (первый раз дольше)…'); render();
  tessMsg = m => setBusy(m.status === 'recognizing text' ? `Читаю текст… ${Math.round((m.progress || 0) * 100)}%` : 'Готовлю распознавание…');
  const lines = await ocr(c);
  const g = guessFields(lines);
  const s = App.scan; s.lines = lines.map(l => l.text).slice(0, 24); s.stage = 'form'; s.target = 'title';
  if (!s.d.title) s.d.title = g.title; if (!s.d.author) s.d.author = g.author;
  s.d.genre = s.d.genre || E.guessGenre(App.st, s.lines.join(' '), s.d.author) || '';
  render();
}

/* --- поиск описания --- */
async function gbooks(q) {
  const r = await fetch('https://www.googleapis.com/books/v1/volumes?maxResults=6&printType=books&q=' + encodeURIComponent(q));
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || []).map(it => { const v = it.volumeInfo || {}; const id13 = (v.industryIdentifiers || []).find(x => x.type === 'ISBN_13'); return { src: 'Google Книги', title: (v.title || '') + (v.subtitle ? '. ' + v.subtitle : ''), author: (v.authors || []).join(', '), year: parseInt(v.publishedDate) || '', publisher: v.publisher || '', pages: v.pageCount || '', annotation: (v.description || '').replace(/<[^>]+>/g, ''), cats: (v.categories || []).join(' '), isbn: id13 ? id13.identifier : '' }; });
}
async function wiki(q) {
  const base = 'https://ru.wikipedia.org/w/api.php?format=json&origin=*&';
  const s = await (await fetch(base + 'action=query&list=search&srlimit=3&srsearch=' + encodeURIComponent(q))).json();
  const ids = ((s.query && s.query.search) || []).map(x => x.pageid); if (!ids.length) return [];
  const e = await (await fetch(base + 'action=query&prop=extracts&exintro=1&explaintext=1&exsentences=4&pageids=' + ids.join('|'))).json();
  return ids.map(id => e.query.pages[id]).filter(Boolean).map(p => ({ src: 'Википедия', title: p.title, author: '', annotation: (p.extract || '').trim(), cats: '' }));
}
async function lookup() {
  const d = App.scan.d; const t = d.title.trim(), a = d.author.trim();
  if (!t && !d.isbn) return toast('Сначала заполни название');
  const box = $('#cands'); if (box) box.innerHTML = '<div class="row" style="margin:8px 0"><span class="spin"></span><span>Ищу…</span></div>';
  const q = d.isbn ? 'isbn:' + d.isbn : 'intitle:' + t + (a ? ' inauthor:' + E.authorKey(a) : '');
  const [g, w] = await Promise.all([gbooks(q).catch(() => []), wiki((t + ' ' + (a ? E.authorKey(a) : '')).trim()).catch(() => [])]);
  let res = g.slice(0, 4).concat(w);
  if (!g.length && t && a) res = (await gbooks('intitle:' + t).catch(() => [])).slice(0, 3).concat(w);
  App.scan.cands = res; if (box) box.innerHTML = candsHTML(res);
}
function applyCand(c) {
  const d = App.scan.d;
  if (c.src !== 'Википедия' || !d.title) d.title = c.title || d.title;
  if (c.author) d.author = c.author;
  if (c.year) d.year = c.year; if (c.publisher) d.publisher = c.publisher; if (c.isbn) d.isbn = c.isbn;
  if (c.pages) { d.pages = c.pages; if (!d.thick) d.thick = (c.pages * 0.0065 + 0.4).toFixed(1); }
  if (c.annotation) d.annotation = c.annotation.length > 900 ? c.annotation.slice(0, 900).replace(/\s\S*$/, '') + '…' : c.annotation;
  if (c.src === 'Википедия' && d.annotation && !/Википедия/.test(d.annotation)) d.annotation += ' (Википедия)';
  if (!d.genre) d.genre = E.guessGenre(App.st, [c.title, c.cats, c.annotation].join(' '), d.author) || '';
}
function num(v) { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) && x > 0 ? x : null; }
async function saveBookFrom(d, id) {
  let collection_id = d.collection_id || null;
  if (collection_id === '__new') {
    const name = ($('#ncName') && $('#ncName').value.trim()) || 'Собрание сочинений';
    const c = await App.store.insertCollection({ name, author: ($('#ncAuthor') && $('#ncAuthor').value.trim()) || d.author || '', genre: d.genre || null, total: num($('#ncTotal') && $('#ncTotal').value) });
    App.collections.push(c); collection_id = c.id;
  }
  const col = collection_id && App.collections.find(c => c.id === collection_id);
  const row = {
    title: String(d.title || '').trim() || 'Без названия', author: String(d.author || '').trim(),
    author_key: E.authorKey((col && col.author) || d.author), genre: d.genre || null, collection_id,
    volume: num(d.volume), year: num(d.year) ? Math.round(num(d.year)) : null, publisher: d.publisher || null, isbn: d.isbn || null,
    annotation: d.annotation || null, thick: num(d.thick), width: num(d.width), height: num(d.height), look: d.look || 'normal'
  };
  return id ? App.store.updateBook(id, row) : App.store.insertBook(row);
}

/* ================= КАТАЛОГ ================= */
let catQ = '', catG = '', catC = '';
function renderCat(v) {
  v.innerHTML = `<h2>Каталог</h2><input id="q" type="search" placeholder="Название, автор, собрание" value="${esc(catQ)}">
  <div class="row" style="margin-top:8px"><select id="gf" class="grow"><option value="">Все жанры</option>${genreOptions(catG)}</select><select id="cf" class="grow"><option value="">Все книги</option>${App.collections.map(c => `<option value="${c.id}"${c.id === catC ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
  <p class="mut" id="catCount"></p><ul class="list" id="catList"></ul>`;
  fillCat();
}
function catFilter() {
  const q = E.norm(catQ);
  let list = App.books;
  if (catG) list = list.filter(b => b.genre === catG);
  if (catC) list = list.filter(b => b.collection_id === catC);
  if (q) list = list.filter(b => (E.norm(b.title) + ' ' + E.norm(b.author) + ' ' + E.norm((App.colMap.get(b.collection_id) || {}).name)).includes(q));
  return list.slice().sort((a, b) => ((gById(a.genre) || {}).name || 'я').localeCompare((gById(b.genre) || {}).name || 'я', 'ru') || (a.author_key || '').localeCompare(b.author_key || '', 'ru') || (+a.volume || 0) - (+b.volume || 0) || a.title.localeCompare(b.title, 'ru'));
}
function rowHTML(b, right) {
  const g = gById(b.genre), c = App.colMap.get(b.collection_id);
  return `<li class="click" data-act="book" data-id="${b.id}"><span class="dot" style="background:${g ? g.color : 'var(--mute)'}"></span><div><div class="t">${esc(b.title)}</div><div class="mut">${esc(b.author || '')}${c ? ' · ' + esc(c.name) + (b.volume ? ', т. ' + b.volume : '') : ''}</div></div><span class="r">${right != null ? right : esc(placeShort(b.id))}</span></li>`;
}
function fillCat() {
  const list = catFilter();
  $('#catCount').textContent = `${list.length} из ${App.books.length}`;
  $('#catList').innerHTML = list.slice(0, App.catLimit).map(b => rowHTML(b)).join('') + (list.length > App.catLimit ? `<li class="click" data-act="more" style="justify-content:center;color:var(--acc)">Показать ещё</li>` : '') + (!App.books.length ? '<li><span class="mut">Каталог пока пуст — начните со сканера.</span></li>' : '');
}

/* карточка книги */
function openBook(id) {
  const b = App.bookMap.get(id); if (!b) return;
  const g = gById(b.genre), c = App.colMap.get(b.collection_id), look = LOOKS.find(l => l[0] === b.look);
  openModal(`<div class="ttl" style="padding-right:48px">${esc(b.title)}</div><div class="au">${esc(b.author || '')}${b.year ? ' · ' + b.year : ''}${b.publisher ? ' · ' + esc(b.publisher) : ''}</div>
  <div style="margin:8px 0"><span class="chip"><span class="dot" style="background:${g ? g.color : 'var(--mute)'}"></span>${esc(g ? g.name : 'без жанра')}</span>${c ? `<span class="chip">${esc(c.name)}${b.volume ? ', т. ' + b.volume : ''}</span>` : ''}${look && b.look !== 'normal' ? `<span class="chip">${look[1]}</span>` : ''}</div>
  ${b.annotation ? `<p class="ann">${esc(b.annotation)}</p>` : ''}
  ${placeBlock(id)}
  <h3>Моя отметка</h3>${markHTML(id)}${othersHTML(id)}
  ${can('arrange') && App.layout.phase === 'live' ? pinHTML(b) : ''}
  ${can('edit') ? `<details><summary>Редактировать</summary>${editHTML(b)}</details>` : ''}`);
}
function pinHTML(b) {
  const seq = E.seq(App.st);
  const p = App.pos.get(b.id);
  return `<details><summary>Переставить вручную</summary>
  <label class="f">Полка<select id="pinS">${seq.map(s => `<option value="${s.id}"${p && p.sid === s.id ? ' selected' : ''}>${esc(shelfLabel(s))}</option>`).join('')}</select></label>
  <div class="grid2"><label class="f">Ряд<select id="pinR"><option value="f">Передний</option><option value="b"${p && p.row === 'b' ? ' selected' : ''}>Задний</option></select></label><label class="f">Позиция слева<input id="pinI" inputmode="numeric" value="${p ? p.i + 1 : 1}"></label></div>
  <div class="row" style="margin-top:10px"><button class="btn grow" data-act="pinSet" data-id="${b.id}">Закрепить здесь</button>${b.pin ? `<button class="btn ghost" data-act="pinOff" data-id="${b.id}">Снять закрепление</button>` : ''}</div>
  <p class="mut">Закреплённая книга остаётся на своём месте при любых перестановках.</p></details>`;
}
let editD = null;
function editHTML(b) {
  editD = Object.assign(blank(), b, { collection_id: b.collection_id || '' });
  const d = editD;
  const f = (k, l, im) => `<label class="f">${l}<input class="ef" data-f="${k}" ${im ? `inputmode="${im}"` : ''} value="${esc(d[k] ?? '')}"></label>`;
  return `${f('title', 'Название')}${f('author', 'Автор')}
  <label class="f">Жанр<select class="ef" data-f="genre">${genreOptions(d.genre, true)}</select></label>
  <div class="grid2"><label class="f">Собрание<select class="ef" data-f="collection_id">${colOptions(d.collection_id).replace('<option value="__new">＋ Новое собрание…</option>', '')}</select></label>${f('volume', 'Том №', 'decimal')}</div>
  <div class="seg">${LOOKS.map(([k, l]) => `<button data-act="eLook" data-k="${k}" class="${d.look === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  <div class="grid3">${f('thick', 'Толщина, см', 'decimal')}${f('width', 'Ширина, см', 'decimal')}${f('height', 'Высота, см', 'decimal')}</div>
  <div class="grid3">${f('year', 'Год', 'numeric')}${f('isbn', 'ISBN', 'numeric')}${f('publisher', 'Издательство')}</div>
  <label class="f">Аннотация<textarea class="ef" data-f="annotation">${esc(d.annotation || '')}</textarea></label>
  <div class="row" style="margin-top:12px"><button class="btn grow" data-act="saveEdit" data-id="${b.id}">Сохранить</button><button class="btn ghost" data-act="delBook" data-id="${b.id}">Удалить</button></div>`;
}

/* ================= ШКАФЫ ================= */
function renderShelves(v) {
  const seq = E.seq(App.st), R = 1 - (+App.st.reserve || 0) / 100;
  const single = seq.reduce((a, s) => a + s.len, 0);
  const two = seq.reduce((a, s) => a + s.len * (s.depth >= 34 ? 2 : 1), 0);
  const need = App.books.reduce((a, b) => a + E.dims(b).t, 0);
  const capNow = (App.layout.two ? two : single) * R;
  const pct = Math.round(need / (capNow || 1) * 100);
  const over = (App.layout.over || []).length;
  v.innerHTML = `<h2>Шкафы</h2><div class="stat"><div><b>${App.books.length}</b><span>книг</span></div><div><b>${(need / 100).toFixed(1)} м</b><span>корешков</span></div><div><b>${(capNow / 100).toFixed(1)} м</b><span>места${App.layout.two ? ' (2 ряда)' : ''}</span></div></div>
  <div class="meter"><i style="width:${Math.min(100, pct)}%;${pct > 95 ? 'background:var(--hot)' : ''}"></i></div>
  <p class="mut" style="margin-top:0">Занято ${pct}% с запасом ${App.st.reserve}% на каждой полке. В один ряд — ${(single * R / 100).toFixed(1)} м, в два ряда на глубоких полках — ${(two * R / 100).toFixed(1)} м.${over ? ` <b style="color:var(--hot)">Без места: ${over} кн.</b>` : ''}</p>
  ${can('arrange') ? `<button class="btn w100" data-act="arrange" ${App.books.length ? '' : 'disabled'}>${App.layout.phase === 'live' ? 'Перераспределить всё' : 'Расставить всё'}</button>` : ''}
  ${mapHTML(null)}<p class="mut">Нажми на полку — увидишь книги по порядку. Точка справа — уровень глаз, цвет — жанр, длина полоски — заполненность.</p>
  <h3>Зоны жанров</h3><ul class="list">${App.st.genres.filter(g => (App.layout.zones || {})[g.id] && App.layout.zones[g.id].length).map(g => { const sm = shelfMap(); return `<li><span class="dot" style="background:${g.color}"></span><div><div class="t">${esc(g.name)}</div><div class="mut">${App.layout.zones[g.id].map(id => sm[id] ? sm[id].cabName + '·' + sm[id].num : '').join(', ')}</div></div><span class="r">${App.books.filter(b => b.genre === g.id).length} кн.</span></li>`; }).join('') || '<li><span class="mut">Зоны появятся после «Расставить всё».</span></li>'}</ul>`;
}
function openShelf(sid) {
  const s = shelfMap()[sid]; if (!s) return;
  const r = (App.layout.shelves || {})[sid] || { f: [], b: [] };
  const zm = {}; for (const g in (App.layout.zones || {})) (App.layout.zones[g] || []).forEach(x => zm[x] = gById(g));
  const g = zm[sid], ed = can('arrange');
  const rowList = (arr, row) => arr.map((id, i) => { const b = App.bookMap.get(id); if (!b) return ''; return `<li><span class="mut" style="width:24px">${i + 1}</span><div class="click" data-act="book" data-id="${id}" style="cursor:pointer;flex:1"><div class="t">${esc(b.title)}${b.pin ? ' 📌' : ''}</div><div class="mut">${esc(b.author || '')}</div></div>${ed ? `<button class="ib" data-act="mv" data-sid="${sid}" data-row="${row}" data-i="${i}" data-d="-1" aria-label="Левее">↑</button><button class="ib" data-act="mv" data-sid="${sid}" data-row="${row}" data-i="${i}" data-d="1" aria-label="Правее">↓</button>` : ''}</li>`; }).join('');
  const used = (r.f || []).concat(r.b || []).reduce((a, id) => a + E.dims(App.bookMap.get(id)).t, 0);
  openModal(`<h2>${esc(shelfLabel(s))}</h2><p class="mut">${g ? esc(g.name) + ' · ' : ''}${s.cls === 'eye' ? 'уровень глаз · ' : ''}длина ${s.len}, глубина ${s.depth}, высота ${s.h2} (у брусков ${s.h1}) см${s.note ? ', ' + esc(s.note) : ''} · занято ≈${Math.round(used)} см</p>${mapHTML(sid)}
  ${(r.b || []).length ? '<h3>Передний ряд</h3>' : ''}<ol class="list">${rowList(r.f || [], 'f') || '<li><span class="mut">Пусто</span></li>'}</ol>
  ${(r.b || []).length ? `<h3>Задний ряд</h3><ol class="list">${rowList(r.b, 'b')}</ol>` : ''}
  ${ed ? `<p class="mut">Стрелки меняют порядок и закрепляют книги этой полки на своих местах.</p><button class="btn ghost w100" data-act="unpinShelf" data-sid="${sid}">Снять закрепление с полки</button>` : ''}`);
}
let plan = null;
function showPlan() {
  plan = E.allocateAll(App.st, App.books, App.marks, App.collections);
  const sm = shelfMap(), live = App.layout.phase === 'live', oldPos = App.pos;
  const zm = {}; for (const g in plan.zones) plan.zones[g].forEach(sid => zm[sid] = gById(g));
  let moved = 0;
  const shelvesH = E.seq(App.st).filter(s => plan.shelves[s.id] && (plan.shelves[s.id].f.length || plan.shelves[s.id].b.length)).map(s => {
    const r = plan.shelves[s.id], g = zm[s.id];
    const items = (arr, row) => arr.map((id, i) => { const b = App.bookMap.get(id); const o = oldPos.get(id); const mv = live && (!o || o.sid !== s.id || o.row !== row); if (mv) moved++; return `<li style="padding:6px 0"><span class="mut" style="width:24px">${i + 1}</span><div><span class="t">${esc(b ? b.title : '')}</span> <span class="mut">${esc(b ? b.author : '')}</span></div>${mv ? `<span class="r" style="color:var(--hot)">${o ? 'с ' + esc(shelfLabel(sm[o.sid], o.row)) : 'новая'}</span>` : ''}</li>`; }).join('');
    return `<details${live ? '' : ''}><summary><span class="dot" style="background:${g ? g.color : 'var(--mute)'}"></span> ${esc(shelfLabel(s))} — ${r.f.length + r.b.length} кн.${g ? ' · ' + esc(g.name) : ''}${s.cls === 'eye' ? ' · уровень глаз' : ''}</summary>${r.b.length ? '<div class="mut">Передний ряд</div>' : ''}<ol class="list">${items(r.f, 'f')}</ol>${r.b.length ? `<div class="mut">Задний ряд</div><ol class="list">${items(r.b, 'b')}</ol>` : ''}</details>`;
  }).join('');
  openModal(`<h2>${live ? 'Перераспределение' : 'План расстановки'}</h2>
  <p class="mut">Жанры идут подряд по шкафам в порядке из настроек. Понравившиеся книги — на уровне глаз, «хочу прочитать» — ниже, остальные — выше. Красивые — впереди, потрёпанные и без отметок — в заднем ряду.${plan.two ? ' Места мало, поэтому на глубоких полках два ряда.' : ''}${live ? ` Переставить: ${moved} кн. (отмечены красным).` : ' Расставляйте полку за полкой, слева направо.'}</p>
  ${plan.over.length ? `<div class="note bad">Не поместилось: ${plan.over.length} кн. Уменьши запас места в настройках или включи «два ряда всегда».</div>` : ''}
  <button class="btn w100" style="margin:6px 0 12px" data-act="applyPlan">Принять план</button>${shelvesH}`);
}

/* ================= МОЁ ================= */
function recommend() {
  const me = App.me.id, mine = new Map(App.marks.filter(m => m.user_id === me).map(m => [m.book_id, m]));
  const good = id => { const m = mine.get(id); return m && (m.status === 'liked' || +m.rating >= 7); };
  const bad = id => { const m = mine.get(id); return m && (m.status === 'disliked' || (+m.rating && +m.rating <= 4)); };
  const likedAuthors = new Map(), badAuthors = new Set(), likedCols = new Set(), gStat = {};
  App.books.forEach(b => {
    const m = mine.get(b.id); if (!m) return;
    if (good(b.id)) { likedAuthors.set(b.author_key, b.title); if (b.collection_id) likedCols.add(b.collection_id); }
    if (bad(b.id)) badAuthors.add(b.author_key);
    const gs = gStat[b.genre] || (gStat[b.genre] = { s: 0, n: 0 });
    if (+m.rating) { gs.s += +m.rating; gs.n++; } else if (m.status === 'liked') { gs.s += 8; gs.n++; } else if (m.status === 'disliked') { gs.s += 3; gs.n++; }
  });
  const mi = E.markIndex(App.marks);
  const out = [];
  for (const b of App.books) {
    const m = mine.get(b.id);
    if (m && ['read', 'liked', 'disliked'].includes(m.status)) continue;
    let sc = 0; const why = [];
    if (m && m.status === 'want') { sc += 3; why.push('ты хотел(а) её прочитать'); }
    if (b.author_key && likedAuthors.has(b.author_key)) { sc += 2.5; why.push(`тебе понравилась «${likedAuthors.get(b.author_key)}» этого автора`); }
    if (b.collection_id && likedCols.has(b.collection_id)) { sc += 1.5; }
    if (badAuthors.has(b.author_key)) sc -= 3;
    const gs = gStat[b.genre]; if (gs && gs.n) { const avg = gs.s / gs.n; sc += (avg - 5.5) * 0.5; if (avg >= 7) why.push(`жанр «${(gById(b.genre) || {}).name}» ты оцениваешь на ${avg.toFixed(1).replace('.', ',')}`); }
    const o = mi.get(b.id); if (o && o.avg) { sc += (o.avg - 5.5) * 0.35; if (o.avg >= 8) why.push(`семья ставит ${o.avg.toFixed(1).replace('.', ',')}`); }
    if (sc > 0.5) out.push({ b, sc, why });
  }
  return out.sort((a, b) => b.sc - a.sc).slice(0, 12);
}
function renderMine(v) {
  const me = App.me.id, mine = App.marks.filter(m => m.user_id === me && App.bookMap.has(m.book_id));
  const by = k => mine.filter(m => m.status === k).map(m => App.bookMap.get(m.book_id));
  const rated = mine.filter(m => +m.rating).sort((a, b) => b.rating - a.rating);
  const rec = recommend();
  let h = `<h2>${esc(App.me.name)}</h2>
  <div class="stat"><div><b>${by('read').length + by('liked').length + by('disliked').length}</b><span>прочитано</span></div><div><b>${by('liked').length}</b><span>понравилось</span></div><div><b>${by('want').length}</b><span>хочу прочитать</span></div></div>
  <h3>Что почитать дальше</h3>${rec.length ? `<ul class="list">${rec.map(r => rowHTML(r.b, esc(placeShort(r.b.id))).replace('</div></div>', `</div>${r.why.length ? `<div class="mut" style="font-size:13px">${esc(r.why.slice(0, 2).join('; '))}</div>` : ''}</div>`)).join('')}</ul>` : '<p class="mut">Отметь несколько книг «понравилось» или поставь оценки — и здесь появятся подборки из вашей библиотеки.</p>'}`;
  for (const [k, l] of [['want', 'Хочу прочитать'], ['liked', 'Понравилось'], ['read', 'Прочитано'], ['disliked', 'Не понравилось']]) { const L = by(k); if (L.length) h += `<h3>${l}</h3><ul class="list">${L.map(b => rowHTML(b)).join('')}</ul>`; }
  if (rated.length) h += `<h3>Мои оценки</h3><ul class="list">${rated.map(m => rowHTML(App.bookMap.get(m.book_id), `<b style="color:var(--hot)">${m.rating}</b>/10`)).join('')}</ul>`;
  v.innerHTML = h;
}

/* ================= ЕЩЁ ================= */
function renderMore(v) {
  const cloud = App.store.mode === 'cloud';
  v.innerHTML = `<h2>Ещё</h2><ul class="list">
  <li class="click" data-act="go" data-v="collections"><div><div class="t">Собрания сочинений</div><div class="mut">${App.collections.length} шт.</div></div><span class="r">›</span></li>
  ${App.me.is_owner && cloud ? `<li class="click" data-act="go" data-v="users"><div><div class="t">Пользователи и права</div><div class="mut">${App.profiles.length} чел.</div></div><span class="r">›</span></li>` : ''}
  ${can('setup') ? `<li class="click" data-act="go" data-v="settings"><div><div class="t">Шкафы, жанры, запас места</div></div><span class="r">›</span></li>` : ''}
  </ul>
  <div class="card"><h3 style="margin-top:0">Моё имя</h3><div class="row"><input id="myName" class="grow" value="${esc(App.me.name)}"><button class="btn" data-act="saveName">Сохранить</button></div></div>
  ${App.me.is_owner && cloud ? `<div class="card"><h3 style="margin-top:0">Пригласить семью</h3><p class="mut">Отправь эту ссылку. Человек откроет её, зарегистрируется, а ты выдашь ему права в «Пользователях».</p><input readonly id="invite" value="${esc(inviteLink())}"><button class="btn ghost w100" style="margin-top:8px" data-act="copyInvite">Скопировать ссылку</button></div>` : ''}
  <div class="card"><h3 style="margin-top:0">Резервная копия</h3><p class="mut">Весь каталог одним файлом: книги, собрания, отметки, шкафы, расстановка. Сохраняйте время от времени.</p>
  <button class="btn ghost w100" data-act="export">Скачать копию</button>
  ${App.me.is_owner ? `<label class="btn ghost w100" style="margin-top:8px" for="importF">Загрузить копию</label><input id="importF" class="hidefile" type="file" accept=".json,application/json">` : ''}</div>
  <div class="card"><p class="mut" style="margin-top:0">База: ${cloud ? 'общая (Supabase)' : 'только этот телефон'}</p>
  ${cloud ? '<button class="btn ghost w100" data-act="logout">Выйти</button>' : ''}<button class="btn ghost w100" style="margin-top:8px" data-act="resetCfg">Подключить другую базу</button></div>`;
}
function inviteLink() { const c = LS.get('lib.cfg') || {}; return location.origin + location.pathname + '#connect=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify({ url: c.url, key: c.key }))))); }

function renderCollections(v) {
  const cols = App.collections.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  v.innerHTML = `<div class="row"><button class="btn ghost sm" data-act="go" data-v="more">‹ Назад</button></div><h2>Собрания сочинений</h2>
  ${can('scan') || can('edit') ? `<div class="card"><b>Новое собрание</b><label class="f">Название<input id="cName" placeholder="Собрание сочинений Л. Н. Толстого"></label><div class="grid2"><label class="f">Автор<input id="cAuthor"></label><label class="f">Всего томов<input id="cTotal" inputmode="numeric"></label></div><label class="f">Жанр<select id="cGenre">${genreOptions('', true)}</select></label><button class="btn w100" style="margin-top:10px" data-act="addCol">Создать</button></div>` : ''}
  <ul class="list">${cols.map(c => { const n = App.books.filter(b => b.collection_id === c.id).length; return `<li class="click" data-act="col" data-id="${c.id}"><div><div class="t">${esc(c.name)}</div><div class="mut">${esc(c.author || '')}${c.genre && gById(c.genre) ? ' · ' + esc(gById(c.genre).name) : ''}</div></div><span class="r">${n}${c.total ? ' из ' + c.total : ''} т.</span></li>`; }).join('') || '<li><span class="mut">Собраний пока нет. Их можно создавать прямо при сканировании.</span></li>'}</ul>`;
}
function openCol(id) {
  const c = App.colMap.get(id); if (!c) return;
  const vols = App.books.filter(b => b.collection_id === id).sort((a, b) => (+a.volume || 0) - (+b.volume || 0));
  const have = new Set(vols.map(b => +b.volume).filter(Boolean));
  const missing = c.total ? Array.from({ length: c.total }, (_, i) => i + 1).filter(n => !have.has(n)) : [];
  openModal(`<h2 style="padding-right:48px">${esc(c.name)}</h2><p class="mut">${esc(c.author || '')}${c.total ? ` · ${vols.length} из ${c.total} томов` : ''}</p>
  ${missing.length ? `<p class="note">Не хватает томов: ${missing.join(', ')}</p>` : ''}
  <ul class="list">${vols.map(b => rowHTML(b)).join('') || '<li><span class="mut">Томов пока нет</span></li>'}</ul>
  ${can('scan') ? `<button class="btn w100" style="margin-top:12px" data-act="scanIntoCol" data-id="${id}">Добавить том</button>` : ''}
  ${can('edit') ? `<details><summary>Изменить собрание</summary><label class="f">Название<input id="ecName" value="${esc(c.name)}"></label><div class="grid2"><label class="f">Автор<input id="ecAuthor" value="${esc(c.author || '')}"></label><label class="f">Всего томов<input id="ecTotal" inputmode="numeric" value="${esc(c.total || '')}"></label></div><label class="f">Жанр<select id="ecGenre">${genreOptions(c.genre, true)}</select></label>
  <div class="row" style="margin-top:10px"><button class="btn grow" data-act="saveCol" data-id="${id}">Сохранить</button><button class="btn ghost" data-act="delCol" data-id="${id}">Удалить</button></div><p class="mut">При удалении собрания книги остаются в каталоге.</p></details>` : ''}`);
}

function renderUsers(v) {
  v.innerHTML = `<div class="row"><button class="btn ghost sm" data-act="go" data-v="more">‹ Назад</button></div><h2>Пользователи и права</h2>
  <p class="mut">Отмечать прочитанное и ставить оценки может каждый. Остальные права выдаёшь ты.</p>
  ${App.profiles.map(p => `<div class="card"><div class="row"><div class="grow"><b>${esc(p.name)}</b><div class="mut">${esc(p.email || '')}</div></div>${p.is_owner ? '<span class="chip">главный</span>' : ''}</div>
  ${p.is_owner ? '<p class="mut" style="margin-bottom:0">Все права.</p>' : PERMS.map(([k, l]) => `<label class="perm"><input type="checkbox" data-perm="${k}" data-u="${p.id}"${p.perms && p.perms[k] ? ' checked' : ''}>${l}</label>`).join('') + `<button class="btn ghost sm" data-act="allPerms" data-u="${p.id}">Дать все права</button> <button class="btn ghost sm" data-act="makeOwner" data-u="${p.id}">Сделать главным тоже</button>`}</div>`).join('')}`;
}

function renderSettings(v) {
  const st = App.st;
  v.innerHTML = `<div class="row"><button class="btn ghost sm" data-act="go" data-v="more">‹ Назад</button></div><h2>Настройки</h2>
  <div class="card"><h3 style="margin-top:0">Запас места: <span id="resV">${st.reserve}</span>%</h3><p class="mut">Сколько места на каждой полке оставлять свободным под новые книги.</p><input type="range" min="0" max="30" value="${st.reserve}" id="reserve" style="padding:0;border:0">
  <label class="f">Два ряда на глубоких полках<select id="rowsMode"><option value="auto"${st.rows === 'auto' ? ' selected' : ''}>Автоматически — когда не хватает места</option><option value="always"${st.rows === 'always' ? ' selected' : ''}>Всегда</option><option value="never"${st.rows === 'never' ? ' selected' : ''}>Никогда</option></select></label>
  <label class="f">Ширина боковых брусков, см<input id="edge" inputmode="decimal" value="${st.edge || 3}"></label>
  <p class="mut">После изменений нажми Шкафы → «Перераспределить», чтобы применить.</p></div>
  <div class="card"><h3 style="margin-top:0">Жанры</h3><p class="mut">Порядок жанров = порядок по шкафам; соседние по смыслу ставь рядом. Во втором поле — номера шкафов, к которым жанр привязан (например, манга → 1).</p>
  ${st.genres.map(g => `<div class="gl"><span class="dot" style="background:${g.color}"></span><input data-gf="name" data-g="${g.id}" value="${esc(g.name)}" aria-label="Название жанра"><input data-gf="pin" data-g="${g.id}" placeholder="шкаф" value="${esc((g.pin || []).map(x => x.slice(1)).join(','))}" aria-label="Привязка к шкафам"><button class="ib" data-act="gMove" data-g="${g.id}" data-d="-1" aria-label="Выше">↑</button><button class="ib" data-act="gMove" data-g="${g.id}" data-d="1" aria-label="Ниже">↓</button><button class="ib hide" data-act="gDel" data-g="${g.id}" aria-label="Удалить">×</button></div>`).join('')}
  <div class="row" style="margin-top:8px"><input id="gNew" class="grow" placeholder="Новый жанр"><select id="gNewGroup" class="grow">${[...new Set(st.genres.map(g => g.group))].map(x => `<option>${esc(x)}</option>`).join('')}</select><button class="btn" data-act="gAdd">Добавить</button></div></div>
  <div class="card"><h3 style="margin-top:0">Шкафы</h3><p class="mut">Размеры в см. Полки считаются сверху вниз. «Уровень глаз» — номера полок через запятую.</p>
  ${st.cabinets.map((c, ci) => `<details><summary>${esc(c.name)} — ${c.shelves.length} пол., высота ${c.h2} (${c.h1} у брусков)</summary>
  <div class="grid3"><label class="f">Высота H2<input data-c="${ci}" data-ck="h2" inputmode="decimal" value="${c.h2}"></label><label class="f">У брусков H1<input data-c="${ci}" data-ck="h1" inputmode="decimal" value="${c.h1}"></label><label class="f">Уровень глаз<input data-c="${ci}" data-ck="eye" value="${(c.eye || []).join(',')}"></label></div>
  <div class="shr mut"><span></span><span>длина</span><span>глубина</span></div>
  ${c.shelves.map((s, si) => `<div class="shr"><span>Полка ${si + 1}${s.note ? ' (' + esc(s.note) + ')' : ''}</span><input data-c="${ci}" data-s="${si}" data-k="len" inputmode="decimal" value="${s.len}" aria-label="Длина"><input data-c="${ci}" data-s="${si}" data-k="depth" inputmode="decimal" value="${s.depth}" aria-label="Глубина"></div>`).join('')}
  <div class="row" style="margin:6px 0 10px"><button class="btn ghost sm" data-act="shAdd" data-c="${ci}">+ полка</button><button class="btn ghost sm" data-act="shDel" data-c="${ci}">− полка</button></div></details>`).join('')}</div>`;
}

/* ================= действия ================= */
async function withBtn(t, fn) { if (t) t.disabled = true; try { await fn(); } catch (e) { fail(e); } finally { if (t && document.contains(t)) t.disabled = false; } }
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
async function setMarkVal(id, patch) {
  const cur = myMark(id); const m = { status: cur.status || null, rating: cur.rating || null };
  Object.assign(m, patch);
  await App.store.setMark(id, m);
  App.marks = App.marks.filter(x => !(x.book_id === id && x.user_id === App.me.id));
  if (m.status || m.rating) App.marks.push({ user_id: App.me.id, book_id: id, status: m.status, rating: m.rating });
}
async function pinBooks(changes) {
  // changes: [{id, pin}]
  const gids = [];
  for (const c of changes) { const b = App.bookMap.get(c.id); if (!b) continue; await App.store.updateBook(c.id, { pin: c.pin }); b.pin = c.pin; gids.push(b.genre); }
  const sm = shelfMap(); const zm = {}; for (const g in (App.layout.zones || {})) (App.layout.zones[g] || []).forEach(s => zm[s] = g);
  changes.forEach(c => { if (c.pin && zm[c.pin.sid]) gids.push(zm[c.pin.sid]); });
  void sm;
  const moves = await replace(gids); index(); return moves;
}

const ACT = {
  tab: t => { App.view = t.dataset.v; if (App.view !== 'scan' && App.scan && App.scan.stage === 'done') App.scan = null; render(); scrollTo(0, 0); },
  go: t => { App.view = t.dataset.v; render(); scrollTo(0, 0); },
  close: closeModal,
  refresh: t => withBtn(t, async () => { await reload(); shell(); render(); toast('Обновлено'); }),
  cfgCloud: () => { const url = $('#cfgUrl').value.trim().replace(/\/+$/, ''), key = $('#cfgKey').value.trim(); if (!/^https:\/\/.+/.test(url) || key.length < 20) return toast('Проверь адрес и ключ'); LS.set('lib.cfg', { mode: 'cloud', url, key }); boot(); },
  cfgLocal: () => { LS.set('lib.cfg', { mode: 'local' }); boot(); },
  resetCfg: async () => { if (App.store && App.store.mode === 'cloud') await App.store.signOut().catch(() => {}); LS.del('lib.cfg'); closeModal(); gateSetup(); },
  toUp: () => gateAuth('up'), toIn: () => gateAuth('in'),
  logout: async () => { await App.store.signOut(); gateAuth('in'); },
  // сканер
  manual: () => { App.scan = { stage: 'form', d: blank(), target: 'title' }; render(); },
  scanCancel: () => { App.scan = null; render(); },
  scanNext: () => { App.scan = null; render(); setTimeout(() => { const c = $('#cam'); if (c) c.click(); }, 50); },
  rot: t => withBtn(t, async () => { const s = App.scan; s.canvas = rotate(s.canvas, +t.dataset.d); s.img = s.canvas.toDataURL('image/jpeg', 0.7); await runOcr(s.canvas); }),
  chip: t => { const s = App.scan, line = s.lines[+t.dataset.i]; const f = s.target === 'author' ? 'author' : 'title'; const nice = line === line.toUpperCase() ? (f === 'author' ? capWords(line) : sentence(line)) : line; s.d[f] = s.d[f] && s.chipAppend === f ? s.d[f] + ' ' + nice : nice; s.chipAppend = f; const inp = $(`.sf[data-f="${f}"]`); if (inp) inp.value = s.d[f]; },
  lookup: t => withBtn(t, lookup),
  takeCand: t => { applyCand(App.scan.cands[+t.dataset.i]); App.scan.cands = null; render(); toast('Данные подставлены — проверь'); },
  look: t => { App.scan.d.look = t.dataset.k; t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t)); },
  sStatus: t => { const d = App.scan.d; d.status = d.status === t.dataset.k ? '' : t.dataset.k; t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === d.status)); },
  sRate: t => { const d = App.scan.d; d.rating = +d.rating === +t.dataset.r ? 0 : +t.dataset.r; t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.r === +d.rating)); },
  saveScan: t => withBtn(t, async () => {
    const d = App.scan.d;
    if (!d.title.trim()) return toast('Впиши название');
    if (!d.genre) return toast('Выбери жанр');
    const row = await saveBookFrom(d);
    App.books.push(row); index();
    if (d.status || d.rating) await setMarkVal(row.id, { status: d.status || null, rating: d.rating || null });
    const moves = await replace([row.genre]); index();
    App.scan = { stage: 'done', id: row.id, moves }; render(); scrollTo(0, 0);
  }),
  scanIntoCol: t => { const c = App.colMap.get(t.dataset.id); closeModal(); App.view = 'scan'; App.scan = { stage: 'form', d: Object.assign(blank(), { collection_id: c.id, author: c.author || '', genre: c.genre || '' }), target: 'title' }; render(); },
  // каталог
  more: () => { App.catLimit += 300; fillCat(); },
  book: t => openBook(t.dataset.id),
  mark: t => withBtn(null, async () => { const id = t.dataset.id, cur = myMark(id).status; await setMarkVal(id, { status: cur === t.dataset.s ? null : t.dataset.s }); const now = myMark(id).status; t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s === now)); }),
  rate: t => withBtn(null, async () => { const id = t.dataset.id, cur = +myMark(id).rating; await setMarkVal(id, { rating: cur === +t.dataset.r ? null : +t.dataset.r }); const now = +myMark(id).rating; t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.r === now)); }),
  eLook: t => { editD.look = t.dataset.k; t.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t)); },
  saveEdit: t => withBtn(t, async () => {
    const id = t.dataset.id, old = App.bookMap.get(id);
    const row = await saveBookFrom(editD, id);
    Object.assign(old, row); index();
    const moves = await replace([old.genre, row.genre].concat(editD.genre !== old.genre ? [editD.genre] : [])); index();
    openBook(id); if (moves.length) $('#sheet').insertAdjacentHTML('beforeend', movesHTML(moves)); toast('Сохранено');
  }),
  delBook: t => { if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = 'Точно удалить?'; t.classList.add('warn'); return; } withBtn(t, async () => { const b = App.bookMap.get(t.dataset.id); await App.store.deleteBook(b.id); App.books = App.books.filter(x => x.id !== b.id); App.marks = App.marks.filter(m => m.book_id !== b.id); index(); await replace([b.genre]); index(); closeModal(); render(); toast('Удалено'); }); },
  pinSet: t => withBtn(t, async () => { const id = t.dataset.id; const pin = { sid: $('#pinS').value, row: $('#pinR').value, i: Math.max(0, (parseInt($('#pinI').value) || 1) - 1) }; const moves = await pinBooks([{ id, pin }]); openBook(id); if (moves.length) $('#sheet').insertAdjacentHTML('beforeend', movesHTML(moves)); toast('Место закреплено'); }),
  pinOff: t => withBtn(t, async () => { await pinBooks([{ id: t.dataset.id, pin: null }]); openBook(t.dataset.id); toast('Закрепление снято'); }),
  // шкафы
  shelf: t => openShelf(t.dataset.sid),
  arrange: showPlan,
  applyPlan: t => withBtn(t, async () => { App.layout = plan; await saveLayout(); plan = null; closeModal(); render(); toast('Расстановка сохранена'); }),
  mv: t => withBtn(t, async () => {
    const sid = t.dataset.sid, row = t.dataset.row, i = +t.dataset.i, d = +t.dataset.d;
    const r = App.layout.shelves[sid]; const arr = (row === 'b' ? r.b : r.f).slice(); const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    await pinBooks(arr.map((id, k) => ({ id, pin: { sid, row, i: k } })));
    openShelf(sid);
  }),
  unpinShelf: t => withBtn(t, async () => { const r = App.layout.shelves[t.dataset.sid] || { f: [], b: [] }; const ids = r.f.concat(r.b).filter(id => (App.bookMap.get(id) || {}).pin); await pinBooks(ids.map(id => ({ id, pin: null }))); openShelf(t.dataset.sid); toast('Закрепление снято'); }),
  // собрания
  col: t => openCol(t.dataset.id),
  addCol: t => withBtn(t, async () => { const name = $('#cName').value.trim(); if (!name) return toast('Впиши название'); const c = await App.store.insertCollection({ name, author: $('#cAuthor').value.trim(), total: num($('#cTotal').value), genre: $('#cGenre').value || null }); App.collections.push(c); index(); render(); toast('Собрание создано'); }),
  saveCol: t => withBtn(t, async () => { const id = t.dataset.id; const p = { name: $('#ecName').value.trim() || 'Собрание', author: $('#ecAuthor').value.trim(), total: num($('#ecTotal').value), genre: $('#ecGenre').value || null }; await App.store.updateCollection(id, p); Object.assign(App.colMap.get(id), p); closeModal(); render(); toast('Сохранено'); }),
  delCol: t => { if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = 'Точно удалить?'; t.classList.add('warn'); return; } withBtn(t, async () => { const id = t.dataset.id; await App.store.deleteCollection(id); App.collections = App.collections.filter(c => c.id !== id); App.books.forEach(b => { if (b.collection_id === id) b.collection_id = null; }); index(); closeModal(); render(); }); },
  // пользователи
  allPerms: t => withBtn(t, async () => { const p = App.profiles.find(x => x.id === t.dataset.u); const perms = Object.fromEntries(PERMS.map(([k]) => [k, true])); await App.store.updateProfile(p.id, { perms }); p.perms = perms; render(); toast('Права выданы'); }),
  makeOwner: t => { if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = 'Точно? У него будут все права, включая выдачу прав'; t.classList.add('warn'); return; } withBtn(t, async () => { const p = App.profiles.find(x => x.id === t.dataset.u); await App.store.updateProfile(p.id, { is_owner: true }); p.is_owner = true; render(); }); },
  saveName: t => withBtn(t, async () => { const n = $('#myName').value.trim(); if (!n) return; await App.store.updateProfile(App.me.id, { name: n }); App.me.name = n; const p = App.profiles.find(x => x.id === App.me.id); if (p) p.name = n; shell(); render(); toast('Сохранено'); }),
  copyInvite: async () => { try { await navigator.clipboard.writeText(inviteLink()); toast('Ссылка скопирована'); } catch (e) { $('#invite').select(); toast('Выдели и скопируй ссылку'); } },
  export: () => { download(`библиотека-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'home-library', version: 1, date: new Date().toISOString(), settings: App.st, layout: App.layout, books: App.books, collections: App.collections, marks: App.marks, profiles: App.profiles.map(p => ({ id: p.id, name: p.name })) }, null, 1)); },
  // настройки
  gMove: t => { const a = App.st.genres, i = a.findIndex(g => g.id === t.dataset.g), j = i + +t.dataset.d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; saveSettings().catch(fail); render(); },
  gDel: t => { const id = t.dataset.g; if (App.books.some(b => b.genre === id)) return toast('В жанре есть книги — сначала перенеси их'); App.st.genres = App.st.genres.filter(g => g.id !== id); saveSettings().catch(fail); render(); },
  gAdd: () => { const n = $('#gNew').value.trim(); if (!n) return; const g = { id: 'g' + Date.now().toString(36), name: n, group: $('#gNewGroup').value, color: E.PAL[App.st.genres.length % E.PAL.length], pin: [] }; const last = App.st.genres.map(x => x.group).lastIndexOf(g.group); App.st.genres.splice(last + 1, 0, g); saveSettings().catch(fail); render(); },
  shAdd: t => { const c = App.st.cabinets[+t.dataset.c]; const l = c.shelves[c.shelves.length - 1] || { len: 80, depth: 27 }; c.shelves.push({ len: l.len, depth: l.depth }); saveSettings().catch(fail); render(); },
  shDel: t => { const c = App.st.cabinets[+t.dataset.c]; if (c.shelves.length > 1) { c.shelves.pop(); saveSettings().catch(fail); render(); } }
};

document.addEventListener('click', e => { const t = e.target.closest('[data-act]'); if (!t) return; const f = ACT[t.dataset.act]; if (f) { e.preventDefault(); f(t, e); } });
document.addEventListener('focusin', e => { const t = e.target; if (t.classList && t.classList.contains('sf') && App.scan && (t.dataset.f === 'title' || t.dataset.f === 'author')) { if (App.scan.target !== t.dataset.f) App.scan.chipAppend = null; App.scan.target = t.dataset.f; } });
document.addEventListener('input', e => {
  const t = e.target;
  if (t.classList.contains('sf') && App.scan) { App.scan.d[t.dataset.f] = t.value; if (t.dataset.f === 'title' || t.dataset.f === 'author') App.scan.chipAppend = null; }
  if (t.classList.contains('ef') && editD) editD[t.dataset.f] = t.value;
  if (t.id === 'q') { catQ = t.value; App.catLimit = 150; fillCat(); }
  if (t.id === 'findQ') { const q = E.norm(t.value); $('#findRes').innerHTML = q.length < 2 ? '' : App.books.filter(b => (E.norm(b.title) + ' ' + E.norm(b.author)).includes(q)).slice(0, 20).map(b => rowHTML(b)).join(''); }
  if (t.id === 'reserve') $('#resV').textContent = t.value;
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'cam' || t.id === 'gal') { processPhoto(t.files[0]); t.value = ''; }
  if (t.classList.contains('sf') && t.dataset.f === 'collection_id') { if (t.value === '__new') newColForm(); else { const b = $('#newCol'); if (b) b.innerHTML = ''; const c = App.colMap.get(t.value); if (c && App.scan) { if (!App.scan.d.author && c.author) { App.scan.d.author = c.author; } if (c.genre) App.scan.d.genre = c.genre; render(); } } }
  if (t.id === 'gf') { catG = t.value; App.catLimit = 150; fillCat(); }
  if (t.id === 'cf') { catC = t.value; App.catLimit = 150; fillCat(); }
  if (t.dataset.perm) { const p = App.profiles.find(x => x.id === t.dataset.u); const perms = Object.assign({}, p.perms || {}, { [t.dataset.perm]: t.checked }); App.store.updateProfile(p.id, { perms }).then(() => { p.perms = perms; toast('Права обновлены'); }).catch(er => { fail(er); t.checked = !t.checked; }); }
  if (t.id === 'reserve') { App.st.reserve = +t.value; saveSettings().catch(fail); }
  if (t.id === 'rowsMode') { App.st.rows = t.value; saveSettings().catch(fail); }
  if (t.id === 'edge') { const x = num(t.value); if (x) { App.st.edge = x; saveSettings().catch(fail); } }
  if (t.dataset.gf) { const g = gById(t.dataset.g); if (!g) return; if (t.dataset.gf === 'name') g.name = t.value.trim() || g.name; else g.pin = t.value.split(/[^0-9]+/).filter(Boolean).map(n => 'c' + n).filter(id => App.st.cabinets.some(c => c.id === id)); saveSettings().catch(fail); }
  if (t.dataset.ck) { const c = App.st.cabinets[+t.dataset.c]; if (t.dataset.ck === 'eye') c.eye = t.value.split(/[^0-9]+/).filter(Boolean).map(Number); else { const x = num(t.value); if (x) c[t.dataset.ck] = x; } saveSettings().catch(fail); }
  if (t.dataset.k && t.dataset.c != null && t.dataset.s != null) { const s = App.st.cabinets[+t.dataset.c].shelves[+t.dataset.s]; const x = num(t.value); if (x) { s[t.dataset.k] = x; saveSettings().catch(fail); } }
  if (t.id === 'importF' && t.files[0]) {
    const f = t.files[0]; t.value = '';
    f.text().then(async txt => { const d = JSON.parse(txt); if (d.app !== 'home-library') throw new Error('Это не файл библиотеки'); await App.store.importAll(d); await reload(); render(); toast('Копия загружена'); }).catch(fail);
  }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && App.store && App.store.mode === 'cloud' && App.me && Date.now() - App.loadedAt > 60000 && !App.scan && $('#modal').hidden) reload().then(render).catch(() => {}); });

boot().catch(fail);
})();
