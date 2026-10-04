<script setup>
import { ref, computed, onBeforeUnmount } from 'vue';
import { store, findCompany } from '../lib/store.js';
import { postApi } from '../lib/api.js';
import { createSpeechRecognizer, isSpeechSupported } from '../lib/speech-recognizer.js';

const companyId = ref(store.companies[0]?.id ?? '');
const company = computed(() => findCompany(companyId.value));

const question = ref('');
const isFollowUp = ref(false);
const answer = ref('');
const interim = ref('');
const feedback = ref(null);
const history = ref([]);
const loading = ref('');
const error = ref('');
const listening = ref(false);
const speakQuestion = ref(true);

const recognizer = createSpeechRecognizer({
  onInterim: (text) => (interim.value = text),
  onFinal: (text) => (answer.value += text),
  onError: (message, fatal) => {
    error.value = message;
    if (fatal) listening.value = false;
  },
});

// 企業情報のうち AI に渡す項目だけを取り出す
function companyPayload() {
  const c = company.value;
  return c ? { name: c.name, position: c.position, stage: c.stage, memo: c.memo } : {};
}

function speak(text) {
  if (!speakQuestion.value || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  speechSynthesis.speak(u);
}

async function nextQuestion() {
  stopListening();
  error.value = '';
  loading.value = 'question';
  try {
    const res = await postApi('/practice/question', {
      company: companyPayload(),
      history: history.value.map((h) => ({ question: h.question, answer: h.answer })),
    });
    question.value = res.question;
    isFollowUp.value = res.isFollowUp;
    answer.value = '';
    feedback.value = null;
    speak(res.question);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = '';
  }
}

async function submitAnswer() {
  stopListening();
  if (!answer.value.trim()) {
    error.value = '回答を入力するか、マイクで話してください。';
    return;
  }
  error.value = '';
  loading.value = 'feedback';
  try {
    const res = await postApi('/practice/feedback', {
      company: companyPayload(),
      question: question.value,
      answer: answer.value,
    });
    feedback.value = res;
    history.value.push({ question: question.value, answer: answer.value, feedback: res });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = '';
  }
}

function toggleListening() {
  if (listening.value) {
    stopListening();
  } else {
    error.value = '';
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    recognizer.start();
    listening.value = true;
  }
}

function stopListening() {
  if (!listening.value) return;
  recognizer.stop();
  listening.value = false;
}

function reset() {
  stopListening();
  history.value = [];
  question.value = '';
  answer.value = '';
  feedback.value = null;
}

onBeforeUnmount(() => {
  recognizer.stop();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
});

const axes = [
  { key: 'conclusion', label: '結論の明確さ' },
  { key: 'specificity', label: '具体性' },
  { key: 'relevance', label: '質問との一致' },
  { key: 'length', label: '長さ' },
];
</script>

<template>
  <section class="practice">
    <div class="card setup">
      <label class="field">
        <span>練習する企業</span>
        <select v-model="companyId" class="select" :disabled="history.length > 0">
          <option value="">企業を指定しない（一般的な面接）</option>
          <option v-for="c in store.companies" :key="c.id" :value="c.id">{{ c.name }}{{ c.stage ? `（${c.stage}）` : '' }}</option>
        </select>
      </label>
      <label class="check">
        <input v-model="speakQuestion" type="checkbox" />
        質問を音声で読み上げる
      </label>
      <button v-if="history.length" class="btn btn-small" @click="reset">最初からやり直す</button>
    </div>

    <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>

    <div v-if="!question" class="start">
      <p class="muted">AIが面接官役になって1問ずつ質問します。声で答えると文字起こしされ、回答ごとにフィードバックがもらえます。</p>
      <button class="btn btn-primary big" :disabled="loading === 'question'" @click="nextQuestion">
        {{ loading === 'question' ? '質問を考えています…' : '練習を始める' }}
      </button>
    </div>

    <template v-else>
      <div class="card question-card">
        <span class="label">{{ isFollowUp ? '深掘り質問' : `質問 ${history.length + (feedback ? 0 : 1)}` }}</span>
        <p class="question">{{ question }}</p>
      </div>

      <div class="card answer-card">
        <div class="answer-head">
          <h3>あなたの回答</h3>
          <button
            v-if="isSpeechSupported"
            class="btn"
            :class="{ 'btn-primary': listening }"
            :disabled="!!feedback"
            @click="toggleListening"
          >
            {{ listening ? '● 録音中（タップで停止）' : '🎤 声で答える' }}
          </button>
        </div>
        <textarea
          v-model="answer"
          class="textarea"
          rows="6"
          :disabled="!!feedback"
          placeholder="声で答えるか、ここに入力してください"
        />
        <p v-if="interim" class="interim">{{ interim }}</p>
        <div class="answer-foot">
          <span class="muted small">{{ answer.length }} 字（1分 ≒ 300字が目安）</span>
          <button
            v-if="!feedback"
            class="btn btn-primary"
            :disabled="loading === 'feedback' || !answer.trim()"
            @click="submitAnswer"
          >
            {{ loading === 'feedback' ? 'フィードバックを作成中…' : '回答してフィードバックを受ける' }}
          </button>
        </div>
      </div>

      <div v-if="feedback" class="card feedback">
        <h3>フィードバック</h3>
        <ul class="axes">
          <li v-for="a in axes" :key="a.key">
            <div class="axis-head">
              <span>{{ a.label }}</span>
              <strong>{{ feedback[a.key].score }} / 5</strong>
            </div>
            <div class="bar" role="img" :aria-label="`${a.label} ${feedback[a.key].score}点`">
              <span :style="{ width: `${feedback[a.key].score * 20}%` }" />
            </div>
            <p class="small muted">{{ feedback[a.key].comment }}</p>
          </li>
        </ul>
        <div class="points">
          <p><strong>良かった点：</strong>{{ feedback.good }}</p>
          <p><strong>改善点：</strong>{{ feedback.improve }}</p>
          <p class="tip"><strong>組み立てのヒント：</strong>{{ feedback.tip }}</p>
        </div>
        <button class="btn btn-primary" :disabled="loading === 'question'" @click="nextQuestion">
          {{ loading === 'question' ? '質問を考えています…' : '次の質問へ' }}
        </button>
      </div>
    </template>

    <details v-if="history.length" class="card history">
      <summary>これまでの質疑（{{ history.length }}問）</summary>
      <ol>
        <li v-for="(h, i) in history" :key="i">
          <p><strong>Q.</strong> {{ h.question }}</p>
          <p class="muted"><strong>A.</strong> {{ h.answer }}</p>
        </li>
      </ol>
    </details>
  </section>
</template>

<style scoped>
.practice { display: grid; gap: 16px; max-width: 820px; margin: 0 auto; }
.setup {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: end;
}
.setup .field { flex: 1; min-width: 240px; }
.check { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.check input { width: 20px; height: 20px; }
.start { text-align: center; padding: 32px 0; display: grid; gap: 16px; justify-items: center; }
.big { min-height: 56px; padding: 0 32px; font-size: 1.1em; }
.label { font-size: 0.85em; font-weight: 700; color: var(--accent); }
.question { font-size: calc(22px * var(--scale)); font-weight: 700; margin: 4px 0 0; line-height: 1.5; }
.answer-card { display: grid; gap: 10px; }
.answer-head, .answer-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.interim { margin: 0; color: var(--text-sub); font-style: italic; }
.feedback { display: grid; gap: 12px; }
.axes {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
}
.axis-head { display: flex; justify-content: space-between; }
.axes p { margin: 4px 0 0; }
.bar {
  height: 8px;
  border-radius: 4px;
  background: var(--surface-2);
  overflow: hidden;
}
.bar span { display: block; height: 100%; background: var(--accent); }
.points p { margin: 0 0 6px; }
.tip { white-space: pre-wrap; }
.history summary { cursor: pointer; font-weight: 600; min-height: 32px; }
.history li { margin-bottom: 8px; }
.history p { margin: 0; }
</style>
