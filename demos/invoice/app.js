// ===== 請求書：入力・自動計算・発行履歴 =====

const STORAGE_KEY = "invoice-demo:v1";

// 初期値（デモ用の架空の情報）
const DEFAULT_FIELDS = {
  shopName: "みどり農園（デモ）",
  client: "",
  clientAddress: "",
  number: "",
  issueDate: "",
  due: "到着から7日以内",
  address: "000-0000 〇〇県〇〇市みどり町1-2-3",
  tel: "000-0000-0000",
  bankName: "サンプル銀行",
  branch: "本店(店番:001)",
  accountType: "普通",
  accountNo: "1234567",
  accountName: "ミドリ タロウ",
  note: "※ これはデモ用の架空の情報です。",
};

// 品目の初期設定（kind: crop=作物, ship=送料）
const DEFAULT_PRODUCTS = [
  { kind: "crop", name: "お米 10kg", unit: "袋", price: 4500 },
  { kind: "crop", name: "お米 5kg", unit: "袋", price: 2400 },
  { kind: "crop", name: "季節の野菜セット", unit: "箱", price: 2000 },
  { kind: "ship", name: "送料(一箱)", unit: "箱", price: 900 },
];

// お客さん名簿の初期値（デモ用の架空の人物）
const DEFAULT_CUSTOMERS = [
  { name: "山田 花子", address: "000-0001 〇〇県〇〇市さくら町4-5", tel: "000-0000-0001", showAddress: true },
  { name: "佐藤 一郎", address: "000-0002 〇〇県〇〇市ひばり町6-7", tel: "", showAddress: false },
];

// 発行履歴の初期値（今年の番号で2件）
function defaultHistory() {
  const year = new Date().getFullYear();
  return [
    {
      number: `${year}-001`, issueDate: `${year}/9/12`, client: "山田 花子", clientAddress: "",
      items: [
        { name: "お米 10kg", qty: "2", unit: "袋", price: "4500" },
        { name: "送料(一箱)", qty: "2", unit: "箱", price: "900" },
      ],
      total: 10800, method: "PDF", copied: false,
    },
    {
      number: `${year}-002`, issueDate: `${year}/10/3`, client: "佐藤 一郎", clientAddress: "",
      items: [
        { name: "季節の野菜セット", qty: "1", unit: "箱", price: "2000" },
        { name: "送料(一箱)", qty: "1", unit: "箱", price: "900" },
      ],
      total: 2900, method: "印刷", copied: false,
    },
  ];
}

const KIND_LABELS = { crop: "作物", ship: "送料", other: "その他" };

const emptyItem = () => ({ name: "", qty: "1", unit: "", price: "" });

let state = load();

// 保存データの読み込み（なければ初期値）
function load() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    saved = null;
  }
  const data = {
    fields: { ...DEFAULT_FIELDS, ...(saved && saved.fields) },
    items: (saved && saved.items && saved.items.length) ? saved.items : [emptyItem()],
    products: normalizeProducts(saved && saved.products),
    history: (saved && Array.isArray(saved.history)) ? saved.history : defaultHistory(),
    sheetUrl: (saved && saved.sheetUrl) || "",
    customers: (saved && Array.isArray(saved.customers)) ? saved.customers : DEFAULT_CUSTOMERS.map((c) => ({ ...c })),
  };
  if (!data.fields.issueDate) data.fields.issueDate = today();
  if (!data.fields.number) data.fields.number = nextNumber(data.history);
  return data;
}

// 以前の保存形式（品名をキーにしたオブジェクト）も読めるようにする
function normalizeProducts(products) {
  if (Array.isArray(products)) return products;
  if (products && typeof products === "object") {
    return Object.entries(products).map(([name, p]) => ({
      kind: name.includes("送料") ? "ship" : "crop",
      name,
      unit: p.unit || "",
      price: p.price || 0,
    }));
  }
  return DEFAULT_PRODUCTS.map((p) => ({ ...p }));
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // 保存できない環境でも画面は動かす
  }
}

// 今日の日付（例: 2026/10/26）
function today() {
  const d = new Date();
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// 次の請求番号（例: 2026-001）。その年の履歴の最大番号＋1
function nextNumber(history) {
  const year = new Date().getFullYear();
  let max = 0;
  history.forEach((h) => {
    const m = String(h.number).match(new RegExp(`^${year}-(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `${year}-${String(max + 1).padStart(3, "0")}`;
}

// 全角数字・カンマ・「円」などを取り除いて数値にする
function toNumber(value) {
  const half = String(value)
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9.]/g, "");
  const n = parseFloat(half);
  return Number.isFinite(n) ? n : 0;
}

const yen = (n) => `${Math.round(n).toLocaleString("ja-JP")}円`;

// 画面下に短いお知らせを出す
let toastTimer = null;
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

// 確認ダイアログの代わりに「3秒以内にもう一度押したら実行」にする
function confirmByDoubleClick(button, armedLabel, action) {
  if (button.dataset.armed) {
    clearTimeout(Number(button.dataset.armed));
    delete button.dataset.armed;
    button.textContent = button.dataset.label;
    button.classList.remove("armed");
    action();
    return;
  }
  button.dataset.label = button.textContent;
  button.textContent = armedLabel;
  button.classList.add("armed");
  button.dataset.armed = setTimeout(() => {
    delete button.dataset.armed;
    button.textContent = button.dataset.label;
    button.classList.remove("armed");
  }, 3000);
}

// ===== 請求書の固定情報（クリックで書き換え可能な文字） =====
function renderFields() {
  document.querySelectorAll("[data-key]").forEach((el) => {
    const value = state.fields[el.dataset.key] ?? "";
    if (el.tagName === "INPUT") el.value = value;
    else el.textContent = value;
  });
}

document.querySelectorAll("[data-key]").forEach((el) => {
  el.addEventListener("input", () => {
    state.fields[el.dataset.key] = el.tagName === "INPUT" ? el.value : el.innerText.trim();
    if (el.id === "client") renderCustomerButtons();
    save();
  });
  // 中身を全部消したら本当に空にする（案内文の表示と印刷時の非表示のため）
  el.addEventListener("blur", () => {
    if (el.tagName !== "INPUT" && !el.innerText.trim()) el.textContent = "";
  });
});

// ===== 明細 =====
const rowsEl = document.getElementById("item-rows");

const findProduct = (name) => state.products.find((p) => p.name === name.trim());

function renderItems() {
  rowsEl.innerHTML = "";
  state.items.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input list="product-list" data-field="name" placeholder="品名"></td>
      <td><div class="qty"><input inputmode="decimal" data-field="qty"><input data-field="unit" placeholder="単位"></div></td>
      <td><div class="price"><input inputmode="numeric" data-field="price" placeholder="0"><span>円</span></div></td>
      <td class="amount"></td>
      <td class="no-print"><button type="button" class="del" title="この行を削除" aria-label="この行を削除">×</button></td>`;

    tr.querySelectorAll("input").forEach((input) => {
      input.value = item[input.dataset.field];
      input.addEventListener("input", () => {
        item[input.dataset.field] = input.value;
        // 登録済みの品名を入力したら単位と単価を自動入力
        const product = input.dataset.field === "name" && findProduct(input.value);
        if (product) {
          item.unit = product.unit;
          item.price = String(product.price);
          tr.querySelector('[data-field="unit"]').value = item.unit;
          tr.querySelector('[data-field="price"]').value = item.price;
        }
        calculate();
        save();
      });
    });

    tr.querySelector(".del").addEventListener("click", () => {
      state.items.splice(index, 1);
      if (!state.items.length) state.items.push(emptyItem());
      renderItems();
      save();
    });

    rowsEl.appendChild(tr);
  });
  calculate();
}

const isEmptyItem = (item) => !item.name.trim() && !toNumber(item.price);
const itemAmount = (item) => Math.round(toNumber(item.qty) * toNumber(item.price));

// 金額（数量×単価）と合計を計算して表示
function calculate() {
  [...rowsEl.rows].forEach((tr, i) => {
    const item = state.items[i];
    const empty = isEmptyItem(item);
    tr.classList.toggle("is-empty", empty);
    tr.querySelector(".amount").textContent = empty ? "" : yen(itemAmount(item));
  });
  const total = invoiceTotal(state.items);
  document.getElementById("sum-total").textContent = yen(total);
  document.getElementById("grand-total").textContent = yen(total);
}

const invoiceTotal = (items) => items.reduce((sum, item) => sum + itemAmount(item), 0);

// 品目ボタンを押したとき：同じ品目があれば数量+1、なければ行を追加
function addProductToInvoice(product) {
  const existing = state.items.find((item) => item.name.trim() === product.name);
  if (existing) {
    existing.qty = String(toNumber(existing.qty) + 1);
  } else {
    const newItem = { name: product.name, qty: "1", unit: product.unit, price: String(product.price) };
    const blankIndex = state.items.findIndex(isEmptyItem);
    if (blankIndex >= 0) state.items[blankIndex] = newItem;
    else state.items.push(newItem);
  }
  renderItems();
  save();
}

// ===== 品目ボタン =====
function renderQuickButtons() {
  const wrap = document.getElementById("quick-buttons");
  wrap.innerHTML = "";
  state.products
    .filter((p) => p.name.trim())
    .forEach((product) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `quick kind-${product.kind}`;
      button.innerHTML = `<span class="quick-name"></span><span class="quick-price"></span>`;
      button.querySelector(".quick-name").textContent = product.name;
      button.querySelector(".quick-price").textContent =
        `${yen(toNumber(product.price))}${product.unit ? " / " + product.unit : ""}`;
      button.addEventListener("click", () => addProductToInvoice(product));
      wrap.appendChild(button);
    });
  if (!wrap.children.length) {
    wrap.innerHTML = '<p class="hint">下の「品目の設定」で作物や送料を登録すると、ここにボタンが出ます。</p>';
  }
}

// 品名入力欄の候補
function renderProductList() {
  const list = document.getElementById("product-list");
  list.innerHTML = "";
  state.products.forEach((p) => {
    if (!p.name.trim()) return;
    const option = document.createElement("option");
    option.value = p.name;
    list.appendChild(option);
  });
}

// ===== 品目の設定 =====
const productEditor = document.getElementById("product-editor");

function renderProductEditor() {
  productEditor.innerHTML = "";
  state.products.forEach((product, index) => {
    const row = document.createElement("div");
    row.className = "product-row";
    row.innerHTML = `
      <select data-field="kind" aria-label="区分">
        ${Object.entries(KIND_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
      </select>
      <input data-field="name" placeholder="品名" aria-label="品名">
      <input data-field="unit" placeholder="袋" aria-label="単位">
      <input data-field="price" inputmode="numeric" placeholder="0" aria-label="単価">
      <button type="button" class="del" title="この品目を削除" aria-label="この品目を削除">×</button>`;

    row.querySelectorAll("[data-field]").forEach((input) => {
      input.value = product[input.dataset.field];
      input.addEventListener("input", () => {
        const field = input.dataset.field;
        product[field] = field === "price" ? toNumber(input.value) : input.value;
        renderQuickButtons();
        renderProductList();
        save();
      });
    });

    row.querySelector(".del").addEventListener("click", (e) => {
      confirmByDoubleClick(e.currentTarget, "削除?", () => {
        state.products.splice(index, 1);
        renderProducts();
        save();
      });
    });

    productEditor.appendChild(row);
  });
}

function renderProducts() {
  renderProductEditor();
  renderQuickButtons();
  renderProductList();
}

document.getElementById("btn-add-product").addEventListener("click", () => {
  state.products.push({ kind: "crop", name: "", unit: "", price: 0 });
  renderProductEditor();
  save();
  productEditor.lastElementChild.querySelector('[data-field="name"]').focus();
});

// ===== 発行履歴 =====
const isIssued = () => state.history.some((h) => h.number === state.fields.number);

// 印刷・PDF・送信のたびに履歴へ記録（同じ請求番号なら上書き）
function recordIssue(method) {
  const filled = state.items.filter((item) => !isEmptyItem(item));
  const entry = {
    number: state.fields.number,
    issueDate: state.fields.issueDate,
    client: state.fields.client.trim(),
    clientAddress: state.fields.clientAddress,
    items: filled.map((item) => ({ ...item })),
    total: invoiceTotal(filled),
    method,
    copied: false,
  };
  const index = state.history.findIndex((h) => h.number === entry.number);
  if (index >= 0) state.history[index] = entry;
  else state.history.push(entry);
  save();
  renderHistory();
  renderClientList();
  toast(`請求番号 ${entry.number} を発行履歴に記録しました。次は「新規作成」を押してください。`);
  sendPendingToSheet();
}

// 発行前の入力チェック
function readyToIssue() {
  if (!state.items.some((item) => !isEmptyItem(item))) {
    toast("明細が空です。品目ボタンを押すか、明細を入力してください。");
    return false;
  }
  if (!state.fields.client.trim()) {
    toast("宛名を入力してください。");
    document.getElementById("client").focus();
    return false;
  }
  return true;
}

function renderHistory() {
  const body = document.getElementById("history-rows");
  body.innerHTML = "";
  if (!state.history.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">まだ発行した請求書はありません。</td></tr>';
    return;
  }
  [...state.history].reverse().forEach((entry) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td></td><td></td><td></td><td class="num"></td><td></td><td></td>
      <td class="actions"><button type="button" class="copy">同じ内容で作る</button><button type="button" class="open">開く</button><button type="button" class="del">削除</button></td>`;
    const cells = tr.querySelectorAll("td");
    cells[0].textContent = entry.number;
    cells[1].textContent = entry.issueDate;
    cells[2].textContent = entry.client ? `${entry.client} 様` : "";
    cells[3].textContent = yen(entry.total);
    cells[4].textContent = entry.method;
    cells[5].textContent = entry.copied ? "済" : "未";

    // 前回と同じ宛名・明細で、新しい番号と今日の日付の請求書を作る
    tr.querySelector(".copy").addEventListener("click", () => {
      loadInvoice(entry, { number: nextNumber(state.history), issueDate: today() });
      toast(`請求番号 ${entry.number} と同じ内容で、新しい請求書（${state.fields.number}）を作りました。`);
    });

    // 過去の請求書をそのまま開いて、再印刷や修正ができるようにする
    tr.querySelector(".open").addEventListener("click", () => {
      loadInvoice(entry, { number: entry.number, issueDate: entry.issueDate });
      toast(`請求番号 ${entry.number} を開きました。印刷するとこの記録が上書きされます。`);
    });

    tr.querySelector(".del").addEventListener("click", (e) => {
      confirmByDoubleClick(e.currentTarget, "削除?", () => {
        state.history = state.history.filter((h) => h !== entry);
        save();
        renderHistory();
      });
    });

    body.appendChild(tr);
  });
}

// 履歴の内容を請求書に読み込む
function loadInvoice(entry, { number, issueDate }) {
  state.fields.number = number;
  state.fields.issueDate = issueDate;
  state.fields.client = entry.client;
  state.fields.clientAddress = entry.clientAddress || "";
  state.items = entry.items.length ? entry.items.map((item) => ({ ...item })) : [emptyItem()];
  renderFields();
  renderItems();
  renderCustomerButtons();
  save();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ===== お客さん名簿 =====
const customerEditor = document.getElementById("customer-editor");
const customerFilter = document.getElementById("customer-filter");

// 請求書に載せる住所・電話の文字
const customerAddressText = (c) =>
  [c.address.trim(), c.tel.trim() ? `TEL ${c.tel.trim()}` : ""].filter(Boolean).join("\n");

function selectCustomer(customer) {
  state.fields.client = customer.name.trim();
  state.fields.clientAddress = customer.showAddress ? customerAddressText(customer) : "";
  renderFields();
  renderCustomerButtons();
  save();
}

function renderCustomerButtons() {
  const wrap = document.getElementById("customer-buttons");
  const keyword = customerFilter.value.trim();
  wrap.innerHTML = "";
  const list = state.customers.filter((c) => c.name.trim() && (!keyword || c.name.includes(keyword)));
  list.forEach((customer) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick customer";
    button.classList.toggle("selected", customer.name.trim() === state.fields.client.trim());
    button.innerHTML = `<span class="quick-name"></span><span class="quick-price"></span>`;
    button.querySelector(".quick-name").textContent = `${customer.name} 様`;
    button.querySelector(".quick-price").textContent = customer.address.trim() || "（住所なし）";
    button.addEventListener("click", () => selectCustomer(customer));
    wrap.appendChild(button);
  });
  if (!state.customers.length) {
    wrap.innerHTML = '<p class="hint">下の「お客さん名簿」で登録すると、ここにボタンが出ます。</p>';
  } else if (!list.length) {
    wrap.innerHTML = '<p class="hint">該当するお客さんがいません。</p>';
  }
}
customerFilter.addEventListener("input", renderCustomerButtons);

function renderCustomerEditor() {
  customerEditor.innerHTML = "";
  state.customers.forEach((customer, index) => {
    const row = document.createElement("div");
    row.className = "customer-row";
    row.innerHTML = `
      <input type="text" data-field="name" placeholder="お名前" aria-label="お名前">
      <input type="text" data-field="address" placeholder="〒・住所" aria-label="住所">
      <input type="text" data-field="tel" placeholder="電話番号" aria-label="電話番号">
      <div class="row-foot">
        <label><input type="checkbox" data-field="showAddress">請求書に住所を載せる</label>
        <button type="button" class="del">削除</button>
      </div>`;

    row.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.dataset.field;
      if (input.type === "checkbox") input.checked = !!customer[field];
      else input.value = customer[field] || "";
      input.addEventListener(input.type === "checkbox" ? "change" : "input", () => {
        customer[field] = input.type === "checkbox" ? input.checked : input.value;
        renderCustomerButtons();
        save();
      });
    });

    row.querySelector(".del").addEventListener("click", (e) => {
      confirmByDoubleClick(e.currentTarget, "削除?", () => {
        state.customers.splice(index, 1);
        renderCustomers();
        save();
      });
    });

    customerEditor.appendChild(row);
  });
  if (!state.customers.length) {
    customerEditor.innerHTML = '<p class="hint">まだ登録がありません。</p>';
  }
}

function renderCustomers() {
  renderCustomerEditor();
  renderCustomerButtons();
}

function addCustomer(customer) {
  state.customers.push(customer);
  renderCustomers();
  save();
  const rows = customerEditor.querySelectorAll(".customer-row");
  rows[rows.length - 1].querySelector('[data-field="name"]').focus();
}

document.getElementById("btn-add-customer").addEventListener("click", () => {
  addCustomer({ name: "", address: "", tel: "", showAddress: false });
});

// 今請求書に入っている宛名・住所を名簿に登録する
document.getElementById("btn-add-current-customer").addEventListener("click", () => {
  const name = state.fields.client.trim();
  if (!name) {
    toast("請求書の宛名が空です。先に宛名を入力してください。");
    return;
  }
  if (state.customers.some((c) => c.name.trim() === name)) {
    toast(`${name} 様はもう名簿に登録されています。`);
    return;
  }
  const address = state.fields.clientAddress.trim();
  addCustomer({ name, address: address.replace(/\n/g, " "), tel: "", showAddress: !!address });
  toast(`${name} 様を名簿に追加しました。`);
});

// 宛名の候補（過去に請求した相手）
function renderClientList() {
  const list = document.getElementById("client-list");
  list.innerHTML = "";
  [...new Set(state.history.map((h) => h.client).filter(Boolean))].forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    list.appendChild(option);
  });
}

// ===== スプレッドシート用の書き出し =====
const SHEET_HEADER = ["請求番号", "発行日", "宛名", "明細", "作物代", "送料", "合計", "発行方法", "入金確認"];

function sheetRow(entry) {
  let crop = 0;
  let ship = 0;
  entry.items.forEach((item) => {
    const product = findProduct(item.name);
    const kind = product ? product.kind : (item.name.includes("送料") ? "ship" : "crop");
    if (kind === "ship") ship += itemAmount(item);
    else crop += itemAmount(item);
  });
  const detail = entry.items
    .map((item) => `${item.name}×${toNumber(item.qty)}${item.unit}`)
    .join("、");
  return [entry.number, entry.issueDate, entry.client, detail, crop, ship, entry.total, entry.method, ""];
}

// まだスプレッドシートに貼っていない分をタブ区切りでコピー
document.getElementById("btn-copy-new").addEventListener("click", async () => {
  const targets = state.history.filter((h) => !h.copied);
  if (!targets.length) {
    toast("新しくコピーする請求書はありません。");
    return;
  }
  const clean = (v) => String(v).replace(/[\t\r\n]+/g, " ");
  const text = targets.map((h) => sheetRow(h).map(clean).join("\t")).join("\n");
  const copied = await copyText(text);
  if (!copied) {
    toast("コピーできませんでした。「全件をCSVで保存」を使ってください。");
    return;
  }
  targets.forEach((h) => { h.copied = true; });
  save();
  renderHistory();
  toast(`${targets.length}件コピーしました。スプレッドシートの空いている行の左端に貼り付けてください。`);
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // 古い方法で再挑戦
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

// ===== Googleスプレッドシートへ自動送信 =====
// デモ版はスプレッドシートに送らないので合言葉は持たない
const SHEET_TOKEN = "";

const sheetUrlInput = document.getElementById("sheet-url");
const sheetStatus = document.getElementById("sheet-status");

function showSheetStatus(message, kind) {
  sheetStatus.textContent = message;
  sheetStatus.className = `sheet-status ${kind || ""}`;
}

// Apps Script のウェブアプリへ送る（送れなかったら例外）
async function postToSheet(payload) {
  const response = await fetch(state.sheetUrl, {
    method: "POST",
    // text/plain にすると事前確認（CORS）なしで送れる
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: SHEET_TOKEN, ...payload }),
  }).catch(() => {
    throw new Error("インターネット接続かURLを確認してください");
  });
  const result = await response.json().catch(() => {
    throw new Error("スプレッドシートから正しい返事がありませんでした");
  });
  if (!result.ok) throw new Error(result.error || "スプレッドシート側でエラーが起きました");
  return result;
}

// まだスプレッドシートに入っていない履歴をまとめて送る
let sending = false;
async function sendPendingToSheet() {
  // デモ版では送信しない
  return;
  const targets = state.history.filter((h) => !h.copied);
  if (!targets.length) return;
  sending = true;
  let sent = 0;
  try {
    for (const entry of targets) {
      await postToSheet({ action: "upsert", row: sheetRow(entry) });
      entry.copied = true;
      sent += 1;
      save();
    }
    toast(`Googleスプレッドシートに${sent}件追加しました。`);
    showSheetStatus(`最後の送信：${new Date().toLocaleString("ja-JP")} に${sent}件送りました。`, "ok");
  } catch (e) {
    toast("Googleスプレッドシートに送れませんでした。次に発行したとき、または画面を開き直したときに再送します。");
    showSheetStatus(`送信できませんでした：${e.message}`, "error");
  } finally {
    sending = false;
    renderHistory();
  }
}

sheetUrlInput.value = "";
sheetUrlInput.disabled = true;
document.getElementById("btn-sheet-test").disabled = true;
showSheetStatus("デモ版では、スプレッドシート連携は使えません。発行履歴は「スプレッドシートに貼る用にコピー」と「全件をCSVで保存」で試せます。");
sheetUrlInput.addEventListener("change", () => {
  state.sheetUrl = sheetUrlInput.value.trim();
  save();
  renderHistory();
});

document.getElementById("btn-sheet-test").addEventListener("click", async () => {
  if (sheetUrlInput.disabled) return;
  state.sheetUrl = sheetUrlInput.value.trim();
  save();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(state.sheetUrl)) {
    showSheetStatus("URLの形が違います。「https://script.google.com/」で始まり「/exec」で終わるURLを貼り付けてください。", "error");
    return;
  }
  showSheetStatus("接続を確認しています…");
  try {
    await postToSheet({ action: "ping" });
    showSheetStatus("接続できました。これから発行する請求書は自動でスプレッドシートに追加されます。", "ok");
    renderHistory();
    sendPendingToSheet();
  } catch (e) {
    showSheetStatus(`接続できませんでした：${e.message}。URLと、デプロイ時の「アクセスできるユーザー：全員」を確認してください。`, "error");
  }
});

// 全件をCSV（Excelで文字化けしない形式）で保存
document.getElementById("btn-csv").addEventListener("click", () => {
  if (!state.history.length) {
    toast("まだ発行した請求書はありません。");
    return;
  }
  const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [SHEET_HEADER, ...state.history.map(sheetRow)].map((row) => row.map(quote).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `請求書履歴_${today().replace(/\//g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

// ===== バックアップ =====
const backupStatus = document.getElementById("backup-status");

// 全データをJSONファイルとして保存
document.getElementById("btn-backup").addEventListener("click", () => {
  const backup = { app: "invoice-demo", version: 1, savedAt: new Date().toISOString(), data: state };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `請求書バックアップ_${today().replace(/\//g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  backupStatus.textContent = "バックアップを「ダウンロード」フォルダに保存しました。USBメモリやGoogleドライブにも入れておくと安心です。";
});

// ファイルを選んだら内容を確認し、「復元する」を押したら置き換える
document.getElementById("restore-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch (err) {
    backupStatus.textContent = "このファイルは読み込めませんでした。「請求書バックアップ_日付.json」を選んでください。";
    return;
  }
  const data = backup && backup.app === "invoice-demo" && backup.data;
  if (!data || !data.fields) {
    backupStatus.textContent = "請求書のバックアップファイルではないようです。「請求書バックアップ_日付.json」を選んでください。";
    return;
  }
  const savedAt = new Date(backup.savedAt).toLocaleString("ja-JP");
  backupStatus.textContent =
    `${savedAt} のバックアップです（品目${(data.products || []).length}件・お客さん${(data.customers || []).length}件・発行履歴${(data.history || []).length}件）。今のデータをこの内容に置き換えます。`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary restore-confirm";
  button.textContent = "復元する";
  button.addEventListener("click", () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      backupStatus.textContent = "復元できませんでした。ブラウザの保存領域が使えない状態です。";
      return;
    }
    location.reload();
  });
  backupStatus.appendChild(document.createElement("br"));
  backupStatus.appendChild(button);
});

// ===== 上部ボタン =====
document.getElementById("btn-add").addEventListener("click", () => {
  state.items.push(emptyItem());
  renderItems();
  save();
  rowsEl.lastElementChild.querySelector("input").focus();
});

// 新しい請求書：宛名と明細を空にし、番号を進め、発行日を今日にする
const btnNew = document.getElementById("btn-new");
function startNewInvoice() {
  state.fields.client = "";
  state.fields.clientAddress = "";
  state.fields.issueDate = today();
  state.fields.number = nextNumber(state.history);
  state.items = [emptyItem()];
  renderFields();
  renderItems();
  renderCustomerButtons();
  save();
  document.getElementById("client").focus();
}
btnNew.addEventListener("click", () => {
  // 発行済みならすぐ新規、未発行なら消してよいか2回押しで確認
  if (isIssued()) startNewInvoice();
  else confirmByDoubleClick(btnNew, "未発行です。もう一度押すと消去", startNewInvoice);
});

// ファイル名「請求書_宛名様_日付」
function fileBaseName() {
  const client = state.fields.client.trim();
  const date = state.fields.issueDate.replace(/[\/.]/g, "-");
  return `請求書_${client ? client + "様_" : ""}${date}`.replace(/[\\:*?"<>|]/g, "");
}

// 印刷（PDF保存時のファイル名も設定する）
function printInvoice() {
  const original = document.title;
  document.title = fileBaseName();
  window.print();
  document.title = original;
}

document.getElementById("btn-print").addEventListener("click", () => {
  if (!readyToIssue()) return;
  printInvoice();
  recordIssue("印刷");
});

// ===== PDF作成（印刷画面を通さずに作る） =====
const canMakePdf = () => window.html2canvas && window.jspdf;

// 請求書部分を画像にしてA4のPDFにする
async function makePdf() {
  const sheet = document.querySelector(".sheet");
  document.body.classList.add("exporting");
  try {
    const canvas = await html2canvas(sheet, { scale: 2, backgroundColor: "#ffffff" });
    const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    const margin = 12;
    const pageW = 210 - margin * 2;
    const pageH = 297 - margin * 2;
    // 1ページに収まるように縮小
    let w = pageW;
    let h = (canvas.height * w) / canvas.width;
    if (h > pageH) {
      h = pageH;
      w = (canvas.width * h) / canvas.height;
    }
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", margin + (pageW - w) / 2, margin, w, h);
    return pdf;
  } finally {
    document.body.classList.remove("exporting");
  }
}

async function withBusy(button, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "作成中…";
  try {
    await task();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

const btnPdf = document.getElementById("btn-pdf");
btnPdf.addEventListener("click", () => {
  if (!readyToIssue()) return;
  // ライブラリが読めない（オフラインなど）ときは印刷画面で代用
  if (!canMakePdf()) {
    printInvoice();
    recordIssue("PDF");
    return;
  }
  withBusy(btnPdf, async () => {
    const pdf = await makePdf();
    pdf.save(`${fileBaseName()}.pdf`);
    recordIssue("PDF");
  });
});

// Windowsの共有画面からメールなどにPDFを添付して送る（対応ブラウザのみボタンを表示）
const btnShare = document.getElementById("btn-share");
const testFile = new File([""], "test.pdf", { type: "application/pdf" });
if (navigator.canShare && navigator.canShare({ files: [testFile] })) {
  btnShare.hidden = false;
}
btnShare.addEventListener("click", () => {
  if (!readyToIssue() || !canMakePdf()) return;
  withBusy(btnShare, async () => {
    const pdf = await makePdf();
    const name = `${fileBaseName()}.pdf`;
    const file = new File([pdf.output("blob")], name, { type: "application/pdf" });
    try {
      await navigator.share({ files: [file], title: name });
      recordIssue("送信");
    } catch (e) {
      // キャンセル以外で失敗したら保存に切り替える
      if (e.name !== "AbortError") {
        pdf.save(name);
        recordIssue("PDF");
      }
    }
  });
});

// ===== デモ：最初の状態に戻す =====
const btnReset = document.getElementById("btn-demo-reset");
btnReset.addEventListener("click", () => {
  confirmByDoubleClick(btnReset, "もう一度押すと戻します", () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // 保存領域が使えないときはそのまま再読み込み
    }
    location.reload();
  });
});

// ===== 起動 =====
renderFields();
renderProducts();
renderCustomers();
renderItems();
renderHistory();
renderClientList();
save();
// 前回送れなかった分があれば再送
sendPendingToSheet();
