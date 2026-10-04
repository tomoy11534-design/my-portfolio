<script setup>
import { ref, computed } from 'vue';
import { store, stamp } from '../lib/store.js';
import CompanyEditor from './company-editor.vue';
import EpisodeEditor from './episode-editor.vue';

const section = ref('companies');
const selectedCompanyId = ref(store.companies[0]?.id ?? null);
const selectedEpisodeId = ref(store.episodes[0]?.id ?? null);

const selectedCompany = computed(() => store.companies.find((c) => c.id === selectedCompanyId.value) ?? null);
const selectedEpisode = computed(() => store.episodes.find((e) => e.id === selectedEpisodeId.value) ?? null);

// 面接日時が近い順（未設定は後ろ）に並べる
const sortedCompanies = computed(() =>
  [...store.companies].sort((a, b) => {
    if (!a.interviewAt) return 1;
    if (!b.interviewAt) return -1;
    return a.interviewAt.localeCompare(b.interviewAt);
  }),
);

function addCompany() {
  const company = stamp({
    name: '新しい企業',
    position: '',
    stage: '',
    interviewAt: '',
    memo: '',
    questions: [],
    reverseQuestions: [],
  });
  store.companies.push(company);
  selectedCompanyId.value = company.id;
}

function removeCompany(id) {
  store.companies = store.companies.filter((c) => c.id !== id);
  selectedCompanyId.value = store.companies[0]?.id ?? null;
}

function addEpisode() {
  const episode = stamp({ title: '新しいエピソード', body: '', tags: [] });
  store.episodes.push(episode);
  selectedEpisodeId.value = episode.id;
}

function removeEpisode(id) {
  store.episodes = store.episodes.filter((e) => e.id !== id);
  selectedEpisodeId.value = store.episodes[0]?.id ?? null;
}

function formatDate(value) {
  if (!value) return '日時未定';
  const d = new Date(value);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <section>
    <div class="section-tabs" role="tablist">
      <button
        class="btn"
        :class="{ 'btn-primary': section === 'companies' }"
        role="tab"
        :aria-selected="section === 'companies'"
        @click="section = 'companies'"
      >
        応募企業（{{ store.companies.length }}）
      </button>
      <button
        class="btn"
        :class="{ 'btn-primary': section === 'episodes' }"
        role="tab"
        :aria-selected="section === 'episodes'"
        @click="section = 'episodes'"
      >
        エピソード（{{ store.episodes.length }}）
      </button>
    </div>

    <!-- 応募企業 -->
    <div v-if="section === 'companies'" class="split">
      <aside class="list">
        <button class="btn btn-primary add" @click="addCompany">＋ 企業を追加</button>
        <p v-if="store.companies.length === 0" class="empty small">まだ企業が登録されていません</p>
        <button
          v-for="c in sortedCompanies"
          :key="c.id"
          class="list-item"
          :class="{ active: c.id === selectedCompanyId }"
          @click="selectedCompanyId = c.id"
        >
          <strong>{{ c.name || '（名称未設定）' }}</strong>
          <span class="muted small">{{ c.stage || '段階未設定' }} ・ {{ formatDate(c.interviewAt) }}</span>
        </button>
      </aside>
      <CompanyEditor
        v-if="selectedCompany"
        :key="selectedCompany.id"
        :company="selectedCompany"
        @remove="removeCompany(selectedCompany.id)"
      />
      <p v-else class="empty">左の「企業を追加」から応募企業を登録してください。</p>
    </div>

    <!-- エピソード -->
    <div v-else class="split">
      <aside class="list">
        <button class="btn btn-primary add" @click="addEpisode">＋ エピソードを追加</button>
        <p v-if="store.episodes.length === 0" class="empty small">自己PR・ガクチカ・挫折経験など、話せるエピソードを登録しましょう</p>
        <button
          v-for="e in store.episodes"
          :key="e.id"
          class="list-item"
          :class="{ active: e.id === selectedEpisodeId }"
          @click="selectedEpisodeId = e.id"
        >
          <strong>{{ e.title || '（タイトル未設定）' }}</strong>
          <span v-if="e.tags.length" class="muted small">{{ e.tags.join('・') }}</span>
        </button>
      </aside>
      <EpisodeEditor
        v-if="selectedEpisode"
        :key="selectedEpisode.id"
        :episode="selectedEpisode"
        @remove="removeEpisode(selectedEpisode.id)"
      />
      <p v-else class="empty">左の「エピソードを追加」から登録してください。全企業で共通して使えます。</p>
    </div>
  </section>
</template>

<style scoped>
.section-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.split {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  align-items: start;
}

.list {
  display: grid;
  gap: 6px;
}

.add { width: 100%; margin-bottom: 4px; }

.list-item {
  display: grid;
  gap: 2px;
  text-align: left;
  padding: 10px 12px;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.list-item:hover { background: var(--surface-2); }
.list-item.active {
  border-color: var(--accent);
  box-shadow: inset 4px 0 0 var(--accent);
}

@media (max-width: 760px) {
  .split { grid-template-columns: 1fr; }
}
</style>
