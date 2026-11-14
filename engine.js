/* Движок расстановки книг. Чистые функции: работает и в браузере (window.Engine), и в node (module.exports). */
(function (root) {
  'use strict';
  const E = {};

  /* ---------- данные по умолчанию ---------- */
  const PAL = ['#8e5ea2','#2e7d5b','#c0563f','#3b6fb6','#b08a2e','#4a9d9c','#a2486b','#6d7f2a','#5a5fc4','#c27a2c','#3f8f5f','#d0476a','#7b5a3c','#2f86a8','#9b4fb8','#566b7d','#b5534f','#4f7f3a','#80766a','#c4a23a','#3d6e8f','#a0522d','#6a5acd','#2e8b57','#cd5c5c','#4682b4','#9acd32','#d2691e','#708090','#b8860b','#5f9ea0','#8b4513'];
  E.PAL = PAL;

  E.GENRE_LIST = [
    ['Художественная', ['Русская классика', 'Зарубежная классика', 'Советская литература', 'Современная проза', 'Романы', 'Мелодрамы', 'Драматургия и поэзия', 'Детективы и триллеры', 'Приключения', 'Фантастика', 'Фэнтези', 'Манга и комиксы']],
    ['Детская', ['Детские сказки', 'Детские приключения', 'Детские рассказы', 'Для малышей', 'Раскраски и развивающие']],
    ['Нон-фикшн', ['История', 'Биографии и мемуары', 'Философия и психология', 'Религия и эзотерика', 'Наука и научпоп', 'Медицина', 'Экономика', 'Юриспруденция', 'Энциклопедии и справочники', 'Иностранные языки и словари', 'Путеводители', 'Кулинария', 'Хобби и рукоделие', 'Инженерия и автомобили', 'Прочее']]
  ];

  E.defaultSettings = function () {
    // h1 — высота у боковых брусков (по 3 см с каждого края), h2 — основная высота полки
    const mk = (n, len, depth, count, h1, h2, eye, last) => ({
      id: 'c' + n, name: 'П' + n, h1, h2, eye,
      shelves: Array.from({ length: count }, (_, i) => Object.assign({ len, depth }, (last && i === count - 1) ? last : {}))
    });
    const pipe = { depth: 27, note: 'труба' };
    const E9 = [5, 6, 7, 8];
    const cabinets = [
      mk(1, 74.5, 13.2, 6, 22.5, 24.5, [5, 6]),
      mk(2, 79.5, 27, 9, 22.3, 25, E9),
      mk(3, 79.5, 41.5, 9, 22.5, 25, E9),
      mk(4, 79.5, 41.5, 9, 22.5, 25, E9),
      mk(5, 96, 41.5, 9, 22, 24.3, E9),
      mk(6, 70, 27, 9, 22, 24.8, E9),
      mk(7, 90, 27, 3, 22, 24.8, []),
      mk(8, 101, 27, 9, 22, 24, E9),
      mk(9, 27, 41, 9, 23, 25.2, E9, pipe),
      mk(10, 80, 41, 9, 22, 24.3, E9, pipe),
      mk(11, 80, 41, 9, 22, 24.3, E9, pipe)
    ];
    let k = 0;
    const genres = [];
    E.GENRE_LIST.forEach(([group, names]) => names.forEach(name => {
      genres.push({ id: 'g' + String(++k).padStart(2, '0'), name, group, color: PAL[(k - 1) % PAL.length], pin: name === 'Манга и комиксы' ? ['c1'] : [] });
    }));
    return { cabinets, genres, reserve: 10, rows: 'auto', edge: 3 };
  };

  /* ---------- помощники ---------- */
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
  E.norm = norm;
  // фамилия: убираем инициалы; «Фамилия, Имя» → первое слово; «Имя Фамилия» → последнее
  E.authorKey = function (a) {
    const raw = String(a || '').split(/[;\/]| и /)[0];
    if (/,/.test(raw)) return norm(raw.split(',')[0]);
    const w = norm(raw).split(' ').filter(x => x.length > 2);
    if (!w.length) return norm(raw);
    if (w.length === 1) return w[0];
    const initialsFirst = /^\s*[A-ZА-ЯЁ]\.\s*/.test(raw);
    const initialsLast = /[A-ZА-ЯЁ]\.\s*$/.test(raw.trim());
    if (initialsLast && !initialsFirst) return w[0];
    return w[w.length - 1];
  };
  E.thick = b => (+(b && b.thick) > 0 ? +b.thick : 3);
  E.width = b => (+(b && b.width) > 0 ? +b.width : 14);
  E.height = b => (+(b && b.height) > 0 ? +b.height : 21);
  // слишком высокие книги кладём плашмя: вдоль полки занимают свою высоту
  E.maxH = 25.2;
  E.lying = b => E.height(b) > E.maxH + 0.3;
  E.dims = b => E.lying(b) ? { t: E.height(b), w: E.width(b), h: E.thick(b) } : { t: E.thick(b), w: E.width(b), h: E.height(b) };

  E.seq = function (st) {
    const out = []; let n = 0;
    st.cabinets.forEach(c => {
      const eye = c.eye || [];
      const lo = eye.length ? Math.min(...eye) : Infinity, hi = eye.length ? Math.max(...eye) : -Infinity;
      c.shelves.forEach((sh, si) => {
        const num = si + 1;
        const cls = eye.includes(num) ? 'eye' : (eye.length && num > hi ? 'low' : 'high');
        out.push({ id: c.id + 's' + num, cab: c.id, cabName: c.name, num, len: +sh.len || 0, depth: +sh.depth || 0, h1: +sh.h1 || +c.h1 || 99, h2: +sh.h2 || +c.h2 || 99, note: sh.note || '', cls, n: n++, lo, hi });
      });
    });
    return out;
  };
  const cap = (s, st) => s.len * (1 - (+st.reserve || 0) / 100);
  const twoRowShelf = (s, two) => two && s.depth >= 34;

  /* сведения об отметках: marks = [{book_id,user_id,status,rating}] → Map id → {liked,disliked,want,read,avg} */
  E.markIndex = function (marks) {
    const m = new Map();
    (marks || []).forEach(x => {
      let o = m.get(x.book_id); if (!o) { o = { liked: 0, disliked: 0, want: 0, read: 0, sum: 0, cnt: 0 }; m.set(x.book_id, o); }
      if (x.status === 'liked') o.liked++; else if (x.status === 'disliked') o.disliked++; else if (x.status === 'want') o.want++; else if (x.status === 'read') o.read++;
      if (+x.rating >= 1) { o.sum += +x.rating; o.cnt++; }
    });
    m.forEach(o => { o.avg = o.cnt ? o.sum / o.cnt : null; });
    return m;
  };
  E.bookInfo = function (b, mi) {
    const m = mi.get(b.id) || { liked: 0, disliked: 0, want: 0, read: 0, avg: null };
    const r = m.avg;
    const pos = m.liked > m.disliked || (r !== null && r >= 7);
    const neg = m.disliked > m.liked || (r !== null && r <= 4);
    const tier = pos ? 1 : (m.want && !neg ? 2 : 3);
    const score = (r === null ? 5.5 : r) + 2 * (m.liked - m.disliked) + (m.want ? 0.5 : 0);
    const front = (b.look === 'beautiful' ? 3 : b.look === 'worn' ? -3 : 0) + (tier === 1 ? 2 : tier === 2 ? 1 : 0) + (neg ? -2 : 0) + score / 10;
    return { tier, score, front };
  };

  /* порядок книг внутри жанра: группы авторов (собрание впереди, затем остальные книги автора) */
  E.orderGenre = function (list, ctx) {
    const groups = new Map();
    for (const b of list) {
      const col = b.collection_id && ctx.collections.get(b.collection_id);
      const key = b.author_key || E.authorKey(col && col.author || b.author) || ('~' + norm(b.title));
      let g = groups.get(key); if (!g) { g = { key, books: [], tier: 3, score: -99 }; groups.set(key, g); }
      const inf = E.bookInfo(b, ctx.mi);
      g.books.push(b); g.tier = Math.min(g.tier, inf.tier); g.score = Math.max(g.score, inf.score);
    }
    const colName = b => { const c = b.collection_id && ctx.collections.get(b.collection_id); return c ? norm(c.name) : null; };
    const gs = [...groups.values()];
    gs.forEach(g => g.books.sort((a, b) => {
      const ca = colName(a), cb = colName(b);
      if (ca && !cb) return -1; if (!ca && cb) return 1;
      if (ca && cb && ca !== cb) return ca.localeCompare(cb, 'ru');
      if (ca && cb) return (+a.volume || 0) - (+b.volume || 0) || norm(a.title).localeCompare(norm(b.title), 'ru');
      return norm(a.title).localeCompare(norm(b.title), 'ru');
    }));
    gs.sort((a, b) => a.tier - b.tier || b.score - a.score || a.key.localeCompare(b.key, 'ru'));
    return gs;
  };

  const PREF = { 1: ['eye', 'low', 'high'], 2: ['low', 'eye', 'high'], 3: ['high', 'low', 'eye'] };

  /* раскладка одного жанра по полкам его зоны */
  E.fillZone = function (gid, zoneIds, ctx) {
    const { st, byId, two } = ctx;
    const shelves = zoneIds.map(id => byId[id]).filter(Boolean).sort((a, b) => a.n - b.n);
    const list = ctx.books.filter(b => b.genre === gid);
    const pinned = list.filter(b => b.pin && byId[b.pin.sid]);
    const free = list.filter(b => !(b.pin && byId[b.pin.sid]));
    const state = {};
    const rowsOf = s => twoRowShelf(s, two) ? 2 : 1;
    const ensure = s => state[s.id] || (state[s.id] = { ids: [], used: 0, tall: 0 });
    // закреплённые книги занимают место заранее
    const allPinned = ctx.books.filter(b => b.pin && byId[b.pin.sid] && zoneIds.includes(b.pin.sid));
    for (const b of allPinned) { const s = byId[b.pin.sid]; const o = ensure(s); const d = E.dims(b); o.used += d.t; if (d.h > s.h1) o.tall += d.t; }
    const fits = (b, s) => {
      const d = E.dims(b), t = d.t, w = d.w, h = d.h, o = ensure(s), rows = rowsOf(s);
      if (w > s.depth + 0.5 || h > s.h2 + 0.3) return false;
      if (o.used + t > cap(s, st) * rows && !(o.used === 0 && t <= s.len)) return false;
      if (h > s.h1 && o.tall + t > Math.max(0, (s.len - 2 * (+st.edge || 3))) * (1 - (+st.reserve || 0) / 100) * rows) return false;
      return true;
    };
    const dimOk = (b, s) => E.dims(b).w <= s.depth + 0.5 && E.dims(b).h <= s.h2 + 0.3;
    const over = [];
    const groups = E.orderGenre(free, ctx);
    const tiers = { 1: [], 2: [], 3: [] };
    groups.forEach(g => tiers[g.tier].push(g));
    for (const t of [1, 2, 3]) {
      const order = [];
      PREF[t].forEach(cls => shelves.filter(s => s.cls === cls).forEach(s => order.push(s)));
      let p = 0;
      for (const g of tiers[t]) for (const b of g.books) {
        let done = false;
        for (let j = p; j < order.length; j++) {
          const s = order[j];
          if (!fits(b, s)) continue;
          const o = ensure(s), d = E.dims(b); o.ids.push(b.id); o.used += d.t; if (d.h > s.h1) o.tall += d.t;
          if (j > p && dimOk(b, order[p])) p = j;
          done = true; break;
        }
        if (!done) over.push(b.id);
      }
    }
    // деление на передний и задний ряд + вставка закреплённых
    const out = {};
    for (const s of shelves) {
      const o = ensure(s);
      const auto = o.ids.map(id => ctx.bookMap.get(id));
      let f = [], bk = [];
      if (rowsOf(s) === 2) {
        const capRow = cap(s, st);
        const ranked = auto.slice().sort((a, b) => E.bookInfo(b, ctx.mi).front - E.bookInfo(a, ctx.mi).front);
        const pinF = allPinned.filter(b => b.pin.sid === s.id && b.pin.row !== 'b').reduce((a, b) => a + E.dims(b).t, 0);
        let usedF = pinF; const frontSet = new Set();
        for (const b of ranked) { const t = E.dims(b).t; if (usedF + t <= capRow || E.width(b) > s.depth - 14) { frontSet.add(b.id); usedF += t; } }
        auto.forEach(b => (frontSet.has(b.id) ? f : bk).push(b.id));
      } else f = auto.map(b => b.id);
      allPinned.filter(b => b.pin.sid === s.id).sort((a, b) => (+a.pin.i || 0) - (+b.pin.i || 0)).forEach(b => {
        const arr = (b.pin.row === 'b' && rowsOf(s) === 2) ? bk : f;
        arr.splice(Math.min(arr.length, Math.max(0, +b.pin.i || 0)), 0, b.id);
      });
      out[s.id] = { f, b: bk };
    }
    return { out, over };
  };

  function freeShelf(zones, all, exclude, near, minW, minH) {
    const used = new Set(exclude || []);
    Object.keys(zones).forEach(g => (zones[g] || []).forEach(id => used.add(id)));
    const ok = s => s && !used.has(s.id) && s.depth + 0.5 >= minW && s.h2 + 0.3 >= minH;
    if (near && near.length) {
      const idx = near.map(id => all.findIndex(s => s.id === id)).filter(i => i >= 0);
      const hi = Math.max(...idx), lo = Math.min(...idx);
      for (let d = 1; d < all.length; d++) { if (ok(all[hi + d])) return all[hi + d]; if (ok(all[lo - d])) return all[lo - d]; }
    }
    return all.find(ok) || null;
  }

  E.context = function (st, books, marks, collections, two) {
    const all = E.seq(st);
    return {
      st, all, two: !!two,
      byId: Object.fromEntries(all.map(s => [s.id, s])),
      books, bookMap: new Map(books.map(b => [b.id, b])),
      mi: E.markIndex(marks),
      collections: new Map((collections || []).map(c => [c.id, c]))
    };
  };

  E.needTwoRows = function (st, books) {
    if (st.rows === 'never') return false;
    if (st.rows === 'always') return true;
    const all = E.seq(st);
    const single = all.reduce((s, x) => s + cap(x, st), 0);
    const need = books.reduce((s, b) => s + E.dims(b).t, 0);
    return need > single * 0.9;
  };

  /* полная расстановка: зоны жанров идут подряд по шкафам (шкаф за шкафом, полки сверху вниз) */
  E.allocateAll = function (st, books, marks, collections) {
    const two = E.needTwoRows(st, books);
    const ctx = E.context(st, books, marks, collections, two);
    const all = ctx.all, zones = {}, used = new Set();
    const lists = {}; st.genres.forEach(g => lists[g.id] = books.filter(b => b.genre === g.id));
    const capOf = s => cap(s, st) * (twoRowShelf(s, two) ? 2 : 1);
    const need = g => lists[g.id].reduce((s, b) => s + E.dims(b).t, 0);
    const active = st.genres.filter(g => lists[g.id].length);
    // 1) жанры, привязанные к шкафам (например, манга → П1)
    for (const g of active.filter(g => g.pin && g.pin.length)) {
      let n = need(g); const z = [];
      for (const s of all.filter(s => g.pin.includes(s.cab))) { if (n <= 0) break; if (used.has(s.id)) continue; z.push(s.id); used.add(s.id); n -= capOf(s); }
      zones[g.id] = z;
    }
    // 2) остальные жанры делят оставшиеся полки пропорционально объёму, подряд по шкафам
    const rest = active.filter(g => !(g.pin && g.pin.length));
    const pool = all.filter(s => !used.has(s.id) && s.depth >= 15);
    const totalNeed = rest.reduce((a, g) => a + need(g), 0) || 1;
    const totalCap = pool.reduce((a, s) => a + capOf(s), 0);
    const scale = Math.max(1, totalCap / totalNeed);
    const cum = []; let c = 0; rest.forEach(g => { c += need(g) * scale; cum.push(c); });
    rest.forEach(g => zones[g.id] = []);
    let acc = 0, k = 0;
    for (const s of pool) {
      if (!rest.length) break;
      const m = acc + capOf(s) / 2;
      while (k < rest.length - 1 && cum[k] < m) k++;
      if (cum[k] < m && totalCap / totalNeed < 1) { acc += capOf(s); zones[rest[k].id].push(s.id); used.add(s.id); continue; }
      zones[rest[k].id].push(s.id); used.add(s.id); acc += capOf(s);
    }
    // у каждого жанра хотя бы одна полка: забираем крайнюю у соседа, где полок больше
    rest.forEach((g, i) => {
      if (zones[g.id].length) return;
      const cand = [rest[i - 1], rest[i + 1]].filter(x => x && zones[x.id].length > 1).sort((a, b) => zones[b.id].length - zones[a.id].length)[0];
      if (!cand) return;
      const z = zones[cand.id]; const sid = rest.indexOf(cand) < i ? z.pop() : z.shift();
      zones[g.id] = [sid];
    });
    const shelves = {}; let over = [];
    for (const g of active) {
      let res;
      for (let k = 0; k < 80; k++) {
        res = E.fillZone(g.id, zones[g.id], ctx);
        if (!res.over.length) break;
        const ob = res.over.map(id => ctx.bookMap.get(id));
        const nx = freeShelf(zones, all, used, zones[g.id], Math.min(...ob.map(E.width)), Math.min(...ob.map(b => E.dims(b).h)));
        if (!nx) break;
        used.add(nx.id); zones[g.id] = [...zones[g.id], nx.id].sort((a, b) => ctx.byId[a].n - ctx.byId[b].n);
      }
      Object.assign(shelves, res.out); over = over.concat(res.over);
    }
    const known = new Set(st.genres.map(g => g.id));
    over = over.concat(books.filter(b => !known.has(b.genre)).map(b => b.id));
    const res = { phase: 'live', two, zones, shelves, over: over.filter(id => { const b = ctx.bookMap.get(id); return !(b && b.pin && ctx.byId[b.pin.sid]); }) };
    return E.fixPins(res, books, ctx.byId);
  };

  /* перерасчёт одного жанра в живой расстановке (новая книга, правка, удаление) */
  E.placeGenre = function (layout, gid, st, books, marks, collections) {
    const L = JSON.parse(JSON.stringify(layout || {}));
    L.zones = L.zones || {}; L.shelves = L.shelves || {}; L.over = L.over || [];
    const ctx = E.context(st, books, marks, collections, L.two);
    const list = books.filter(b => b.genre === gid);
    const inGenre = new Set(list.map(b => b.id));
    const oldPos = E.posIndex(layout);
    const valid = new Set(books.map(b => b.id));
    for (const sid in L.shelves) { const r = L.shelves[sid]; r.f = (r.f || []).filter(id => valid.has(id) && !inGenre.has(id)); r.b = (r.b || []).filter(id => valid.has(id) && !inGenre.has(id)); }
    L.over = L.over.filter(id => valid.has(id) && !inGenre.has(id));
    let z = (L.zones[gid] || []).filter(id => ctx.byId[id]);
    if (!list.length) { delete L.zones[gid]; return { layout: L, moves: [], over: [] }; }
    const others = {}; Object.keys(L.zones).forEach(k => { if (k !== gid) others[k] = L.zones[k]; });
    if (!z.length) {
      const g = st.genres.find(x => x.id === gid);
      const pinned = g && g.pin && g.pin.length ? ctx.all.filter(s => g.pin.includes(s.cab)) : [];
      const s = pinned.find(x => !Object.values(others).some(a => a.includes(x.id))) || freeShelf(others, ctx.all, [], null, Math.min(...list.map(E.width)), Math.min(...list.map(b => E.dims(b).h)));
      if (s) z = [s.id];
    }
    let res = { out: {}, over: list.map(b => b.id) };
    for (let k = 0; k < 80 && z.length; k++) {
      res = E.fillZone(gid, z, ctx);
      if (!res.over.length) break;
      const ob = res.over.map(id => ctx.bookMap.get(id));
      const nx = freeShelf(others, ctx.all, z, z, Math.min(...ob.map(E.width)), Math.min(...ob.map(b => E.dims(b).h)));
      if (!nx) break;
      z = [...z, nx.id].sort((a, b) => ctx.byId[a].n - ctx.byId[b].n);
    }
    L.zones[gid] = z;
    const pinnedOn = sid => new Set(books.filter(b => b.pin && b.pin.sid === sid).map(b => b.id));
    for (const sid of z) {
      const pp = pinnedOn(sid);
      const r0 = L.shelves[sid] || { f: [], b: [] };
      const r = { f: (r0.f || []).filter(id => !pp.has(id)), b: (r0.b || []).filter(id => !pp.has(id)) };
      const add = res.out[sid] || { f: [], b: [] };
      L.shelves[sid] = { f: r.f.concat(add.f), b: r.b.concat(add.b) };
    }
    L.over = L.over.concat(res.over.filter(id => { const b = ctx.bookMap.get(id); return !(b && b.pin && ctx.byId[b.pin.sid]); }));
    E.fixPins(L, books, ctx.byId);
    const newPos = E.posIndex(L);
    const moves = [];
    for (const b of list) { const o = oldPos.get(b.id), p = newPos.get(b.id); if (o && p && (o.sid !== p.sid || o.row !== p.row)) moves.push({ id: b.id, from: o, to: p }); }
    return { layout: L, moves, over: res.over };
  };

  /* закреплённые книги, которые не попали ни в одну зону, ставим прямо на их полку */
  E.fixPins = function (L, books, byId) {
    const pos = E.posIndex(L);
    for (const b of books) {
      if (!b.pin || !byId[b.pin.sid] || pos.has(b.id)) continue;
      const r = L.shelves[b.pin.sid] || (L.shelves[b.pin.sid] = { f: [], b: [] });
      const arr = b.pin.row === 'b' ? r.b : r.f;
      arr.splice(Math.min(arr.length, Math.max(0, +b.pin.i || 0)), 0, b.id);
      L.over = (L.over || []).filter(x => x !== b.id);
    }
    return L;
  };

  E.posIndex = function (layout) {
    const m = new Map(); const sh = (layout && layout.shelves) || {};
    for (const sid in sh) { (sh[sid].f || []).forEach((id, i) => m.set(id, { sid, row: 'f', i })); (sh[sid].b || []).forEach((id, i) => m.set(id, { sid, row: 'b', i })); }
    return m;
  };
  E.diff = function (oldL, newL) {
    const o = E.posIndex(oldL), n = E.posIndex(newL), out = [];
    n.forEach((p, id) => { const q = o.get(id); if (!q || q.sid !== p.sid || q.row !== p.row) out.push({ id, from: q || null, to: p }); });
    return out;
  };

  /* жанр по ключевым словам (подсказка, пользователь подтверждает) */
  const RU_CLASSIC = /пушкин|толст[оо]й|достоевск|чехов|гогол|тургенев|лермонтов|гончаров|лесков|бунин|куприн|островск|салтыков|некрасов|грибоедов|карамзин|крылов|тютчев|фет\b|андреев|герцен|писемск|аксаков|короленк/;
  const WORLD_CLASSIC = /диккенс|гюго|бальзак|дюма|шекспир|остин|твен|лондон|флобер|стендаль|гете|гёте|сервантес|золя|мопассан|бронте|теккерей|скотт|купер|дефо|свифт|гофман|гейне|байрон|ремарк|хемингуэй|фицджеральд|драйзер|голсуорси|мелвилл|по\b|верн/;
  const SOVIET = /шолохов|булгаков|паустовск|катаев|симонов|распутин|астафьев|фадеев|островский николай|ильф|петров|зощенко|платонов|пастернак|солженицын|шукшин|бондарев|васильев|айтматов|трифонов|абрамов|полевой|гайдар|горький|алексей толстой/;
  const RULES = [
    [/манга|комикс|manga/, 'Манга и комиксы'], [/раскраск|прописи|развивающ|наклейк/, 'Раскраски и развивающие'], [/для малышей|малыш|потешк|азбук/, 'Для малышей'],
    [/сказк/, 'Детские сказки'], [/кулинар|рецепт|выпечк|блюд/, 'Кулинария'], [/вязан|макраме|бисер|рукодел|вышив|шитье|шить|кройк/, 'Хобби и рукоделие'],
    [/автомоб|двигател|инженер|техник[аи]|ремонт|машиностро|электротех|черчен/, 'Инженерия и автомобили'], [/экономик|финанс|бизнес|бухгалт|менеджм|маркетинг/, 'Экономика'],
    [/кодекс|юрид|юриспруд|право|гражданск|уголовн|арбитраж|законодат/, 'Юриспруденция'], [/медицин|болезн|анатом|врач|лечени|здоровь|фармак|хирург/, 'Медицина'],
    [/словар|english|deutsch|francais|грамматик|английск|немецк|французск|испанск|иностранн/, 'Иностранные языки и словари'], [/путеводител|туризм|путешеств по/, 'Путеводители'],
    [/энциклопед|справочн/, 'Энциклопедии и справочники'], [/религ|библи|евангел|православ|ислам|буддизм|эзотер|астролог|магия чисел|таро|гороскоп/, 'Религия и эзотерика'],
    [/философ|психолог/, 'Философия и психология'], [/биограф|мемуар|воспоминан|жизнь замечательных/, 'Биографии и мемуары'],
    [/физик|химия|математ|биолог|астроном|научн|наука|геолог/, 'Наука и научпоп'], [/истори|войн[аы]|древн|средневек|империя|революц/, 'История'],
    [/фэнтези|дракон|эльф|волшебн|маг[аи]? /, 'Фэнтези'], [/фантаст|космос|звездол|робот/, 'Фантастика'], [/детектив|убийств|расследов|триллер|сыщик/, 'Детективы и триллеры'],
    [/приключен|пират|остров сокровищ/, 'Приключения'], [/стихотворен|стихи|поэм|поэз|пьес|драматург|лирик/, 'Драматургия и поэзия'], [/любовн|мелодрам/, 'Мелодрамы']
  ];
  E.guessGenre = function (st, text, author) {
    const t = norm(text) + ' ', a = norm(author);
    const byName = n => (st.genres.find(g => g.name === n) || {}).id;
    for (const [re, n] of RULES.slice(0, 15)) if (re.test(t)) { const id = byName(n); if (id) return id; }
    if (RU_CLASSIC.test(a)) return byName('Русская классика');
    if (SOVIET.test(a)) return byName('Советская литература');
    if (WORLD_CLASSIC.test(a)) return byName('Зарубежная классика');
    for (const [re, n] of RULES.slice(15)) if (re.test(t)) { const id = byName(n); if (id) return id; }
    if (/роман/.test(t)) return byName('Романы');
    return null;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.Engine = E;
})(typeof window !== 'undefined' ? window : globalThis);
