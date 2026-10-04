<script setup>
import { ref, onMounted } from 'vue';
import { store } from '../lib/store.js';
import { getStatus } from '../lib/api.js';
import { isSpeechSupported } from '../lib/speech-recognizer.js';

const emit = defineEmits(['start']);

const companyId = ref(store.companies[0]?.id ?? '');
const audioMode = ref('headphones');
const sttAvailable = ref(true);

onMounted(async () => {
  sttAvailable.value = (await getStatus()).stt;
});

function start() {
  emit('start', { companyId: companyId.value, audioMode: audioMode.value });
}
</script>

<template>
  <section class="setup">
    <h2>本番モード</h2>
    <p class="muted">面接の文字起こし・いま聞かれている質問・関連エピソード・逆質問チェックを1画面にまとめて表示します。</p>

    <p v-if="!isSpeechSupported" class="notice notice-error">このブラウザは音声認識に対応していません。Google Chrome をお使いください。</p>

    <div class="card block">
      <label class="field">
        <span>面接を受ける企業</span>
        <select v-model="companyId" class="select">
          <option value="">企業を指定しない</option>
          <option v-for="c in store.companies" :key="c.id" :value="c.id">{{ c.name }}{{ c.stage ? `（${c.stage}）` : '' }}</option>
        </select>
      </label>
    </div>

    <fieldset class="card block modes">
      <legend>音声の取り込み方法</legend>
      <label class="mode" :class="{ on: audioMode === 'headphones' }">
        <input v-model="audioMode" type="radio" value="headphones" />
        <span class="mode-icon" aria-hidden="true">🎧</span>
        <span>
          <strong>ヘッドホン・イヤホン</strong>
          <span class="muted small">面接官の声はPCの再生音から、自分の声はマイクから取り込みます。話者を自動で区別します。</span>
        </span>
      </label>
      <label class="mode" :class="{ on: audioMode === 'speaker' }">
        <input v-model="audioMode" type="radio" value="speaker" />
        <span class="mode-icon" aria-hidden="true">🔊</span>
        <span>
          <strong>スピーカー</strong>
          <span class="muted small">マイクだけで両者の声を取り込みます。話者は区別しません。</span>
        </span>
      </label>
    </fieldset>

    <div v-if="audioMode === 'headphones'" class="card block guide">
      <h3>開始すると画面共有の画面が開きます</h3>
      <p v-if="!sttAvailable" class="notice">
        サーバーに音声認識のAPIキー（DEEPGRAM_API_KEY）が設定されていないため、面接官の声は文字起こしされません。自分の声のみ文字起こしされます。
      </p>
      <div class="steps">
        <div>
          <h4>ブラウザ版の面接（Google Meet・Zoom Web など）</h4>
          <ol>
            <li>「Chrome タブ」を選ぶ</li>
            <li>面接のタブを選ぶ</li>
            <li><strong>「タブの音声も共有する」をON</strong></li>
          </ol>
        </div>
        <div>
          <h4>アプリ版の面接（Zoom・Teams デスクトップ）</h4>
          <ol>
            <li>「画面全体」を選ぶ</li>
            <li><strong>「システム音声も共有する」をON</strong></li>
            <li>通知音が混ざらないよう、他のアプリの音は切っておく</li>
          </ol>
        </div>
      </div>
      <p class="muted small">共有した映像は使いません（録画もされません）。音声も保存せず、文字だけを記録します。</p>
    </div>

    <p class="muted small rule">
      ※ メモの参照や文字起こしが認められている面接でお使いください。企業から録音・文字起こしについて指定がある場合はそれに従ってください。
    </p>

    <button class="btn btn-primary start" :disabled="!isSpeechSupported" @click="start">面接を開始する</button>
  </section>
</template>

<style scoped>
.setup {
  max-width: 760px;
  margin: 0 auto;
  display: grid;
  gap: 16px;
}
.setup > p { margin: 0; }
.block { display: grid; gap: 12px; }
.modes { border: 1px solid var(--border); margin: 0; }
legend { font-weight: 700; padding: 0 4px; }
.mode {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.mode.on { border-color: var(--accent); background: var(--accent-weak); }
.mode input { width: 20px; height: 20px; flex-shrink: 0; }
.mode-icon { font-size: 1.6em; }
.mode > span:last-child { display: grid; }
.guide h3 { font-size: 1.05em; }
.steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}
.steps h4 { margin: 0 0 4px; font-size: 0.95em; }
.steps ol { margin: 0; padding-left: 1.4em; }
.guide p { margin: 0; }
.rule { margin: 0; }
.start { min-height: 60px; font-size: 1.15em; }
</style>
