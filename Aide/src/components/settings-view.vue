<script setup>
import { ref, computed, nextTick } from 'vue';
import { store, storageUsage, STORAGE_LIMIT_BYTES } from '../lib/store.js';
import {
  exportBackup,
  parseBackup,
  summarizeBackup,
  applyOverwrite,
  applyMerge,
} from '../lib/backup.js';
import { formatDateTime } from '../lib/markdown.js';

// ---- 表示設定 ----
const themes = [
  { value: 'system', label: 'OSに合わせる' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
];
const fontScales = [
  { value: 'normal', label: '標準' },
  { value: 'large', label: '大' },
  { value: 'xlarge', label: '特大' },
];

// ---- 保存容量 ----
const usageTick = ref(0);
// localStorage はリアクティブでないため、データを変えた後に usageTick を進めて再計算する
const usage = computed(() => {
  usageTick.value;
  return storageUsage();
});

// 保存（watch による書き込み）が終わってから再計算する
function refreshUsage() {
  nextTick(() => usageTick.value++);
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ---- インポート ----
const fileInput = ref(null);
const pending = ref(null);
const preview = ref(null);
const importMode = ref('merge');
const importError = ref('');
const importResult = ref('');
const confirmingOverwrite = ref(false);

async function onFileSelected(event) {
  importError.value = '';
  importResult.value = '';
  pending.value = null;
  preview.value = null;
  confirmingOverwrite.value = false;
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const backup = parseBackup(await file.text());
    pending.value = backup;
    preview.value = { fileName: file.name, ...summarizeBackup(backup) };
  } catch (e) {
    importError.value = e.message;
  }
}

function runImport() {
  if (!pending.value) return;
  if (importMode.value === 'overwrite') {
    if (!confirmingOverwrite.value) {
      confirmingOverwrite.value = true;
      return;
    }
    // 置き換える直前に、今のデータを自動でエクスポートしておく
    exportBackup();
    applyOverwrite(pending.value);
    importResult.value = '今のデータをバックアップとして保存したうえで、ファイルの内容に置き換えました。';
  } else {
    const r = applyMerge(pending.value);
    importResult.value = `追加 ${r.added} 件・更新 ${r.updated} 件・変更なし ${r.kept} 件で取り込みました。`;
  }
  cancelImport();
  refreshUsage();
}

function cancelImport() {
  pending.value = null;
  preview.value = null;
  confirmingOverwrite.value = false;
}

function deleteOldRecords() {
  const sorted = [...store.records].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const count = Math.ceil(sorted.length / 2);
  if (!count) return;
  if (!confirm(`古い面接記録 ${count} 件を削除します。先にエクスポートしておくことをおすすめします。削除しますか？`)) return;
  const removeIds = new Set(sorted.slice(0, count).map((r) => r.id));
  store.records = store.records.filter((r) => !removeIds.has(r.id));
  refreshUsage();
}
</script>

<template>
  <section class="settings">
    <div class="card block">
      <h2>表示</h2>
      <div class="option-row">
        <span class="option-label">テーマ</span>
        <div class="segmented" role="radiogroup" aria-label="テーマ">
          <button
            v-for="t in themes"
            :key="t.value"
            role="radio"
            :aria-checked="store.settings.theme === t.value"
            :class="{ on: store.settings.theme === t.value }"
            @click="store.settings.theme = t.value"
          >
            {{ t.label }}
          </button>
        </div>
      </div>
      <div class="option-row">
        <span class="option-label">文字サイズ</span>
        <div class="segmented" role="radiogroup" aria-label="文字サイズ">
          <button
            v-for="f in fontScales"
            :key="f.value"
            role="radio"
            :aria-checked="store.settings.fontScale === f.value"
            :class="{ on: store.settings.fontScale === f.value }"
            @click="store.settings.fontScale = f.value"
          >
            {{ f.label }}
          </button>
        </div>
      </div>
      <p class="muted small">文字サイズは本番モードの画面にも反映されます。</p>
    </div>

    <div class="card block">
      <h2>データのエクスポート・インポート</h2>
      <p class="muted small">
        企業・エピソード・面接記録・設定をまとめて JSON ファイルに保存できます。バックアップや別の端末への移行に使ってください。
        ファイルには面接の文字起こしなどが暗号化なしで入るため、保管場所に注意してください。
      </p>
      <div>
        <button class="btn btn-primary" @click="exportBackup">エクスポート（JSONを保存）</button>
      </div>

      <hr />

      <div>
        <input ref="fileInput" type="file" accept="application/json,.json" class="visually-hidden" @change="onFileSelected" />
        <button class="btn" @click="fileInput.click()">インポートするファイルを選ぶ</button>
      </div>
      <p v-if="importError" class="notice notice-error" role="alert">読み込めませんでした：{{ importError }}（データは変更していません）</p>
      <p v-if="importResult" class="notice" role="status">{{ importResult }}</p>

      <div v-if="preview" class="preview">
        <h3>{{ preview.fileName }}</h3>
        <ul>
          <li>エクスポート日時：{{ preview.exportedAt ? formatDateTime(preview.exportedAt) : '不明' }}</li>
          <li>企業 {{ preview.companies }} 件 ・ エピソード {{ preview.episodes }} 件 ・ 面接記録 {{ preview.records }} 件</li>
        </ul>
        <fieldset class="modes">
          <legend>取り込み方法</legend>
          <label class="mode">
            <input v-model="importMode" type="radio" value="merge" @change="confirmingOverwrite = false" />
            <span><strong>追加</strong>：今のデータに足します。同じデータは更新日時が新しい方を残します。設定は今のままです。</span>
          </label>
          <label class="mode">
            <input v-model="importMode" type="radio" value="overwrite" />
            <span><strong>上書き</strong>：今のデータをすべてファイルの内容に置き換えます。</span>
          </label>
        </fieldset>
        <p v-if="confirmingOverwrite" class="notice notice-error">
          今のデータはすべて置き換わります。実行直前に今のデータを自動でエクスポート（ダウンロード）します。よろしければもう一度押してください。
        </p>
        <div class="actions">
          <button class="btn" :class="confirmingOverwrite ? 'btn-danger' : 'btn-primary'" @click="runImport">
            {{ importMode === 'overwrite' ? (confirmingOverwrite ? '上書きを実行する' : '上書きで取り込む') : '追加で取り込む' }}
          </button>
          <button class="btn" @click="cancelImport">やめる</button>
        </div>
      </div>
    </div>

    <div class="card block">
      <h2>保存容量</h2>
      <div class="usage-bar" role="img" :aria-label="`使用量 ${Math.round(usage.ratio * 100)}%`">
        <span :class="{ high: usage.ratio > 0.8 }" :style="{ width: `${Math.min(100, usage.ratio * 100)}%` }" />
      </div>
      <p class="small">
        {{ formatBytes(usage.bytes) }} / 約{{ formatBytes(STORAGE_LIMIT_BYTES) }}（{{ Math.round(usage.ratio * 100) }}%）
      </p>
      <div v-if="usage.ratio > 0.8" class="notice">
        保存容量が残りわずかです。エクスポートしてから、古い面接記録を削除してください。
        <div class="actions">
          <button class="btn btn-small" @click="exportBackup">エクスポート</button>
          <button class="btn btn-small btn-danger" @click="deleteOldRecords">古い記録を半分削除</button>
        </div>
      </div>
      <p class="muted small">データはこのブラウザの中だけに保存されます。ブラウザのサイトデータを消去すると失われます。</p>
    </div>

    <div class="card block">
      <h2>本番モードのキーボード操作</h2>
      <ul class="keys">
        <li><kbd>Alt</kbd> + <kbd>P</kbd>：一時停止・再開</li>
        <li><kbd>Alt</kbd> + <kbd>M</kbd>：メモ欄へ移動</li>
        <li><kbd>Alt</kbd> + <kbd>1</kbd>〜<kbd>9</kbd>：逆質問のチェック切り替え</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.settings { display: grid; gap: 16px; max-width: 760px; margin: 0 auto; }
.block { display: grid; gap: 12px; }
.block h2 { font-size: 1.15em; }
.block p { margin: 0; }
.option-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.option-label { min-width: 6em; font-weight: 600; }
.segmented {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.segmented button {
  min-height: 44px;
  padding: 0 18px;
  border: none;
  border-right: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.segmented button:last-child { border-right: none; }
.segmented button.on { background: var(--accent); color: var(--accent-text); font-weight: 700; }
hr { border: none; border-top: 1px solid var(--border); margin: 4px 0; width: 100%; }
.preview {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
}
.preview h3 { font-size: 1em; word-break: break-all; }
.preview ul { margin: 0; padding-left: 1.2em; }
.modes { border: none; padding: 0; margin: 0; display: grid; gap: 8px; }
legend { font-weight: 600; margin-bottom: 4px; }
.mode { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
.mode input { width: 20px; height: 20px; margin-top: 3px; flex-shrink: 0; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.usage-bar { height: 10px; border-radius: 5px; background: var(--surface-2); overflow: hidden; }
.usage-bar span { display: block; height: 100%; background: var(--accent); }
.usage-bar span.high { background: var(--danger); }
.keys { margin: 0; padding-left: 1.2em; }
kbd {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 6px;
  font-family: inherit;
  font-size: 0.9em;
  background: var(--surface-2);
}
</style>
