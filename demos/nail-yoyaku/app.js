'use strict';

/* =========================================================
   ネイルカルテ（今日・明日来る人を表示する見本）
   - お客さんごとにデザイン写真・色番・メモを記録する
   - 「この人はこの日に来る」を入れておくと、一覧の上に今日来る人・明日来る人が出る。来たらそのまま記録できる
   - 名前・ふりがな・色番と、年月で検索できる
   - 記録はこの端末のブラウザ（IndexedDB）に保存する
   ========================================================= */

// ===== 保存まわり（IndexedDB） =====
const DB_NAME = 'nail-karte-yoyaku-demo';
const DB_VERSION = 1;
let db = null;

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('customers')) d.createObjectStore('customers', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('bookings')) d.createObjectStore('bookings', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ストア操作の共通処理（保存できない環境では何もしない）
function withStore(name, mode, fn) {
  if (!db) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    try {
      const t = db.transaction(name, mode);
      const req = fn(t.objectStore(name));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    } catch (e) {
      reject(e);
    }
  });
}
const dbGetAll = (name) => withStore(name, 'readonly', (s) => s.getAll());
const dbPut = (name, value) => withStore(name, 'readwrite', (s) => s.put(value));
const dbDelete = (name, id) => withStore(name, 'readwrite', (s) => s.delete(id));

// ===== 画面の状態 =====
const state = {
  customers: [],
  records: [],
  bookings: [],   // 来る日 { id, customerId, date, time（空でもよい）, status: 'booked' | 'done' }
  nextDraft: null, // 予約から記録へ進むときに、記録画面へ渡す内容
  askNext: '',     // 記録を保存した直後に「次回の予約も入れますか？」と聞くお客さん
  query: '',
  month: '',      // 'YYYY-MM' 形式。空なら絞り込みなし
  draft: null,    // 記録フォームの入力途中の内容
  canSave: true,
  sampleHidden: false,
  recentLimit: 9, // 最近のデザインに並べる枚数（「もっと見る」で増える）
  part: 'all',    // ALL / HAND / FOOT の切り替え（一覧と詳細で共通）
};

// ===== 星のかざり（細い線の星） =====
const STAR_PATH = 'M12 2.8l2.7 5.9 6.4.7-4.8 4.3 1.4 6.3L12 16.8 6.3 20l1.4-6.3-4.8-4.3 6.4-.7z';
// 飾りを減らすため、今は星を表示しない（戻すときは下の2行を元のSVGにする）
const STAR_SVG = '';
const STAR_SMALL = '';

// ===== 小さな道具 =====
const $ = (sel, root = document) => root.querySelector(sel);
const uid = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
function formatDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  const w = WEEK[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日（${w}）`;
}
// 英語の曜日（来店日の見出し用）
const WEEK_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function weekEn(s) {
  const [y, m, d] = s.split('-').map(Number);
  return WEEK_EN[new Date(y, m - 1, d).getDay()];
}
function formatShort(s) {
  const [y, m, d] = s.split('-').map(Number);
  return `${y}/${m}/${d}`;
}
function daysAgo(s) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - new Date(y, m - 1, d)) / 86400000);
  if (diff === 0) return '今日';
  if (diff < 0) return `${-diff}日後`;
  if (diff < 60) return `${diff}日前`;
  return `約${Math.round(diff / 30)}か月前`;
}

// 検索用に表記ゆれを吸収する（全角半角・大文字小文字・カタカナ→ひらがな・空白）
function normalize(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}

// 写真のURLを使い回す（Blobごとに1つ）
const urlCache = new WeakMap();
function photoUrl(blob) {
  if (!blob) return '';
  let u = urlCache.get(blob);
  if (!u) {
    u = URL.createObjectURL(blob);
    urlCache.set(blob, u);
  }
  return u;
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// ===== データの取り出し =====
// ハンドかフットか（前の記録には区別がないので、ハンドとして扱う）
const PARTS = [
  { key: 'hand', en: 'HAND', ja: 'ハンド' },
  { key: 'foot', en: 'FOOT', ja: 'フット' },
];
function partOf(r) {
  return r.part === 'foot' ? 'foot' : 'hand';
}
function partEn(r) {
  return partOf(r) === 'foot' ? 'FOOT' : 'HAND';
}
// 今のタブ（ALL / HAND / FOOT）に合う記録か
function matchPart(r) {
  return state.part === 'all' || partOf(r) === state.part;
}
// ALL / HAND / FOOT のタブ
function partTabs() {
  const tabs = [{ key: 'all', en: 'ALL' }, ...PARTS];
  return `<div class="part-tabs" role="tablist" aria-label="ハンドとフットの切り替え">${tabs.map((t) =>
    `<button type="button" role="tab" class="part-tab${state.part === t.key ? ' is-on' : ''}" data-part="${t.key}" aria-selected="${state.part === t.key}">${t.en}</button>`
  ).join('')}</div>`;
}
function bindPartTabs(root, onChange) {
  root.querySelectorAll('[data-part]').forEach((el) => {
    el.addEventListener('click', () => {
      state.part = el.dataset.part;
      state.recentLimit = 9;
      onChange();
    });
  });
}
function recordsOf(customerId) {
  return state.records
    .filter((r) => r.customerId === customerId)
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
}
function customerById(id) {
  return state.customers.find((c) => c.id === id);
}
function visibleCustomers() {
  return state.customers.filter((c) => !(c.sample && state.sampleHidden));
}

// よく使う色番（全記録から回数順）
function frequentColors(limit = 8) {
  const count = new Map();
  for (const r of state.records) {
    for (const c of r.colors || []) count.set(c, (count.get(c) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c);
}

// ===== 画像の縮小（保存容量を抑える） =====
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
async function shrinkImage(file, max = 1600) {
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return await new Promise((r) => canvas.toBlob((b) => r(b || file), 'image/jpeg', 0.85));
  } catch (e) {
    return file; // 縮小できない形式はそのまま保存
  } finally {
    URL.revokeObjectURL(src);
  }
}

// ===== サンプル写真（爪5本の絵を描く） =====
function drawSample({ colors, style, bg }) {
  const W = 800, H = 600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const nails = [
    { x: 95, w: 90, h: 170, y: 250 },
    { x: 235, w: 110, h: 220, y: 170 },
    { x: 395, w: 115, h: 235, y: 140 },
    { x: 560, w: 105, h: 215, y: 175 },
    { x: 705, w: 80, h: 160, y: 270 },
  ];
  nails.forEach((n, i) => {
    const color = colors[i % colors.length];
    const x = n.x - n.w / 2;
    // 指
    g.fillStyle = '#e8ccbd';
    roundRect(g, x - 14, n.y - 10, n.w + 28, H - n.y + 40, n.w / 2 + 14);
    g.fill();
    // 爪の形
    g.save();
    roundRect(g, x, n.y, n.w, n.h, n.w / 2);
    g.clip();
    if (style === 'grad') {
      const gr = g.createLinearGradient(0, n.y, 0, n.y + n.h);
      gr.addColorStop(0, color);
      gr.addColorStop(1, 'rgba(255, 236, 230, 1)');
      g.fillStyle = gr;
    } else {
      g.fillStyle = color;
    }
    g.fillRect(x, n.y, n.w, n.h);
    if (style === 'french') {
      g.fillStyle = '#fbf8f6';
      g.beginPath();
      g.ellipse(n.x, n.y + 6, n.w * 0.62, n.h * 0.2, 0, 0, Math.PI * 2);
      g.fill();
    }
    // 星のアート：ゴールドのホロを散らして、人差し指と薬指に星
    if (style === 'star') {
      for (let k = 0; k < 18; k++) {
        g.fillStyle = `rgba(214, 178, 110, ${0.55 + Math.random() * 0.4})`;
        g.beginPath();
        g.arc(x + Math.random() * n.w, n.y + n.h * 0.35 + Math.random() * n.h * 0.65, 3 + Math.random() * 7, 0, Math.PI * 2);
        g.fill();
      }
      if (i === 1 || i === 3) {
        drawStar(g, n.x, n.y + n.h * 0.45, n.w * 0.32, '#3d3634');
      }
    }
    // 薬指だけラメ
    if (style === 'grad' && i === 3) {
      for (let k = 0; k < 140; k++) {
        g.fillStyle = `rgba(255, 230, 160, ${0.4 + Math.random() * 0.6})`;
        g.beginPath();
        g.arc(x + Math.random() * n.w, n.y + Math.random() * n.h, 1 + Math.random() * 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    // つやの光
    g.fillStyle = 'rgba(255, 255, 255, 0.35)';
    roundRect(g, x + n.w * 0.18, n.y + n.h * 0.18, n.w * 0.14, n.h * 0.5, n.w * 0.07);
    g.fill();
    g.restore();
  });
  return new Promise((r) => c.toBlob((b) => r(b), 'image/jpeg', 0.85));
}
// 五角の星を描く
function drawStar(g, cx, cy, r, color) {
  g.fillStyle = color;
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 === 0 ? r : r * 0.42;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 初回だけサンプルのお客さんと記録を入れる
async function seedSamples() {
  const people = [
    {
      name: '山本 さくら', kana: 'やまもと さくら',
      records: [
        { date: '2026-10-12', colors: ['PG-208 ローズベージュ', 'TC-01 トップ'], memo: 'ワンカラー。前回より長さ短め', art: { colors: ['#d4a39b'], style: 'one', bg: '#ecebe8' } },
        { date: '2026-08-30', colors: ['MT-12 ペールミント'], memo: '夏らしく。親指だけ濃いめ', art: { colors: ['#a9c4b8', '#c3d6cc'], style: 'one', bg: '#e9e9e6' } },
        { date: '2026-07-15', colors: ['WH-02 ミルクホワイト', 'PG-208 ローズベージュ'], memo: 'フレンチ。白は細め', art: { colors: ['#e2b9b2'], style: 'french', bg: '#efeeec' } },
      ],
    },
    {
      name: '佐藤 みゆき', kana: 'さとう みゆき',
      records: [
        { date: '2026-10-28', colors: ['CL-00 クリア', 'G-3 ゴールドホロ', 'BK-01 ブラック'], memo: '星のアート。人差し指と薬指に黒の星', art: { colors: ['#efdcd2'], style: 'star', bg: '#efeeec' } },
        { date: '2026-10-05', part: 'foot', colors: ['PK-33 コーラルピンク'], memo: 'フットのワンカラー。親指だけストーン', art: { colors: ['#d98b7c'], style: 'one', bg: '#ecebe8' } },
        { date: '2026-09-20', colors: ['TR-15 ミルクティー'], memo: 'グラデーション。薬指だけラメ', art: { colors: ['#c79b92'], style: 'grad', bg: '#eae9e6' } },
      ],
    },
    {
      name: '高橋 えり', kana: 'たかはし えり',
      records: [
        { date: '2026-11-02', colors: ['TR-15 ミルクティー', 'WH-02 ミルクホワイト'], memo: 'フレンチ。「前回の色で」とご指定', art: { colors: ['#d8b3a6'], style: 'french', bg: '#ecebe8' } },
      ],
    },
  ];

  for (const p of people) {
    const customer = { id: uid('c'), name: p.name, kana: p.kana, createdAt: new Date().toISOString(), sample: true };
    state.customers.push(customer);
    await safePut('customers', customer);
    for (const r of p.records) {
      const blob = await drawSample(r.art);
      const record = {
        id: uid('r'), customerId: customer.id, part: r.part || 'hand', date: r.date, colors: r.colors, memo: r.memo,
        photos: blob ? [blob] : [], createdAt: new Date().toISOString(), sample: true,
      };
      state.records.push(record);
      await safePut('records', record);
    }
  }
  await seedBookings();
  await safePut('meta', { key: 'seeded-v3', value: true });
}

async function safePut(name, value) {
  try {
    await dbPut(name, value);
  } catch (e) {
    state.canSave = false;
  }
}

async function removeSamples() {
  const sampleRecords = state.records.filter((r) => r.sample);
  const sampleCustomers = state.customers.filter((c) => c.sample);
  const sampleBookings = state.bookings.filter((b) => b.sample);
  state.bookings = state.bookings.filter((b) => !b.sample);
  state.records = state.records.filter((r) => !r.sample);
  state.customers = state.customers.filter((c) => !c.sample);
  try {
    for (const r of sampleRecords) await dbDelete('records', r.id);
    for (const c of sampleCustomers) await dbDelete('customers', c.id);
    for (const b of sampleBookings) await dbDelete('bookings', b.id);
  } catch (e) { /* 消せなくても画面からは消す */ }
  toast('サンプルを消しました');
  render();
}

// ===== 画面切り替え（URLの # で管理する） =====
// #           … 一覧
// #c-<id>     … お客さんの記録
// #new-<id>   … 記録する
// #edit-<id>  … 記録を直す
function route() {
  const h = location.hash.replace(/^#/, '');
  if (h.startsWith('c-')) return { view: 'customer', id: h.slice(2) };
  if (h.startsWith('new-')) return { view: 'new', id: h.slice(4) };
  if (h.startsWith('edit-')) return { view: 'edit', id: h.slice(5) };
  return { view: 'home' };
}
function go(hash) {
  if (location.hash === '#' + hash) render();
  else location.hash = hash;
}

// 直す対象の記録（お客さんが消えていれば対象外）
function editTarget(id) {
  const rec = state.records.find((x) => x.id === id);
  return rec && customerById(rec.customerId) ? rec : null;
}

function render() {
  const r = route();
  const app = $('#app');
  if (r.view === 'customer' && customerById(r.id)) renderCustomer(app, customerById(r.id));
  else if (r.view === 'new' && customerById(r.id)) renderNew(app, customerById(r.id));
  else if (r.view === 'edit' && editTarget(r.id)) renderNew(app, customerById(editTarget(r.id).customerId), editTarget(r.id));
  else renderHome(app);
}

// ===== 一覧画面 =====
function renderHome(app) {
  const total = visibleCustomers().length;
  const hasSample = state.customers.some((c) => c.sample);
  app.innerHTML = `
    <header class="top">
      <div class="brand">
        <div>
          <h1 class="brand-title">nail karte${STAR_SVG}</h1>
          <span class="brand-sub">DESIGN RECORD</span>
        </div>
        <span class="count">${total} guests</span>
      </div>
      <div class="search">
        <input id="q" class="input" type="search" placeholder="Name / フリガナ / 色番" value="${esc(state.query)}" enterkeyhint="search" aria-label="名前・ふりがな・色番で検索">
        <!-- 携帯では月の欄が空だと何も表示されないので、いつも文字とアイコンを見せて、その上に透明な入力欄を重ねる -->
        <label class="month-wrap" id="month-wrap">
          <svg class="month-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
          <span id="month-label" class="month-label"></span>
          <input id="month" class="month-input" type="month" value="${esc(state.month)}" aria-label="来店した年月で絞り込む">
        </label>
      </div>
      <div id="part-tabs-wrap">${partTabs()}</div>
      <div id="filter-note" class="filter-note" hidden></div>
    </header>
    ${state.canSave ? '' : `<div class="notice warn">この画面では記録を保存できません。閉じると消えます。</div>`}
    ${hasSample ? `<div class="notice"><span>お試し用のサンプルが入っています</span><button id="clear-sample" class="link-btn" type="button">サンプルを消す</button></div>` : ''}
    <div id="booking-wrap"></div>
    <div id="recent-wrap"></div>
    <h2 class="section-label">${STAR_SMALL}guests<span>お客さま</span></h2>
    <div id="list" class="list"></div>
    <p class="footnote">${STAR_SMALL}記録はこの携帯の中だけに保存されます<br><a class="guide-link" href="guide.html">使い方を見る</a></p>
    <div class="dock"><div class="dock-inner">
      <button id="add-customer" class="btn btn-primary" type="button"><span class="btn-plus" aria-hidden="true">+</span>お客さんを追加</button>
    </div></div>
  `;
  renderList();
  renderHomeBookings();

  $('#q').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });
  $('#month').addEventListener('change', (e) => { state.month = e.target.value; updateMonthLabel(); renderList(); });
  // パソコンのブラウザでは、欄のどこを押してもカレンダーが開くようにする
  $('#month').addEventListener('click', (e) => {
    try { if (e.target.showPicker) e.target.showPicker(); } catch (err) { /* 開けないブラウザでは何もしない */ }
  });
  updateMonthLabel();
  $('#add-customer').addEventListener('click', openSheet);
  // タブを押したら、タブの見た目と一覧だけを描き直す
  const refreshHomeTabs = () => {
    $('#part-tabs-wrap').innerHTML = partTabs();
    bindPartTabs($('#part-tabs-wrap'), refreshHomeTabs);
    renderList();
  };
  bindPartTabs($('#part-tabs-wrap'), refreshHomeTabs);
  const clear = $('#clear-sample');
  if (clear) clear.addEventListener('click', removeSamples);
}

// 最近のデザイン（検索していないときだけ、写真を3列で並べる）
function renderRecent(show) {
  const wrap = $('#recent-wrap');
  const visibleIds = new Set(visibleCustomers().map((c) => c.id));
  const all = state.records
    .filter((r) => visibleIds.has(r.customerId) && r.photos?.length && matchPart(r))
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const recs = all.slice(0, state.recentLimit);
  if (!show || recs.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = `
    <h2 class="section-label">${STAR_SMALL}recent<span>最近のデザイン</span></h2>
    <div class="recent">
      ${recs.map((r) => {
        const c = customerById(r.customerId);
        return `<button type="button" data-cid="${esc(r.customerId)}" aria-label="${esc(c?.name)}さんの記録を見る">
          <img src="${photoUrl(r.photos[0])}" alt="">
          <span class="tile-name">${esc(c?.name)}</span>
          <span class="tile-date">${esc(formatShort(r.date))}<span class="tile-part">${partEn(r)}</span></span>
        </button>`;
      }).join('')}
    </div>
    ${all.length > recs.length ? `<button id="recent-more" class="more-btn" type="button">もっと見る（あと${all.length - recs.length}件）</button>` : ''}`;
  const more = wrap.querySelector('#recent-more');
  if (more) more.addEventListener('click', () => { state.recentLimit += 9; renderRecent(true); });
  wrap.querySelectorAll('[data-cid]').forEach((el) => {
    el.addEventListener('click', () => go('c-' + el.dataset.cid));
  });
}

// 月の欄の表示（未選択なら「月で探す」、選択済みなら「2026年10月」）
function updateMonthLabel() {
  const label = $('#month-label');
  const wrap = $('#month-wrap');
  if (!label || !wrap) return;
  if (state.month) {
    const [y, m] = state.month.split('-').map(Number);
    label.textContent = `${y}年${m}月`;
  } else {
    label.textContent = '月で探す';
  }
  wrap.classList.toggle('is-set', !!state.month);
}

function renderList() {
  renderRecent(!state.query.trim() && !state.month);
  const list = $('#list');
  const note = $('#filter-note');
  const q = normalize(state.query);
  const month = state.month;

  const rows = [];
  for (const c of visibleCustomers()) {
    let recs = recordsOf(c.id).filter(matchPart);
    if (month) recs = recs.filter((r) => r.date.startsWith(month));
    if ((month || state.part !== 'all') && recs.length === 0) continue;

    let hit = null;
    if (q) {
      const nameHit = normalize(c.name).includes(q) || normalize(c.kana).includes(q);
      if (!nameHit) {
        // 名前で見つからなければ、色番とメモから探す
        const r = recs.find((r) => (r.colors || []).some((col) => normalize(col).includes(q)) || normalize(r.memo).includes(q));
        if (!r) continue;
        const col = (r.colors || []).find((col) => normalize(col).includes(q));
        hit = col ? `色番「${col}」${formatShort(r.date)}` : `メモに一致 ${formatShort(r.date)}`;
      }
    }
    rows.push({ c, recs, latest: recs[0], hit });
  }
  // 最近来た人を上に
  rows.sort((a, b) => (b.latest?.date || b.c.createdAt).localeCompare(a.latest?.date || a.c.createdAt));

  if (month || q) {
    const [y, m] = month ? month.split('-').map(Number) : [];
    const parts = [];
    if (month) parts.push(`${y}年${m}月に来店`);
    if (q) parts.push(`「${state.query.trim()}」`);
    note.innerHTML = `<span>${esc(parts.join('・'))}：${rows.length}人</span><button id="clear-filter" class="link-btn" type="button">条件を消す</button>`;
    note.hidden = false;
    $('#clear-filter').addEventListener('click', () => {
      state.query = '';
      state.month = '';
      $('#q').value = '';
      $('#month').value = '';
      updateMonthLabel();
      renderList();
    });
  } else {
    note.hidden = true;
  }

  if (rows.length === 0) {
    list.innerHTML = state.customers.length === 0 && !q && !month
      ? `<div class="empty"><strong>まだお客さんがいません</strong><span>下の「お客さんを追加」から始めましょう</span></div>`
      : `<div class="empty"><strong>見つかりませんでした</strong><span>ふりがなや色番でも探せます</span></div>`;
    return;
  }

  list.innerHTML = rows.map(({ c, recs, latest, hit }) => {
    const photo = latest?.photos?.[0];
    const thumb = photo
      ? `<img class="thumb" src="${photoUrl(photo)}" alt="">`
      : `<span class="thumb" aria-hidden="true">${esc(c.name.trim().charAt(0))}</span>`;
    const meta = latest ? `${month ? '' : '最終 '}${formatShort(latest.date)}` : 'まだ記録がありません';
    // 来店回数はタグにして、名前の横に出す
    const visitTag = recs.length ? `<span class="visit-tag">${month ? 'この月' : ''}${recs.length}回</span>` : '';
    return `
      <button class="card" type="button" data-id="${esc(c.id)}">
        ${thumb}
        <span class="card-body">
          <span class="card-name">${esc(c.name)}${visitTag}${c.sample ? '<span class="badge">サンプル</span>' : ''}</span>
          <span class="card-meta">${esc(meta)}</span>
          ${hit ? `<span class="card-hit">${esc(hit)}</span>` : ''}
        </span>
      </button>`;
  }).join('');

  list.querySelectorAll('.card').forEach((el) => {
    el.addEventListener('click', () => go('c-' + el.dataset.id));
  });
}

// ===== 来店カレンダー（方眼のカレンダー風に、来た月を囲む） =====
function renderVisitCalendar(recs) {
  if (recs.length === 0) return '';
  const byMonth = new Map();
  // 月ごとの色は、その月のいちばん新しい記録カードの帯の色に合わせる
  const toneOf = new Map();
  recs.forEach((r, idx) => {
    const ym = r.date.slice(0, 7);
    byMonth.set(ym, (byMonth.get(ym) || 0) + 1);
    if (!toneOf.has(ym)) toneOf.set(ym, idx % 3);
  });
  const years = [...new Set(recs.map((r) => r.date.slice(0, 4)))].sort().reverse();
  const names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return years.map((y) => `
    <section class="cal" aria-label="${y}年の来店">
      <div class="cal-head"><span class="cal-year">${y}</span><span class="cal-note">来店した月</span></div>
      <div class="cal-grid">
        ${names.map((n, i) => {
          const ym = `${y}-${String(i + 1).padStart(2, '0')}`;
          const count = byMonth.get(ym) || 0;
          return count
            ? `<button type="button" class="cal-cell on tone-${toneOf.get(ym)}" data-month="${ym}" aria-label="${y}年${i + 1}月の記録へ（${count}回）"><span class="cal-num">${i + 1}</span><span class="cal-mon">${n}</span>${count > 1 ? `<span class="cal-count">×${count}</span>` : ''}</button>`
            : `<span class="cal-cell"><span class="cal-num">${i + 1}</span><span class="cal-mon">${n}</span></span>`;
        }).join('')}
      </div>
    </section>`).join('');
}

// ===== お客さんの記録画面 =====
function renderCustomer(app, c) {
  const allRecs = recordsOf(c.id);
  const recs = allRecs.filter(matchPart);
  const q = normalize(state.query);

  let body = '';
  let lastYear = '';
  const seenMonths = new Set();
  recs.forEach((r, idx) => {
    const year = r.date.slice(0, 4);
    if (year !== lastYear) {
      body += `<h2 class="year">${STAR_SMALL}${year}</h2>`;
      lastYear = year;
    }
    // カレンダーから飛べるよう、各月の最初の記録に目印をつける
    const ym = r.date.slice(0, 7);
    const anchor = seenMonths.has(ym) ? '' : ` id="m-${ym}"`;
    seenMonths.add(ym);
    // 一覧で検索した条件に合う記録は目立たせる
    const isHit = (state.month && r.date.startsWith(state.month))
      || (q && (r.colors || []).some((col) => normalize(col).includes(q)));
    const photos = (r.photos || []).map((p, i) =>
      `<button type="button" data-photo="${esc(r.id)}:${i}" aria-label="写真を大きく見る"><img src="${photoUrl(p)}" alt="${esc(formatDate(r.date))}のデザイン" loading="lazy"></button>`
    ).join('');
    body += `
      <article class="record tone-${idx % 3}${isHit ? ' is-hit' : ''}"${anchor}>
        <div class="record-head">
          <span class="part-tag">${partEn(r)}</span>${r.off ? '<span class="part-tag off-tag">OFFのみ</span>' : ''}
          <span class="record-date" aria-label="${esc(formatDate(r.date))}">${esc(r.date.slice(5).replace('-', '.'))}<small class="rd-year">${esc(r.date.slice(0, 4))}</small><small class="rd-week">${weekEn(r.date)}</small></span>
          <span class="record-ago">${esc(daysAgo(r.date))}</span>
        </div>
        <div class="record-body">
        ${photos ? `<div class="photos${r.photos.length === 1 ? ' single' : ''}">${photos}</div>` : ''}
        ${r.colors?.length ? `<div class="chips">${r.colors.map((col) => `<span class="chip">${esc(col)}</span>`).join('')}</div>` : ''}
        ${r.memo ? `<p class="memo">${esc(r.memo)}</p>` : ''}
        ${r.karte?.length ? `
          <div class="karte">
            <span class="karte-label">手描きカルテ</span>
            <div class="karte-list">${r.karte.map((p, i) =>
              `<button type="button" data-karte="${esc(r.id)}:${i}" aria-label="カルテを大きく見る"><img src="${photoUrl(p)}" alt="${esc(formatDate(r.date))}のカルテ" loading="lazy"></button>`
            ).join('')}</div>
          </div>` : ''}
        <div class="record-foot">
          <button class="edit-btn" type="button" data-edit="${esc(r.id)}">編集</button>
          <button class="danger-btn" type="button" data-del="${esc(r.id)}">この記録を削除</button>
        </div>
        </div>
      </article>`;
  });

  app.innerHTML = `
    <header class="top">
      <div class="back-bar"><button id="back" class="back-btn" type="button">‹ 一覧へ</button></div>
      <div class="title-row">
        <div class="title-line">
          <h1 class="page-title">${esc(c.name)}</h1>
          <span class="page-sub">${esc(c.kana || '')}${c.kana ? ' ・ ' : ''}来店記録 ${allRecs.length}回</span>
        </div>
        <button id="edit-customer" class="edit-btn" type="button">名前を編集</button>
      </div>
    </header>
    <div id="next-booking">${customerBookingBox(c)}</div>
    ${allRecs.length ? partTabs() : ''}
    ${renderVisitCalendar(recs)}
    <div class="timeline">
      ${body || (allRecs.length
        ? `<div class="empty"><strong>${state.part === 'foot' ? 'フット' : 'ハンド'}の記録はまだありません</strong><span>ALL を押すと、すべての記録を見られます</span></div>`
        : `<div class="empty"><strong>まだ記録がありません</strong><span>施術が終わったら、下のボタンから写真を撮って残しましょう</span></div>`)}
    </div>
    <div class="section-danger">
      <button id="del-customer" class="danger-btn" type="button">このお客さんを削除</button>
    </div>
    <div class="dock"><div class="dock-inner">
      <button id="add-record" class="btn btn-primary" type="button">写真を撮って記録する</button>
    </div></div>
  `;

  $('#back').addEventListener('click', () => go(''));
  $('#add-record').addEventListener('click', () => { state.draft = null; go('new-' + c.id); });
  $('#edit-customer').addEventListener('click', () => openSheet(c));
  bindBookingBox($('#next-booking'), c);
  bindPartTabs(app, () => render());
  app.querySelectorAll('[data-edit]').forEach((el) => {
    el.addEventListener('click', () => { state.draft = null; go('edit-' + el.dataset.edit); });
  });

  // カレンダーの月を押すと、その月の記録までスクロールする
  app.querySelectorAll('[data-month]').forEach((el) => {
    el.addEventListener('click', () => {
      const target = document.getElementById('m-' + el.dataset.month);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  app.querySelectorAll('[data-photo]').forEach((el) => {
    el.addEventListener('click', () => {
      const [rid, i] = el.dataset.photo.split(':');
      const r = state.records.find((x) => x.id === rid);
      if (r) openViewer(r.photos[Number(i)]);
    });
  });
  app.querySelectorAll('[data-karte]').forEach((el) => {
    el.addEventListener('click', () => {
      const [rid, i] = el.dataset.karte.split(':');
      const r = state.records.find((x) => x.id === rid);
      if (r) openViewer(r.karte[Number(i)]);
    });
  });

  // 削除は2回押しで確定（うっかり防止）
  app.querySelectorAll('[data-del]').forEach((el) => {
    armDelete(el, 'もう一度押すと削除します', async () => {
      const id = el.dataset.del;
      state.records = state.records.filter((r) => r.id !== id);
      try { await dbDelete('records', id); } catch (e) { /* 画面からは消す */ }
      toast('記録を削除しました');
      render();
    });
  });
  armDelete($('#del-customer'), 'もう一度押すと記録ごと削除します', async () => {
    const ids = state.records.filter((r) => r.customerId === c.id).map((r) => r.id);
    state.records = state.records.filter((r) => r.customerId !== c.id);
    state.customers = state.customers.filter((x) => x.id !== c.id);
    const bookingIds = state.bookings.filter((x) => x.customerId === c.id).map((x) => x.id);
    state.bookings = state.bookings.filter((x) => x.customerId !== c.id);
    try {
      for (const id of ids) await dbDelete('records', id);
      for (const id of bookingIds) await dbDelete('bookings', id);
      await dbDelete('customers', c.id);
    } catch (e) { /* 画面からは消す */ }
    toast('削除しました');
    go('');
  });
}

function armDelete(el, armedText, onConfirm) {
  const original = el.textContent;
  let timer = 0;
  el.addEventListener('click', () => {
    if (el.classList.contains('armed')) {
      clearTimeout(timer);
      onConfirm();
      return;
    }
    el.classList.add('armed');
    el.textContent = armedText;
    timer = setTimeout(() => {
      el.classList.remove('armed');
      el.textContent = original;
    }, 3000);
  });
}

// ===== 記録する画面 =====
// editing を渡すと、その記録を直す画面になる
function renderNew(app, c, editing = null) {
  const editId = editing ? editing.id : null;
  if (!state.draft || state.draft.customerId !== c.id || state.draft.editId !== editId) {
    state.draft = editing
      ? { editId, customerId: c.id, part: partOf(editing), off: !!editing.off, date: editing.date, photos: [...(editing.photos || [])], karte: [...(editing.karte || [])], colors: [...(editing.colors || [])], memo: editing.memo || '' }
      // 新しい記録は、タブで選んでいる方（ALLならハンド）から始める
      : { editId: null, customerId: c.id, part: state.part === 'foot' ? 'foot' : 'hand', off: false, date: todayStr(), photos: [], karte: [], colors: [], memo: '' };
    if (!editing && state.nextDraft && state.nextDraft.customerId === c.id) {
      // ハンド／フットは記録の画面で選ぶ
      Object.assign(state.draft, state.nextDraft);
    }
    state.nextDraft = null;
  }
  const d = state.draft;
  // 候補に出す「前回」は、直している記録以外で、同じハンド／フットのいちばん新しいもの
  const lastOf = () => recordsOf(c.id).find((x) => x.id !== editId && partOf(x) === d.part);

  app.innerHTML = `
    <header class="top">
      <div class="back-bar"><button id="back" class="back-btn" type="button">‹ やめる</button></div>
      <div>
        <h1 class="page-title">${esc(c.name)}</h1>
        <p class="page-sub">${editing ? '記録を編集' : (d.bookingId ? '来た日のデザインを記録' : '今日のデザインを記録')}</p>
      </div>
    </header>
    <form id="record-form" class="form" autocomplete="off">
      <div class="seg" role="radiogroup" aria-label="ハンドかフットか">
        ${PARTS.map((p) => `<label class="seg-item seg-${p.key}${d.part === p.key ? ' is-on' : ''}"><input type="radio" name="part" value="${p.key}"${d.part === p.key ? ' checked' : ''}><span class="seg-en">${p.en}</span><span class="seg-ja">${p.ja}</span></label>`).join('')}
      </div>
      <label class="off-toggle">
        <input id="off-only" type="checkbox"${d.off ? ' checked' : ''}>
        <span><b>オフだけ</b>（デザインはなし。写真や色番がなくても保存できます）</span>
      </label>
      <div class="field">
        <span class="field-label">写真</span>
        <div class="shoot">
          <label class="cam">
            <svg class="cam-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/></svg>
            撮影する
            <input id="cam-input" type="file" accept="image/*" capture="environment">
          </label>
          <label class="lib">
            写真から選ぶ
            <input id="lib-input" type="file" accept="image/*" multiple>
          </label>
        </div>
        <div id="previews" class="previews"></div>
      </div>

      <div class="field">
        <span class="field-label">色番</span>
        <div id="colors" class="chips"></div>
        <div class="color-add">
          <input id="color-input" class="input" type="text" placeholder="例：PG-208" enterkeyhint="done" aria-label="色番を入力">
          <button id="color-add" class="btn" type="button">追加</button>
        </div>
        <div id="suggest-wrap" class="field" hidden>
          <span class="field-hint" id="suggest-label"></span>
          <div id="suggest" class="chips"></div>
        </div>
      </div>

      <label class="field">
        <span class="field-label">メモ</span>
        <textarea id="memo" class="input" placeholder="例：薬指だけラメ。フレンチは細め">${esc(d.memo)}</textarea>
      </label>

      <div class="field">
        <span class="field-label">手描きカルテ（任意）</span>
        <span class="field-hint">紙のカルテに書いた場合は、撮っておくと一緒に見返せます</span>
        <div class="shoot shoot-sub">
          <label class="lib">
            カルテを撮影
            <input id="karte-cam" type="file" accept="image/*" capture="environment">
          </label>
          <label class="lib">
            写真から選ぶ
            <input id="karte-lib" type="file" accept="image/*" multiple>
          </label>
        </div>
        <div id="karte-previews" class="previews"></div>
      </div>

      <label class="field">
        <span class="field-label">来店日</span>
        <input id="date" class="input" type="date" value="${esc(d.date)}" required>
      </label>
    </form>
    <div class="dock"><div class="dock-inner">
      <button id="save" class="btn btn-primary" type="submit" form="record-form">保存する</button>
    </div></div>
  `;

  // 写真の一覧（デザイン写真とカルテ写真で共通）
  const renderThumbs = (boxSel, list, label) => {
    const box = $(boxSel);
    box.innerHTML = list.map((p, i) => `
      <div class="preview">
        <img src="${photoUrl(p)}" alt="${label}${i + 1}">
        <button type="button" data-rm="${i}" aria-label="この写真を外す">×</button>
      </div>`).join('');
    box.querySelectorAll('[data-rm]').forEach((el) => {
      el.addEventListener('click', () => { list.splice(Number(el.dataset.rm), 1); renderThumbs(boxSel, list, label); });
    });
  };
  const renderPreviews = () => renderThumbs('#previews', d.photos, '追加した写真');
  const renderKarte = () => renderThumbs('#karte-previews', d.karte, 'カルテの写真');

  const renderColors = () => {
    $('#colors').innerHTML = d.colors.map((col, i) =>
      `<span class="chip">${esc(col)}<button type="button" data-rmc="${i}" aria-label="${esc(col)}を外す">×</button></span>`
    ).join('');
    $('#colors').querySelectorAll('[data-rmc]').forEach((el) => {
      el.addEventListener('click', () => { d.colors.splice(Number(el.dataset.rmc), 1); renderColors(); });
    });

    // 前回の色番を優先して候補に出す
    const last = lastOf();
    const lastColors = last?.colors || [];
    const pool = [...new Set([...lastColors, ...frequentColors()])].filter((col) => !d.colors.includes(col)).slice(0, 8);
    $('#suggest-wrap').hidden = pool.length === 0;
    $('#suggest-label').textContent = lastColors.length ? `前回（${formatShort(last.date)}）とよく使う色番` : 'よく使う色番';
    $('#suggest').innerHTML = pool.map((col) => `<button class="chip-suggest" type="button" data-add="${esc(col)}">＋ ${esc(col)}</button>`).join('');
    $('#suggest').querySelectorAll('[data-add]').forEach((el) => {
      el.addEventListener('click', () => { d.colors.push(el.dataset.add); renderColors(); });
    });
  };

  const addPhotos = async (files) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      d.photos.push(await shrinkImage(f));
    }
    renderPreviews();
  };
  // カルテは文字を読めるよう、少し大きめに残す
  const addKarte = async (files) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      d.karte.push(await shrinkImage(f, 2200));
    }
    renderKarte();
  };

  const addColor = () => {
    const input = $('#color-input');
    const v = input.value.trim();
    if (v && !d.colors.includes(v)) d.colors.push(v);
    input.value = '';
    renderColors();
  };

  renderPreviews();
  renderKarte();
  renderColors();
  $('#karte-cam').addEventListener('change', (e) => { addKarte([...e.target.files]); e.target.value = ''; });
  $('#karte-lib').addEventListener('change', (e) => { addKarte([...e.target.files]); e.target.value = ''; });

  $('#back').addEventListener('click', () => { state.draft = null; go('c-' + c.id); });
  $('#cam-input').addEventListener('change', (e) => { addPhotos([...e.target.files]); e.target.value = ''; });
  $('#lib-input').addEventListener('change', (e) => { addPhotos([...e.target.files]); e.target.value = ''; });
  $('#color-add').addEventListener('click', addColor);
  $('#color-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addColor(); }
  });
  $('#memo').addEventListener('input', (e) => { d.memo = e.target.value; });
  $('#off-only').addEventListener('change', (e) => { d.off = e.target.checked; });
  $('#date').addEventListener('change', (e) => { d.date = e.target.value; });
  // ハンド／フットを切り替えたら、色番の候補も入れかえる
  app.querySelectorAll('input[name="part"]').forEach((el) => {
    el.addEventListener('change', () => {
      d.part = el.value;
      // 古いブラウザでも選んだ方が塗られるよう、クラスでも切り替える
      app.querySelectorAll('.seg-item').forEach((item) => item.classList.toggle('is-on', item.contains(el)));
      renderColors();
    });
  });

  $('#record-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    // 入力欄に残った色番も拾う
    if ($('#color-input').value.trim()) addColor();
    if (!d.date) { toast('来店日を入れてください'); return; }
    if (!d.off && d.photos.length === 0 && d.karte.length === 0 && d.colors.length === 0 && !d.memo.trim()) {
      toast('写真・色番・メモ・カルテのどれかを入れてください');
      return;
    }
    let record;
    if (editing) {
      // 既存の記録を書きかえる
      record = Object.assign(editing, {
        part: d.part, off: d.off, date: d.date, colors: [...d.colors], memo: d.memo.trim(),
        photos: [...d.photos], karte: [...d.karte], updatedAt: new Date().toISOString(),
      });
    } else {
      record = {
        id: uid('r'), customerId: c.id, part: d.part, off: d.off, date: d.date, colors: [...d.colors], memo: d.memo.trim(),
        photos: [...d.photos], karte: [...d.karte], createdAt: new Date().toISOString(),
      };
      state.records.push(record);
    }
    await safePut('records', record);
    // 「来た」から記録したときは、その予定を「来た」ことにする（今日・明日の一覧から消える）
    if (d.bookingId) {
      const b = state.bookings.find((x) => x.id === d.bookingId);
      if (b) { b.status = 'done'; await safePut('bookings', b); }
    }
    state.draft = null;
    if (!editing && !nextBookingOf(c.id)) state.askNext = c.id;
    toast(state.canSave ? (editing ? '編集を保存しました' : '保存しました') : '保存できませんでした（この画面を閉じると消えます）');
    go('c-' + c.id);
  });
}

// ===== 写真の拡大 =====
function openViewer(blob) {
  $('#viewer-img').src = photoUrl(blob);
  $('#viewer').hidden = false;
}
function closeViewer() {
  $('#viewer').hidden = true;
}

// ===== お客さん追加シート =====
// customer を渡すと、そのお客さんの名前を直すシートになる
let sheetEditId = null;
function openSheet(customer = null) {
  sheetEditId = customer && customer.id ? customer.id : null;
  $('#sheet-title').textContent = sheetEditId ? 'お名前を編集' : 'お客さんを追加';
  $('#sheet-submit').textContent = sheetEditId ? '保存する' : '追加する';
  $('#new-name').value = sheetEditId ? customer.name : '';
  $('#new-kana').value = sheetEditId ? (customer.kana || '') : '';
  $('#sheet').hidden = false;
  setTimeout(() => $('#new-name').focus(), 50);
}
function closeSheet() {
  $('#sheet').hidden = true;
}

// ===== 起動 =====
async function start() {
  // Netlifyの無料プランでは右下に「Powered by Netlify」のマークが重なるので、そのときだけ下のボタンを持ち上げる
  if (location.hostname.endsWith('.netlify.app')) document.documentElement.classList.add('host-badge');
  $('#viewer').addEventListener('click', closeViewer);
  $('#sheet-cancel').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  $('#sheet-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#new-name').value.trim();
    if (!name) return;
    if (sheetEditId) {
      const target = customerById(sheetEditId);
      if (target) {
        target.name = name;
        target.kana = $('#new-kana').value.trim();
        await safePut('customers', target);
      }
      closeSheet();
      toast('お名前を保存しました');
      render();
      return;
    }
    const customer = { id: uid('c'), name, kana: $('#new-kana').value.trim(), createdAt: new Date().toISOString() };
    state.customers.push(customer);
    await safePut('customers', customer);
    closeSheet();
    go('c-' + customer.id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeViewer(); closeSheet(); closeBookingSheet(); }
  });
  setupBookingSheet();
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  try {
    db = await openDb();
    state.customers = (await dbGetAll('customers')) || [];
    state.records = (await dbGetAll('records')) || [];
    state.bookings = (await dbGetAll('bookings')) || [];
    const meta = (await dbGetAll('meta')) || [];
    if (!meta.some((m) => m.key === 'seeded-v3')) {
      // 古いサンプルが残っていれば消してから入れ直す（自分で消していた場合は入れ直さない）
      const hadSamples = state.customers.some((x) => x.sample);
      const everSeeded = meta.some((m) => String(m.key).startsWith('seeded'));
      for (const r of state.records.filter((x) => x.sample)) await dbDelete('records', r.id);
      for (const c of state.customers.filter((x) => x.sample)) await dbDelete('customers', c.id);
      state.records = state.records.filter((x) => !x.sample);
      state.customers = state.customers.filter((x) => !x.sample);
      if (hadSamples || !everSeeded) await seedSamples();
      else await safePut('meta', { key: 'seeded-v3', value: true });
    }
  } catch (e) {
    // 保存できない環境（プライベートモードなど）ではメモリ上だけで動かす
    db = null;
    state.canSave = false;
    if (state.customers.length === 0) await seedSamples();
  }
  render();
}

// ===== 来る日（今日・明日来る人を一覧の上に出す） =====
// 予約の管理まではせず、「この人はこの日に来る」だけを残す。
// データは bookings に { id, customerId, date, time（空でもよい）, status: 'booked' | 'done' } で入れる
// 時間の候補は1時間ごとのざっくり（9時〜20時）。空なら「時間は決まっていない」
// 並べ替えのため保存は '10:00' の形にして、表示は「10時」にする
const TIMES = [];
for (let h = 9; h <= 20; h++) TIMES.push(`${String(h).padStart(2, '0')}:00`);
const timeLabel = (t) => (t ? `${Number(t.slice(0, 2))}時${t.slice(3) !== '00' ? t.slice(3) + '分' : ''}` : '');

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
// 時間が決まっている人を先に、時間の早い順に並べる
function sortBookings(list) {
  return [...list].sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}
// その日に来る人（まだ来ていない人）
function comingOn(date) {
  const ids = new Set(visibleCustomers().map((c) => c.id));
  return sortBookings(state.bookings.filter((b) => b.date === date && b.status !== 'done' && ids.has(b.customerId)));
}
// そのお客さんの、次に来る日
function nextBookingOf(customerId) {
  const today = todayStr();
  return sortBookings(state.bookings.filter((b) => b.customerId === customerId && b.status !== 'done' && b.date >= today))[0];
}
function dayLabel(date) {
  const today = todayStr();
  if (date === today) return '今日';
  if (date === addDays(today, 1)) return '明日';
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
}

// 来る人の1行
function comingRow(b) {
  const c = customerById(b.customerId);
  const last = recordsOf(b.customerId)[0];
  return `
    <div class="bk-row">
      <span class="bk-when"><span class="bk-time">${b.time ? esc(timeLabel(b.time)) : '<span class="bk-notime">時間未定</span>'}</span></span>
      <button type="button" class="bk-main" data-bk-open="${esc(b.customerId)}">
        <span class="bk-name">${esc(c?.name || '')}${b.off ? '<span class="bk-off">オフのみ</span>' : ''}</span>
        <span class="bk-menu">${last ? `前回 ${esc(formatShort(last.date))}${last.colors?.length ? `・${esc(last.colors[0])}` : ''}` : 'はじめての来店'}</span>
      </button>
      <button type="button" class="bk-action" data-bk-visit="${esc(b.id)}">来た</button>
    </div>`;
}
function bindComingRows(root) {
  root.querySelectorAll('[data-bk-open]').forEach((el) => el.addEventListener('click', () => go('c-' + el.dataset.bkOpen)));
  root.querySelectorAll('[data-bk-visit]').forEach((el) => el.addEventListener('click', () => startVisit(el.dataset.bkVisit)));
}
// 「来た」を押したら、来る日を入れた記録画面を開く（保存すると「来た」ことになる）
function startVisit(bookingId) {
  const b = state.bookings.find((x) => x.id === bookingId);
  if (!b) return;
  state.draft = null;
  state.nextDraft = { customerId: b.customerId, date: b.date, bookingId: b.id, off: !!b.off };
  go('new-' + b.customerId);
}

// 一覧の上：今日来る人・明日来る人
function renderHomeBookings() {
  const wrap = $('#booking-wrap');
  if (!wrap) return;
  const today = todayStr();
  const block = (label, en, list, emptyText) => `
    <h2 class="section-label">${en}<span>${label}${list.length ? `（${list.length}人）` : ''}</span></h2>
    <div class="bk-list">
      ${list.length ? list.map(comingRow).join('') : `<div class="bk-empty">${emptyText}</div>`}
    </div>`;
  wrap.innerHTML = `
    ${block('今日来る人', 'today', comingOn(today), '今日来る人はいません')}
    ${block('明日来る人', 'tomorrow', comingOn(addDays(today, 1)), '明日来る人はいません')}
    <button id="quick-booking" class="more-btn" type="button">＋ 来る日を入れる</button>`;
  bindComingRows(wrap);
  $('#quick-booking').addEventListener('click', () => openBookingSheet({ date: today }));
}

// お客さんの画面：次に来る日
function customerBookingBox(c) {
  const b = nextBookingOf(c.id);
  if (!b && state.askNext === c.id) {
    return `
    <div class="bk-box is-ask">
      <span class="bk-box-ask">記録しました。次に来る日も入れますか？</span>
      <span class="bk-box-none">4週間後の日にちを入れておきます（変えられます）</span>
      <div class="bk-box-actions">
        <button type="button" class="bk-box-btn" data-bk-later>あとで</button>
        <button type="button" class="bk-box-btn is-main" data-bk-new data-bk-weeks="4">次に来る日を入れる</button>
      </div>
    </div>`;
  }
  if (!b) {
    return `<div class="bk-box"><span class="bk-box-label">次に来る日</span><span class="bk-box-none">まだ入っていません</span><button type="button" class="bk-box-btn" data-bk-new>来る日を入れる</button></div>`;
  }
  return `
    <div class="bk-box is-set">
      <span class="bk-box-label">次に来る日</span>
      <span class="bk-box-when">${esc(formatDate(b.date))}${b.time ? ` ${esc(timeLabel(b.time))}` : ''}${b.off ? '<span class="bk-off">オフのみ</span>' : ''}<small>${esc(dayLabel(b.date) === '今日' || dayLabel(b.date) === '明日' ? dayLabel(b.date) : daysAgo(b.date))}</small></span>
      <div class="bk-box-actions">
        <button type="button" class="bk-box-btn" data-bk-edit="${esc(b.id)}">日にちを変える</button>
        <button type="button" class="bk-box-btn is-main" data-bk-visit="${esc(b.id)}">来たので記録する</button>
      </div>
    </div>`;
}
function bindBookingBox(root, c) {
  const n = root.querySelector('[data-bk-new]');
  if (n) n.addEventListener('click', () => {
    // 記録のあとに聞いたときは、4週間後の日にちを入れておく
    const weeks = Number(n.dataset.bkWeeks || 0);
    state.askNext = '';
    openBookingSheet({ customerId: c.id, date: weeks ? addDays(todayStr(), weeks * 7) : '' });
  });
  const later = root.querySelector('[data-bk-later]');
  if (later) later.addEventListener('click', () => {
    state.askNext = '';
    root.innerHTML = customerBookingBox(c);
    bindBookingBox(root, c);
  });
  root.querySelectorAll('[data-bk-edit]').forEach((el) => el.addEventListener('click', () => openBookingSheet({ booking: state.bookings.find((x) => x.id === el.dataset.bkEdit) })));
  root.querySelectorAll('[data-bk-visit]').forEach((el) => el.addEventListener('click', () => startVisit(el.dataset.bkVisit)));
}

// ===== 来る日を入れる・変えるシート =====
let bookingEdit = null; // 変えている来る日（新しく入れるときは null）
function openBookingSheet({ booking = null, customerId = '', date = '' } = {}) {
  bookingEdit = booking;
  const sel = $('#bk-customer');
  const people = [...visibleCustomers()].sort((a, b) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja'));
  sel.innerHTML = `<option value="">お客さんを選んでください</option><option value="__new">＋ 新しいお客さん（名前を入れる）</option>` + people.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  sel.value = booking ? booking.customerId : customerId;
  // お客さんの画面から開いたときは、選び直せないようにする
  sel.disabled = !!(booking || customerId);
  $('#bk-new-name').value = '';
  $('#bk-new-kana').value = '';
  toggleNewCustomer();
  $('#bk-date').value = booking ? booking.date : (date || todayStr());
  $('#bk-time').innerHTML = `<option value="">決まっていない</option>` + TIMES.map((t) => `<option value="${t}">${timeLabel(t)}</option>`).join('');
  // 前の形（30分ごと）で入れた時間も選べるように、候補になければ足す
  if (booking && booking.time && !TIMES.includes(booking.time)) $('#bk-time').insertAdjacentHTML('beforeend', `<option value="${esc(booking.time)}">${timeLabel(booking.time)}</option>`);
  $('#bk-time').value = booking ? (booking.time || '') : '';
  $('#bk-off').checked = !!(booking && booking.off);
  $('#bk-title').textContent = booking ? '来る日を変える' : '来る日を入れる';
  $('#bk-delete').hidden = !booking;
  resetArmed($('#bk-delete'), 'この予定を消す');
  $('#booking-sheet').hidden = false;
}
// 「新しいお客さん」を選んだときだけ、名前の欄を出す
function toggleNewCustomer() {
  const isNew = $('#bk-customer').value === '__new';
  $('#bk-new-wrap').hidden = !isNew;
  if (isNew) setTimeout(() => $('#bk-new-name').focus(), 50);
}
function closeBookingSheet() {
  const el = $('#booking-sheet');
  if (el) el.hidden = true;
}
function resetArmed(el, text) {
  el.classList.remove('armed');
  el.textContent = text;
}
function setupBookingSheet() {
  $('#bk-cancel').addEventListener('click', closeBookingSheet);
  $('#booking-sheet').addEventListener('click', (e) => { if (e.target.id === 'booking-sheet') closeBookingSheet(); });
  $('#bk-customer').addEventListener('change', toggleNewCustomer);
  // 消すときは2回押しで確定（うっかり防止）
  let armTimer = 0;
  $('#bk-delete').addEventListener('click', async () => {
    const el = $('#bk-delete');
    if (!bookingEdit) return;
    if (!el.classList.contains('armed')) {
      el.classList.add('armed');
      el.textContent = 'もう一度押すと消します';
      clearTimeout(armTimer);
      armTimer = setTimeout(() => resetArmed(el, 'この予定を消す'), 3000);
      return;
    }
    const id = bookingEdit.id;
    state.bookings = state.bookings.filter((b) => b.id !== id);
    try { await dbDelete('bookings', id); } catch (e) { /* 画面からは消す */ }
    closeBookingSheet();
    toast('予定を消しました');
    render();
  });
  $('#booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let customerId = $('#bk-customer').value;
    const date = $('#bk-date').value;
    if (!customerId) { toast('お客さんを選んでください'); return; }
    if (customerId === '__new' && !$('#bk-new-name').value.trim()) { toast('お名前を入れてください'); return; }
    if (!date) { toast('日にちを入れてください'); return; }
    // 新しいお客さんなら、先にお客さんとして登録する
    if (customerId === '__new') {
      const customer = { id: uid('c'), name: $('#bk-new-name').value.trim(), kana: $('#bk-new-kana').value.trim(), createdAt: new Date().toISOString() };
      state.customers.push(customer);
      await safePut('customers', customer);
      customerId = customer.id;
    }
    const fields = { customerId, date, time: $('#bk-time').value, off: $('#bk-off').checked };
    let b;
    if (bookingEdit) {
      b = Object.assign(bookingEdit, fields, { updatedAt: new Date().toISOString() });
    } else {
      b = { id: uid('b'), ...fields, status: 'booked', createdAt: new Date().toISOString() };
      state.bookings.push(b);
    }
    await safePut('bookings', b);
    closeBookingSheet();
    toast(`${dayLabel(date)}${fields.time ? `の${timeLabel(fields.time)}` : ''}に来る予定を入れました`);
    render();
  });
}

// 見本の予定（今日を基準に入れておく）
async function seedBookings() {
  const byName = (n) => state.customers.find((c) => c.sample && c.name === n);
  const today = todayStr();
  const list = [
    { who: '山本 さくら', day: 0, time: '14:00' },
    { who: '高橋 えり', day: 0, time: '', off: true },
    { who: '佐藤 みゆき', day: 1, time: '11:00' },
  ];
  for (const x of list) {
    const c = byName(x.who);
    if (!c) continue;
    const b = { id: uid('b'), customerId: c.id, date: addDays(today, x.day), time: x.time, off: !!x.off, status: 'booked', createdAt: new Date().toISOString(), sample: true };
    state.bookings.push(b);
    await safePut('bookings', b);
  }
}

start();
