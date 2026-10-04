<script setup>
import { ref } from 'vue';
import { store, newId, touch } from '../lib/store.js';

const props = defineProps({ company: { type: Object, required: true } });
const emit = defineEmits(['remove']);

const STAGES = ['カジュアル面談', '一次面接', '二次面接', '三次面接', '最終面接', 'その他'];

const newQuestion = ref('');
const newReverse = ref('');

// 項目を変更し、更新日時を記録する（インポート時の統合に使う）
function set(field, value) {
  props.company[field] = value;
  touch(props.company);
}

function addQuestion() {
  const text = newQuestion.value.trim();
  if (!text) return;
  props.company.questions.push({ id: newId(), text, episodeIds: [] });
  newQuestion.value = '';
  touch(props.company);
}

function toggleEpisode(question, episodeId) {
  const ids = question.episodeIds;
  const i = ids.indexOf(episodeId);
  if (i >= 0) ids.splice(i, 1);
  else ids.push(episodeId);
  touch(props.company);
}

function updateItem(item, value) {
  item.text = value;
  touch(props.company);
}

function removeItem(listName, id) {
  props.company[listName] = props.company[listName].filter((q) => q.id !== id);
  touch(props.company);
}

function moveItem(listName, index, delta) {
  const list = props.company[listName];
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  touch(props.company);
}

function addReverse() {
  const text = newReverse.value.trim();
  if (!text) return;
  props.company.reverseQuestions.push({ id: newId(), text });
  newReverse.value = '';
  touch(props.company);
}

function confirmRemove() {
  if (confirm(`「${props.company.name}」を削除しますか？（面接記録は残ります）`)) emit('remove');
}
</script>

<template>
  <div class="editor">
    <div class="card grid">
      <label class="field">
        <span>企業名</span>
        <input class="input" :value="company.name" @input="set('name', $event.target.value)" />
      </label>
      <div class="row">
        <label class="field">
          <span>職種</span>
          <input class="input" :value="company.position" placeholder="例：Webエンジニア" @input="set('position', $event.target.value)" />
        </label>
        <label class="field">
          <span>選考段階</span>
          <input class="input" list="stage-options" :value="company.stage" placeholder="例：一次面接" @input="set('stage', $event.target.value)" />
          <datalist id="stage-options">
            <option v-for="s in STAGES" :key="s" :value="s" />
          </datalist>
        </label>
        <label class="field">
          <span>面接日時</span>
          <input class="input" type="datetime-local" :value="company.interviewAt" @input="set('interviewAt', $event.target.value)" />
        </label>
      </div>
      <label class="field">
        <span>企業メモ（事業内容・求める人物像・面接官の情報など）</span>
        <textarea class="textarea" rows="4" :value="company.memo" @input="set('memo', $event.target.value)" />
      </label>
    </div>

    <!-- 逆質問 -->
    <div class="card">
      <h3>逆質問リスト</h3>
      <p class="muted small">本番モードでチェックリストとして表示されます。上にあるほど優先して聞きたい質問です。</p>
      <ol class="items">
        <li v-for="(q, i) in company.reverseQuestions" :key="q.id" class="item">
          <input class="input" :value="q.text" :aria-label="`逆質問 ${i + 1}`" @input="updateItem(q, $event.target.value)" />
          <button class="btn btn-small btn-ghost" :disabled="i === 0" aria-label="上へ" @click="moveItem('reverseQuestions', i, -1)">↑</button>
          <button class="btn btn-small btn-ghost" :disabled="i === company.reverseQuestions.length - 1" aria-label="下へ" @click="moveItem('reverseQuestions', i, 1)">↓</button>
          <button class="btn btn-small btn-ghost" aria-label="削除" @click="removeItem('reverseQuestions', q.id)">✕</button>
        </li>
      </ol>
      <form class="add-row" @submit.prevent="addReverse">
        <input v-model="newReverse" class="input" placeholder="例：入社後1年目に期待される役割を教えてください" />
        <button class="btn" type="submit">追加</button>
      </form>
    </div>

    <!-- 想定質問 -->
    <div class="card">
      <h3>想定質問と使うエピソード</h3>
      <p class="muted small">聞かれそうな質問と、答えに使うエピソードを紐づけておくと、練習・本番で参照しやすくなります。</p>
      <ul class="items">
        <li v-for="(q, i) in company.questions" :key="q.id" class="question">
          <div class="item">
            <input class="input" :value="q.text" :aria-label="`想定質問 ${i + 1}`" @input="updateItem(q, $event.target.value)" />
            <button class="btn btn-small btn-ghost" aria-label="削除" @click="removeItem('questions', q.id)">✕</button>
          </div>
          <div v-if="store.episodes.length" class="chips">
            <button
              v-for="e in store.episodes"
              :key="e.id"
              class="chip"
              :class="{ on: q.episodeIds.includes(e.id) }"
              :aria-pressed="q.episodeIds.includes(e.id)"
              @click="toggleEpisode(q, e.id)"
            >
              {{ q.episodeIds.includes(e.id) ? '✓ ' : '' }}{{ e.title }}
            </button>
          </div>
        </li>
      </ul>
      <form class="add-row" @submit.prevent="addQuestion">
        <input v-model="newQuestion" class="input" placeholder="例：当社を志望する理由を教えてください" />
        <button class="btn" type="submit">追加</button>
      </form>
    </div>

    <div class="danger-zone">
      <button class="btn btn-danger" @click="confirmRemove">この企業を削除</button>
    </div>
  </div>
</template>

<style scoped>
.editor { display: grid; gap: 16px; }
.grid { display: grid; gap: 12px; }
.row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
h3 { font-size: 1.05em; margin-bottom: 4px; }
.items {
  list-style: none;
  padding: 0;
  margin: 12px 0;
  display: grid;
  gap: 8px;
}
.item {
  display: flex;
  gap: 4px;
  align-items: center;
}
.question {
  display: grid;
  gap: 6px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-sub);
  font: inherit;
  font-size: 0.875em;
  cursor: pointer;
}
.chip.on {
  background: var(--accent-weak);
  border-color: var(--accent);
  color: var(--text);
}
.add-row { display: flex; gap: 8px; }
.danger-zone { text-align: right; }
</style>
