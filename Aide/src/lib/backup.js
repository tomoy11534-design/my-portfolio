// 登録データ全体の JSON エクスポート・インポート
import { store, DEFAULT_SETTINGS } from './store.js';

export const BACKUP_VERSION = 1;
const COLLECTIONS = ['companies', 'episodes', 'records'];

// ---- エクスポート ----
export function buildBackup() {
  return {
    app: 'aide',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      companies: store.companies,
      episodes: store.episodes,
      records: store.records,
      settings: store.settings,
    },
  };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function backupFileName(date = new Date()) {
  const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `aide-backup-${d}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

export function downloadText(fileName, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportBackup() {
  downloadText(backupFileName(), JSON.stringify(buildBackup(), null, 2), 'application/json');
}

// ---- インポート：読み込みと検証 ----
// 古い形式を現在の形式に変換する（バージョンが上がったらここに変換処理を足す）
const MIGRATIONS = {
  // 例）1: (backup) => ({ ...backup, version: 2, data: { ... } }),
};

function migrate(backup) {
  let current = backup;
  while (current.version < BACKUP_VERSION) {
    const step = MIGRATIONS[current.version];
    if (!step) throw new Error(`バージョン ${current.version} のデータは変換できません。`);
    current = step(current);
  }
  return current;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// 各データに必須の項目（ID・更新日時と、種類ごとの主要項目）
const REQUIRED = {
  companies: ['name'],
  episodes: ['title'],
  records: ['startedAt'],
};

/**
 * JSON 文字列を検証してバックアップデータを返す。不正な場合は Error を投げる（データは変更しない）
 */
export function parseBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('JSON として読み取れません。ファイルが壊れていないか確認してください。');
  }
  if (!isObject(backup) || backup.app !== 'aide') {
    throw new Error('Aide のエクスポートファイルではありません。');
  }
  if (!Number.isInteger(backup.version) || backup.version < 1) {
    throw new Error('データ形式のバージョンが読み取れません。');
  }
  if (backup.version > BACKUP_VERSION) {
    throw new Error(`新しいバージョン（${backup.version}）のファイルです。アプリを更新してから読み込んでください。`);
  }
  backup = migrate(backup);
  if (!isObject(backup.data)) throw new Error('data 項目がありません。');

  for (const key of COLLECTIONS) {
    const list = backup.data[key] ?? [];
    if (!Array.isArray(list)) throw new Error(`${key} が配列ではありません。`);
    list.forEach((item, i) => {
      if (!isObject(item)) throw new Error(`${key} の ${i + 1} 件目がオブジェクトではありません。`);
      for (const field of ['id', 'updatedAt', ...REQUIRED[key]]) {
        if (item[field] === undefined || item[field] === '') {
          throw new Error(`${key} の ${i + 1} 件目に必須項目「${field}」がありません。`);
        }
      }
    });
    backup.data[key] = list;
  }
  if (backup.data.settings !== undefined && !isObject(backup.data.settings)) {
    throw new Error('settings がオブジェクトではありません。');
  }
  return backup;
}

// プレビュー表示用の件数
export function summarizeBackup(backup) {
  return {
    exportedAt: backup.exportedAt,
    version: backup.version,
    companies: backup.data.companies.length,
    episodes: backup.data.episodes.length,
    records: backup.data.records.length,
  };
}

// ---- インポート：反映 ----
// 上書き：今のデータをすべて置き換える（呼び出し側で事前に自動エクスポートする）
export function applyOverwrite(backup) {
  for (const key of COLLECTIONS) store[key] = structuredClone(backup.data[key]);
  store.settings = { ...DEFAULT_SETTINGS, ...(backup.data.settings ?? {}) };
}

// 追加：同じ ID は更新日時が新しい方を残す。設定は今のものを維持する
export function applyMerge(backup) {
  const result = { added: 0, updated: 0, kept: 0 };
  for (const key of COLLECTIONS) {
    const map = new Map(store[key].map((item) => [item.id, item]));
    for (const incoming of backup.data[key]) {
      const existing = map.get(incoming.id);
      if (!existing) {
        map.set(incoming.id, structuredClone(incoming));
        result.added++;
      } else if (new Date(incoming.updatedAt) > new Date(existing.updatedAt)) {
        map.set(incoming.id, structuredClone(incoming));
        result.updated++;
      } else {
        result.kept++;
      }
    }
    store[key] = [...map.values()];
  }
  return result;
}
