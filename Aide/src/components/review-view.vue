<script setup>
import { ref, computed, onMounted } from 'vue';
import { store, findCompany, touch } from '../lib/store.js';
import { postApi } from '../lib/api.js';
import { downloadText } from '../lib/backup.js';
import { recordToMarkdown, recordFileName, formatDateTime, formatOffset } from '../lib/markdown.js';

const props = defineProps({ initialRecordId: { type: String, default: null } });
const emit = defineEmits(['opened']);

const filterCompanyId = ref('');
const selectedId = ref(null);
const loading = ref(false);
const error = ref('');
const copied = ref(false);

// 新しい順に並べ、企業で絞り込む
const records = computed(() =>
  [...store.records]
    .filter((r) => !filterCompanyId.value || r.companyId === filterCompanyId.value)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
);

// 記録のある企業（削除済みの企業も記録上の名前で表示する）
const companyOptions = computed(() => {
  const map = new Map();
  for (const r of store.records) if (r.companyId) map.set(r.companyId, findCompany(r.companyId)?.name ?? r.companyName);
  return [...map.entries()];
});

const record = computed(() => store.records.find((r) => r.id === selectedId.value) ?? null);

onMounted(() => {
  selectedId.value = props.initialRecordId ?? records.value[0]?.id ?? null;
  emit('opened');
});

async function summarize() {
  const r = record.value;
  if (!r) return;
  error.value = '';
  loading.value = true;
  try {
    const company = findCompany(r.companyId);
    r.summary = await postApi('/review/summary', {
      company: {
        name: r.companyName,
        position: r.position,
        stage: r.stage,
        memo: company?.memo ?? '',
      },
      utterances: r.utterances.map(({ speaker, text }) => ({ speaker, text })),
      memo: r.memo,
      checklist: r.checklist,
    });
    touch(r);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function updateMemo(value) {
  record.value.memo = value;
  touch(record.value);
}

function download() {
  downloadText(recordFileName(record.value), recordToMarkdown(record.value), 'text/markdown');
}

async function copy() {
  try {
    await navigator.clipboard.writeText(recordToMarkdown(record.value));
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    error.value = 'クリップボードにコピーできませんでした。';
  }
}

function remove() {
  if (!confirm('この面接記録を削除しますか？（元に戻せません）')) return;
  store.records = store.records.filter((r) => r.id !== selectedId.value);
  selectedId.value = records.value[0]?.id ?? null;
}

const SPEAKER = { interviewer: '面接官', self: '自分' };
</script>

<template>
  <section class="split">
    <aside class="list">
      <select v-model="filterCompanyId" class="select" aria-label="企業で絞り込む">
        <option value="">すべての企業</option>
        <option v-for="[id, name] in companyOptions" :key="id" :value="id">{{ name }}</option>
      </select>
      <p v-if="records.length === 0" class="empty small">本番モードで面接を終了すると、ここに記録が残ります</p>
      <button
        v-for="r in records"
        :key="r.id"
        class="list-item"
        :class="{ active: r.id === selectedId }"
        @click="selectedId = r.id"
      >
        <strong>{{ findCompany(r.companyId)?.name ?? r.companyName }}</strong>
        <span class="muted small">{{ formatDateTime(r.startedAt) }}{{ r.stage ? ` ・ ${r.stage}` : '' }}</span>
        <span class="small" :class="r.summary ? 'done' : 'muted'">{{ r.summary ? '✓ まとめ済み' : '未まとめ' }}</span>
      </button>
    </aside>

    <div v-if="record" class="detail">
      <header class="card head">
        <div>
          <h2>{{ findCompany(record.companyId)?.name ?? record.companyName }}{{ record.stage ? `（${record.stage}）` : '' }}</h2>
          <p class="muted small">
            {{ formatDateTime(record.startedAt) }} ・ {{ Math.round(record.durationMs / 60000) }}分 ・
            {{ record.audioMode === 'headphones' ? 'ヘッドホン・イヤホン' : 'スピーカー' }}
          </p>
        </div>
        <div class="actions">
          <button class="btn btn-primary" :disabled="loading" @click="summarize">
            {{ loading ? 'まとめています…' : record.summary ? 'AIでまとめ直す' : 'AIでまとめる' }}
          </button>
          <button class="btn" @click="download">Markdownで保存</button>
          <button class="btn" @click="copy">{{ copied ? 'コピーしました' : 'コピー' }}</button>
          <button class="btn btn-danger" @click="remove">削除</button>
        </div>
      </header>

      <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>

      <div v-if="record.summary" class="card summary">
        <h3>AIによるまとめ</h3>
        <p>{{ record.summary.overview }}</p>
        <template v-if="record.summary.qa.length">
          <h4>聞かれた質問と回答の要約</h4>
          <ol class="qa">
            <li v-for="(item, i) in record.summary.qa" :key="i">
              <strong>{{ item.question }}</strong>
              <p class="muted">{{ item.answerSummary }}</p>
            </li>
          </ol>
        </template>
        <div class="three">
          <div>
            <h4>良かった点</h4>
            <ul><li v-for="(t, i) in record.summary.good" :key="i">{{ t }}</li></ul>
          </div>
          <div>
            <h4>改善点</h4>
            <ul><li v-for="(t, i) in record.summary.improve" :key="i">{{ t }}</li></ul>
          </div>
          <div>
            <h4>次回までの宿題</h4>
            <ul><li v-for="(t, i) in record.summary.homework" :key="i">{{ t }}</li></ul>
          </div>
        </div>
      </div>

      <div class="two">
        <div class="card">
          <h3>逆質問</h3>
          <ul v-if="record.checklist.length" class="checks">
            <li v-for="c in record.checklist" :key="c.id" :class="{ off: !c.checked }">
              {{ c.checked ? '✓' : '—' }} {{ c.text }}
            </li>
          </ul>
          <p v-else class="muted small">なし</p>
        </div>
        <label class="card memo">
          <h3>メモ</h3>
          <textarea class="textarea" rows="6" :value="record.memo" @input="updateMemo($event.target.value)" />
        </label>
      </div>

      <details class="card" :open="!record.summary">
        <summary>文字起こし（{{ record.utterances.length }}件）</summary>
        <p v-if="!record.utterances.length" class="muted small">文字起こしはありません</p>
        <ul class="transcript">
          <li v-for="(u, i) in record.utterances" :key="i">
            <span class="time">{{ formatOffset(u.at) }}</span>
            <span v-if="SPEAKER[u.speaker]" class="who" :class="u.speaker">{{ SPEAKER[u.speaker] }}</span>
            <span>{{ u.text }}</span>
          </li>
        </ul>
      </details>
    </div>
    <p v-else class="empty">左の一覧から面接記録を選んでください。</p>
  </section>
</template>

<style scoped>
.split {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  align-items: start;
}
.list { display: grid; gap: 6px; }
.list-item {
  display: grid;
  gap: 2px;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.list-item:hover { background: var(--surface-2); }
.list-item.active { border-color: var(--accent); box-shadow: inset 4px 0 0 var(--accent); }
.done { color: var(--ok); font-weight: 600; }
.detail { display: grid; gap: 16px; min-width: 0; }
.head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.head h2 { font-size: 1.25em; }
.head p { margin: 4px 0 0; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
h3 { font-size: 1.05em; margin-bottom: 8px; }
h4 { font-size: 0.95em; margin: 12px 0 4px; }
.summary p { margin: 0 0 8px; }
.qa { padding-left: 1.4em; margin: 0; }
.qa p { margin: 2px 0 8px; }
.three {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.three ul { margin: 0; padding-left: 1.2em; }
.two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}
.checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
.checks .off { color: var(--text-sub); }
.memo { display: grid; gap: 4px; }
details summary { cursor: pointer; font-weight: 600; min-height: 32px; }
.transcript { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 4px; }
.transcript li { display: flex; gap: 8px; align-items: baseline; }
.time { font-variant-numeric: tabular-nums; color: var(--text-sub); font-size: 0.85em; flex-shrink: 0; }
.who { font-weight: 700; font-size: 0.85em; flex-shrink: 0; color: var(--text-sub); }
.who.interviewer { color: var(--accent); }

@media (max-width: 760px) {
  .split { grid-template-columns: 1fr; }
}
</style>
