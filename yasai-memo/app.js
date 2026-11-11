// お米・野菜メモ：注文や要望を話して記録し、履歴をすぐ見られるようにする
'use strict';

const STORAGE_KEY = 'kome-yasai-memo-v1';
const KINDS = ['お米', '野菜', 'その他'];
const STATUS_FILTERS = [
  { key: 'all', label: 'すべて' },
  { key: 'todo', label: 'まだ渡してない' },
  { key: 'unpaid', label: 'お金まだ' },
];
// 話した内容に金額（「5000円」など）があれば読み取る
const PRICE_PATTERN = /(\d[\d,]*)\s*円/g;
// 話した内容にこの言葉があれば「お金もらった」にする
const PAID_WORDS = /もらった|貰った|受け取った|支払い済|払い済|払ってもらった|代金済/;
// 話した内容から種類を自動でえらぶための言葉
const RICE_WORDS = /米|こめ|コメ|もち米|玄米|白米|精米/;
const VEGETABLE_WORDS = /野菜|やさい|玉ねぎ|たまねぎ|玉葱|じゃがいも|ジャガイモ|さつまいも|里芋|大根|だいこん|人参|にんじん|ニンジン|キャベツ|白菜|はくさい|ねぎ|ネギ|葱|ほうれん草|小松菜|レタス|ブロッコリー|トマト|ミニトマト|きゅうり|キュウリ|なす|ナス|茄子|ピーマン|かぼちゃ|カボチャ|南瓜|オクラ|枝豆|えだまめ|とうもろこし|トウモロコシ|ごぼう|ゴボウ|しいたけ|椎茸|生姜|しょうが|にんにく|ニンニク/;
// 名前のあとに付く呼び方（「田中さん」の「さん」など）
const NAME_PATTERN = /^\s*([^\s、。,，]{1,10}?)(さん|ちゃん|くん|君|様|さま)(から|より|が|の|は)?[、。,，\s]*/;

// ===== 画面の部品 =====
const $ = (id) => document.getElementById(id);
const micButton = $('mic-button');
const micHint = $('mic-hint');
const nameInput = $('name-input');
const nameList = $('name-list');
const recentNames = $('recent-names');
const kindChips = $('kind-chips');
const textInput = $('text-input');
const saveButton = $('save-button');
const cancelEditButton = $('cancel-edit');
const deleteButton = $('delete-button');
const statusText = $('status');
const searchInput = $('search-input');
const filterChips = $('filter-chips');
const historyList = $('history-list');
const historyTitle = $('history-title');
const historyCount = $('history-count');
const priceInput = $('price-input');
const paidToggle = $('paid-toggle');
const summaryCard = $('summary');

// ===== 状態 =====
let records = loadRecords();
let selectedKinds = new Set();
let formPaid = false;     // 入力欄の「お金もらった」
let editingId = null;     // 直している記録のID（新しく書くときは null）
let statusFilter = 'all';
let statusTimer = null;

// ===== 保存と読み込み =====
function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    // 金額の機能を付ける前の記録は、「渡した」ものはお金も済んだことにする
    list.forEach((r) => {
      if (r.paid === undefined) r.paid = !!r.done;
      if (r.price === undefined) r.price = null;
    });
    return list;
  } catch {
    return [];
  }
}

function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    showStatus('保存できませんでした。ブラウザの設定を確かめてください。', true);
    return false;
  }
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ===== 金額 =====
// 全角数字やカンマが入っていても数字にする（読めなければ null）
function toNumber(value) {
  const s = String(value ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[,，円\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function formatYen(n) {
  return `${Number(n || 0).toLocaleString('ja-JP')}円`;
}

// 文の中の「〇〇円」をすべて足す
function findPrice(text) {
  const normalized = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  let total = 0;
  let found = false;
  for (const m of normalized.matchAll(PRICE_PATTERN)) {
    const n = toNumber(m[1]);
    if (n !== null) { total += n; found = true; }
  }
  return found ? total : null;
}

function renderPaidToggle() {
  paidToggle.setAttribute('aria-pressed', String(formPaid));
  paidToggle.textContent = formPaid ? '✓ もらった' : 'まだ';
}

// ===== 入力欄 =====
// ===== 種類（なにを）の追加・整理 =====
const KINDS_KEY = 'kome-yasai-memo-kinds-v1';
const kindEditor = $('kind-editor');
const kindInput = $('kind-input');
const kindRemoveList = $('kind-remove-list');
let kindList = loadKinds();

function loadKinds() {
  try {
    const list = JSON.parse(localStorage.getItem(KINDS_KEY));
    if (Array.isArray(list) && list.length) return list.filter((k) => typeof k === 'string' && k.trim());
  } catch { /* 読めなければはじめの種類を使う */ }
  return [...KINDS];
}

function saveKinds() {
  try { localStorage.setItem(KINDS_KEY, JSON.stringify(kindList)); } catch { /* 保存できなくても画面はそのまま使う */ }
}

// 今の一覧に加えて、直している記録にだけある種類も出す
function getShownKinds() {
  return [...kindList, ...[...selectedKinds].filter((k) => !kindList.includes(k))];
}

function addKind() {
  const kind = kindInput.value.trim().replace(/\s+/g, ' ');
  if (!kind) return;
  if (!kindList.includes(kind)) {
    kindList.push(kind);
    saveKinds();
  }
  selectedKinds.add(kind);
  kindInput.value = '';
  renderKindChips();
  renderKindEditor();
  showStatus(`「${kind}」を追加しました`);
}

function removeKind(kind) {
  kindList = kindList.filter((k) => k !== kind);
  selectedKinds.delete(kind);
  saveKinds();
  renderKindChips();
  renderKindEditor();
}

function renderKindEditor() {
  kindRemoveList.replaceChildren(...kindList.map((kind) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip chip-small';
    button.textContent = `${kind} ×`;
    button.setAttribute('aria-label', `${kind}を消す`);
    button.addEventListener('click', () => removeKind(kind));
    return button;
  }));
}

function toggleKindEditor(open) {
  kindEditor.hidden = !open;
  renderKindChips();
  if (open) {
    renderKindEditor();
    kindInput.focus();
  }
}

// 種類ごとの色（お米・野菜以外は同じ色）
function badgeClass(kind) {
  if (kind === 'お米') return 'badge badge-1';
  if (kind === '野菜') return 'badge badge-2';
  return 'badge badge-3';
}

function renderKindChips() {
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'chip chip-add';
  addButton.textContent = kindEditor.hidden ? '＋ 追加' : '閉じる';
  addButton.addEventListener('click', () => toggleKindEditor(kindEditor.hidden));

  kindChips.replaceChildren(...getShownKinds().map((kind) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = kind;
    button.setAttribute('aria-pressed', String(selectedKinds.has(kind)));
    button.addEventListener('click', () => {
      if (selectedKinds.has(kind)) selectedKinds.delete(kind);
      else selectedKinds.add(kind);
      renderKindChips();
    });
    return button;
  }), addButton);
}

// よく頼む人を、回数の多い順に並べる
function getFrequentNames() {
  const counts = new Map();
  records.forEach((r) => {
    if (r.name) counts.set(r.name, (counts.get(r.name) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

function renderNameHelpers() {
  const names = getFrequentNames();
  nameList.replaceChildren(...names.map((name) => {
    const option = document.createElement('option');
    option.value = name;
    return option;
  }));
  recentNames.replaceChildren(...names.slice(0, 8).map((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip chip-small';
    button.textContent = name;
    button.addEventListener('click', () => {
      nameInput.value = name;
      updateSaveState();
    });
    return button;
  }));
}

function updateSaveState() {
  saveButton.disabled = !textInput.value.trim() && !nameInput.value.trim();
}

// 話した内容から名前と種類を読み取って、空いている欄に入れる
function autoFill() {
  let text = textInput.value;
  if (!nameInput.value.trim()) {
    // まず、これまでに記録したことのある名前が出てきたらそれを使う
    const known = getFrequentNames().find((name) => text.includes(name));
    const match = text.match(NAME_PATTERN);
    if (match) {
      nameInput.value = known && match[1].includes(known) ? known : match[1];
      text = text.slice(match[0].length);
      textInput.value = text;
    } else if (known) {
      nameInput.value = known;
    }
  }
  if (RICE_WORDS.test(text)) selectedKinds.add('お米');
  if (VEGETABLE_WORDS.test(text)) selectedKinds.add('野菜');
  // 自分で追加した種類の名前が出てきたら、それも選ぶ
  kindList.forEach((kind) => {
    if (!KINDS.includes(kind) && text.includes(kind)) selectedKinds.add(kind);
  });
  if (!priceInput.value.trim()) {
    const price = findPrice(text);
    if (price !== null) priceInput.value = String(price);
  }
  if (PAID_WORDS.test(text)) formPaid = true;
  renderPaidToggle();
  renderKindChips();
  updateSaveState();
}

function resetForm() {
  editingId = null;
  nameInput.value = '';
  textInput.value = '';
  priceInput.value = '';
  formPaid = false;
  renderPaidToggle();
  selectedKinds = new Set();
  renderKindChips();
  saveButton.textContent = '記録する';
  cancelEditButton.hidden = true;
  deleteButton.hidden = true;
  updateSaveState();
}

function saveRecord() {
  autoFill();
  const name = nameInput.value.trim();
  const text = textInput.value.trim();
  if (!name && !text) return;
  const kinds = getShownKinds().filter((k) => selectedKinds.has(k));
  const price = toNumber(priceInput.value);
  const paid = formPaid;

  if (editingId) {
    const record = records.find((r) => r.id === editingId);
    if (record) Object.assign(record, { name, text, kinds, price, paid, updatedAt: new Date().toISOString() });
  } else {
    records.unshift({ id: makeId(), createdAt: new Date().toISOString(), name, text, kinds, price, paid, done: false });
  }
  if (!saveRecords()) return;
  showStatus(editingId ? '直しました' : '記録しました ✓');
  resetForm();
  renderAll();
}

function startEdit(id) {
  const record = records.find((r) => r.id === id);
  if (!record) return;
  stopListening();
  editingId = id;
  nameInput.value = record.name || '';
  textInput.value = record.text || '';
  priceInput.value = record.price != null ? String(record.price) : '';
  formPaid = !!record.paid;
  renderPaidToggle();
  selectedKinds = new Set(record.kinds || []);
  renderKindChips();
  saveButton.textContent = '直した内容で保存';
  cancelEditButton.hidden = false;
  deleteButton.hidden = false;
  updateSaveState();
  $('form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteEditing() {
  if (!editingId) return;
  // 消す前に一度だけ押し間違いを防ぐ（ボタンを2回押すと消える）
  if (deleteButton.dataset.confirm !== '1') {
    deleteButton.dataset.confirm = '1';
    deleteButton.textContent = 'もう一度押すと消えます';
    setTimeout(() => {
      deleteButton.dataset.confirm = '';
      deleteButton.textContent = 'この記録を消す';
    }, 3000);
    return;
  }
  records = records.filter((r) => r.id !== editingId);
  deleteButton.dataset.confirm = '';
  deleteButton.textContent = 'この記録を消す';
  saveRecords();
  showStatus('消しました');
  resetForm();
  renderAll();
}

function toggleDone(id) {
  const record = records.find((r) => r.id === id);
  if (!record) return;
  record.done = !record.done;
  record.doneAt = record.done ? new Date().toISOString() : null;
  saveRecords();
  renderHistory();
}

function togglePaid(id) {
  const record = records.find((r) => r.id === id);
  if (!record) return;
  record.paid = !record.paid;
  record.paidAt = record.paid ? new Date().toISOString() : null;
  saveRecords();
  renderSummary();
  renderHistory();
}

// ===== まとめ（今月の売上・お金まだの分） =====
function renderSummary() {
  const now = new Date();
  let monthTotal = 0;
  const unpaidByName = new Map();
  records.forEach((r) => {
    const d = new Date(r.createdAt);
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) monthTotal += r.price || 0;
    if (!r.paid && r.price) {
      const key = r.name || '（名前なし）';
      unpaidByName.set(key, (unpaidByName.get(key) || 0) + r.price);
    }
  });
  const unpaidTotal = [...unpaidByName.values()].reduce((a, b) => a + b, 0);

  const grid = document.createElement('div');
  grid.className = 'summary-grid';
  grid.innerHTML = `
    <div><p class="summary-label">${now.getMonth() + 1}月の売上</p><p class="summary-value"></p></div>
    <div><p class="summary-label">お金まだ</p><p class="summary-value${unpaidTotal ? ' is-unpaid' : ''}"></p></div>`;
  const values = grid.querySelectorAll('.summary-value');
  values[0].textContent = formatYen(monthTotal);
  values[1].textContent = formatYen(unpaidTotal);

  // お金まだの人を、金額の多い順に並べる（押すとその人の履歴になる）
  const people = document.createElement('div');
  people.className = 'chip-row summary-people';
  [...unpaidByName.entries()].sort((a, b) => b[1] - a[1]).forEach(([name, amount]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip chip-small';
    button.textContent = `${name} ${formatYen(amount)}`;
    button.addEventListener('click', () => {
      searchInput.value = name === '（名前なし）' ? '' : name;
      statusFilter = 'unpaid';
      renderFilterChips();
      renderHistory();
    });
    people.append(button);
  });
  summaryCard.replaceChildren(grid, people);
}

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('is-error', isError);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusText.textContent = ''; }, 4000);
}

// ===== 履歴 =====
function renderFilterChips() {
  filterChips.replaceChildren(...STATUS_FILTERS.map(({ key, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip chip-small';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(statusFilter === key));
    button.addEventListener('click', () => {
      statusFilter = key;
      renderFilterChips();
      renderHistory();
    });
    return button;
  }));
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function formatDate(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`;
}
function formatTime(date) {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getFilteredRecords() {
  // 空白で区切った言葉がすべて含まれるものを出す
  const words = searchInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return records.filter((r) => {
    if (statusFilter === 'todo' && r.done) return false;
    if (statusFilter === 'unpaid' && r.paid) return false;
    const haystack = `${r.name} ${r.text} ${(r.kinds || []).join(' ')}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

function renderHistory() {
  const list = getFilteredRecords();
  const query = searchInput.value.trim();
  const isPerson = query && records.some((r) => r.name === query);
  historyTitle.textContent = isPerson ? `${query}さんの履歴` : '履歴';
  // 表示している分の合計とお金まだの分
  const total = list.reduce((sum, r) => sum + (r.price || 0), 0);
  const unpaid = list.reduce((sum, r) => sum + (r.paid ? 0 : r.price || 0), 0);
  historyCount.textContent = list.length
    ? `${list.length}件・合計 ${formatYen(total)}${unpaid ? `（お金まだ ${formatYen(unpaid)}）` : ''}`
    : '';

  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = records.length ? '当てはまる記録はありません' : 'まだ記録はありません。上のマイクを押して話してみてください。';
    historyList.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  let lastDay = '';
  list.forEach((record) => {
    const date = new Date(record.createdAt);
    const day = formatDate(date);
    if (day !== lastDay) {
      const heading = document.createElement('h3');
      heading.className = 'day-heading';
      heading.textContent = date.getFullYear() === new Date().getFullYear() ? day : `${date.getFullYear()}年${day}`;
      fragment.append(heading);
      lastDay = day;
    }
    fragment.append(renderItem(record, date));
  });
  historyList.replaceChildren(fragment);
}

function renderItem(record, date) {
  const item = document.createElement('article');
  // 渡してお金ももらったら、薄く表示する
  item.className = 'item' + (record.done && record.paid ? ' is-done' : '');

  const top = document.createElement('div');
  top.className = 'item-top';
  const time = document.createElement('span');
  time.className = 'item-time';
  time.textContent = formatTime(date);
  top.append(time);
  if (record.name) {
    // 名前を押すと、その人の履歴だけにしぼる
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'item-name';
    name.textContent = record.name;
    name.addEventListener('click', () => {
      searchInput.value = record.name;
      renderHistory();
      searchInput.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    top.append(name);
  }
  (record.kinds || []).forEach((kind) => {
    const badge = document.createElement('span');
    badge.className = badgeClass(kind);
    badge.textContent = kind;
    top.append(badge);
  });
  if (record.price != null) {
    const price = document.createElement('span');
    price.className = 'item-price';
    price.textContent = formatYen(record.price);
    top.append(price);
  }

  const text = document.createElement('p');
  text.className = 'item-text';
  text.textContent = record.text || '（内容なし）';

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'done-button';
  done.setAttribute('aria-pressed', String(!!record.done));
  done.textContent = record.done ? '✓ 渡した' : 'まだ渡してない';
  done.addEventListener('click', () => toggleDone(record.id));
  const pay = document.createElement('button');
  pay.type = 'button';
  pay.className = 'pay-button';
  pay.setAttribute('aria-pressed', String(!!record.paid));
  pay.textContent = record.paid ? '✓ お金OK' : 'お金まだ';
  pay.addEventListener('click', () => togglePaid(record.id));
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'edit-button';
  edit.textContent = '直す';
  edit.addEventListener('click', () => startEdit(record.id));
  actions.append(done, pay, edit);

  item.append(top, text, actions);
  return item;
}

function renderAll() {
  renderNameHelpers();
  renderSummary();
  renderHistory();
}

// ===== 音声入力 =====
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let wantListening = false; // 利用者が録音を続けたいかどうか
let textBefore = '';       // 録音を始める前に書かれていた文字
let silenceTimer = null;

function setupSpeech() {
  if (!SpeechRecognition) {
    micButton.hidden = true;
    micHint.textContent = 'このブラウザは音声入力に対応していません。キーボードのマイクボタンを使ってください。';
    return;
  }
  recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.interimResults = true;
  // Android の Chrome は continuous=true だと文字が重複するため、
  // 1回ずつ認識して、終わったら自動で再開する方式にする
  recognition.continuous = false;

  recognition.onresult = (event) => {
    let interim = '';
    let finals = '';
    for (let i = 0; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finals += transcript;
      else interim += transcript;
    }
    // event.results には今回の録音の最初からの結果がすべて入っている
    textInput.value = textBefore + finals + interim;
    resetSilenceTimer();
    updateSaveState();
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      wantListening = false;
      micHint.textContent = 'マイクが許可されていません。ブラウザの設定でマイクを許可してください。';
    }
  };

  recognition.onend = () => {
    // 話し続けたいときは自動で再開する
    if (wantListening) {
      textBefore = textInput.value;
      try { recognition.start(); return; } catch { /* 再開できなければ止める */ }
    }
    finishListening();
  };
}

function resetSilenceTimer() {
  clearTimeout(silenceTimer);
  // しばらく何も話さなければ自動で止める
  silenceTimer = setTimeout(stopListening, 8000);
}

function startListening() {
  if (!recognition) return;
  wantListening = true;
  textBefore = textInput.value ? textInput.value.replace(/\s*$/, '') + (textInput.value.trim() ? '、' : '') : '';
  micButton.setAttribute('aria-pressed', 'true');
  micHint.textContent = '聞いています…（もう一度押すと止まります）';
  resetSilenceTimer();
  try { recognition.start(); } catch { /* すでに動いているときは何もしない */ }
}

function stopListening() {
  if (!wantListening) return;
  wantListening = false;
  clearTimeout(silenceTimer);
  try { recognition.stop(); } catch { finishListening(); }
}

function finishListening() {
  clearTimeout(silenceTimer);
  micButton.setAttribute('aria-pressed', 'false');
  micHint.innerHTML = 'タップして話す<br><small>例：「田中さん、お米10キロ5000円、もらった」</small>';
  autoFill();
}

micButton.addEventListener('click', () => {
  if (wantListening) stopListening();
  else startListening();
});

// ===== バックアップ =====
function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

$('export-json').addEventListener('click', () => {
  download(`kome-yasai-memo-${todayStamp()}.json`, JSON.stringify(records, null, 2), 'application/json');
});

$('export-csv').addEventListener('click', () => {
  const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['日時', '名前', '種類', '内容', '金額', '渡した', 'お金'].map(quote).join(',')];
  records.forEach((r) => {
    const d = new Date(r.createdAt);
    const when = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${formatTime(d)}`;
    rows.push([when, r.name, (r.kinds || []).join('・'), r.text, r.price ?? '', r.done ? '済' : '', r.paid ? '済' : 'まだ'].map(quote).join(','));
  });
  // Excel で文字化けしないよう先頭に BOM を付ける
  download(`kome-yasai-memo-${todayStamp()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv');
});

$('import-json').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const list = JSON.parse(await file.text());
    if (!Array.isArray(list)) throw new Error('形式が違います');
    // 今ある記録は残し、まだないものだけ足す
    const ids = new Set(records.map((r) => r.id));
    const added = list.filter((r) => r && r.id && r.createdAt && !ids.has(r.id));
    records = [...records, ...added].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    saveRecords();
    // 戻した記録にある種類を「なにを」にも足す
    added.forEach((r) => (r.kinds || []).forEach((k) => {
      if (typeof k === 'string' && k && !kindList.includes(k)) kindList.push(k);
    }));
    saveKinds();
    renderKindChips();
    renderAll();
    showStatus(`${added.length}件を戻しました`);
  } catch {
    showStatus('バックアップのファイルを読み込めませんでした', true);
  }
});

// ===== はじめの設定 =====
nameInput.addEventListener('input', updateSaveState);
textInput.addEventListener('input', updateSaveState);
$('kind-add').addEventListener('click', addKind);
$('kind-close').addEventListener('click', () => toggleKindEditor(false));
kindInput.addEventListener('keydown', (event) => {
  // 変換の確定中の Enter では追加しない
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    addKind();
  }
});
paidToggle.addEventListener('click', () => {
  formPaid = !formPaid;
  renderPaidToggle();
});
saveButton.addEventListener('click', saveRecord);
cancelEditButton.addEventListener('click', resetForm);
deleteButton.addEventListener('click', deleteEditing);
searchInput.addEventListener('input', renderHistory);

renderKindChips();
renderFilterChips();
renderAll();
setupSpeech();

// ブラウザが勝手に記録を消さないようお願いしておく
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
}
