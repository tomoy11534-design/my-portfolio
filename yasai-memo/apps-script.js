// ===== お米・野菜メモ → Googleスプレッドシート =====
// 販売メモのアプリから送られてきた記録を、このスプレッドシートに書き込みます。
// 記録を読み出す機能は入れていないので、アドレスを知られてもシートの中身は見られません。

const SHEET_NAME = '販売記録';
// 注文の項目（受付方法〜商品）は、前の表と並びが変わらないよう右の端に足している
const HEADERS = ['日時', '名前', '種類', '内容', '金額', '渡した', 'お金', '最後に変えた日時', 'ID', '受付方法', '受け渡し日', '状況', '商品'];
const ID_COLUMN = 9;

// つながるかどうかの確認用（記録は返さない）
function doGet() {
  return reply({ ok: true, app: 'yasai-memo' });
}

// アプリから記録が届いたときに動く
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    const ops = Array.isArray(body.ops) ? body.ops : [];
    const sheet = getSheet();
    ops.forEach(function (op) {
      if (op.type === 'delete') deleteRecord(sheet, op.id);
      if (op.type === 'upsert' && op.record) upsertRecord(sheet, op.record);
    });
    return reply({ ok: true, count: ops.length });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 「販売記録」のシートを取り出す（なければ作る）
function getSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME, 0);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
    sheet.getRange('H:H').setNumberFormat('yyyy/mm/dd hh:mm');
    sheet.getRange('E:E').setNumberFormat('#,##0"円"');
  }
  // 前の版で作った表には、足した項目の見出しを書き足す
  if (sheet.getLastColumn() < HEADERS.length) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  }
  return sheet;
}

// ID が同じ行をさがす（見つからなければ 0）
function findRow(sheet, id) {
  if (!id) return 0;
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const cell = sheet.getRange(2, ID_COLUMN, last - 1, 1)
    .createTextFinder(String(id))
    .matchEntireCell(true)
    .findNext();
  return cell ? cell.getRow() : 0;
}

// 「=」などで始まる文字が計算式にならないようにする
function safeText(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function toDate(value) {
  const date = new Date(value);
  return isNaN(date.getTime()) ? '' : date;
}

// 同じ記録があれば書きかえ、なければ下に足す
function upsertRecord(sheet, r) {
  const row = [
    toDate(r.createdAt),
    safeText(r.name),
    safeText((r.kinds || []).join('・')),
    safeText(r.text),
    typeof r.price === 'number' ? r.price : '',
    r.done ? '済' : 'まだ',
    r.paid ? '済' : 'まだ',
    new Date(),
    String(r.id),
    safeText(r.channel),
    safeText(r.deliveryDate),
    safeText(r.status),
    safeText((r.items || []).map(function (i) { return i.name + ' ' + i.qty + (i.unit || '個'); }).join('、')),
  ];
  const at = findRow(sheet, r.id);
  if (at) sheet.getRange(at, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);
}

function deleteRecord(sheet, id) {
  const at = findRow(sheet, id);
  if (at) sheet.deleteRow(at);
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
