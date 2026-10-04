// アプリ全体のデータ（localStorage に自動保存する）
import { reactive, watch } from 'vue';

const PREFIX = 'aide:';
export const STORAGE_KEYS = ['companies', 'episodes', 'records', 'settings'];
export const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;

export const DEFAULT_SETTINGS = { theme: 'system', fontScale: 'normal' };

// localStorage が使えない環境（プライベートブラウズ等）でも落ちないように包む
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    store.saveError = '';
  } catch {
    store.saveError = 'ブラウザへの保存に失敗しました。容量不足の可能性があります。設定画面からエクスポートし、古い面接記録を削除してください。';
  }
}

export const store = reactive({
  companies: read('companies', []),
  episodes: read('episodes', []),
  records: read('records', []),
  settings: { ...DEFAULT_SETTINGS, ...read('settings', {}) },
  saveError: '',
});

for (const key of STORAGE_KEYS) {
  watch(() => store[key], (value) => write(key, value), { deep: true });
}

// 保存容量の使用量（UTF-16 のため1文字2バイトで概算）
export function storageUsage() {
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) bytes += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2;
    }
  } catch {
    return { bytes: 0, ratio: 0 };
  }
  return { bytes, ratio: bytes / STORAGE_LIMIT_BYTES };
}

// ---- 共通ユーティリティ ----
export function newId() {
  return crypto.randomUUID();
}

export function now() {
  return new Date().toISOString();
}

// 新しいデータに ID と作成・更新日時を付ける
export function stamp(data) {
  const time = now();
  return { id: newId(), createdAt: time, updatedAt: time, ...data };
}

export function touch(item) {
  item.updatedAt = now();
}

export function findCompany(id) {
  return store.companies.find((c) => c.id === id) ?? null;
}
