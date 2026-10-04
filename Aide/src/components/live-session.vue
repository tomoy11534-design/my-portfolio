<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { store, findCompany, stamp, now } from '../lib/store.js';
import { postApi } from '../lib/api.js';
import { createSpeechRecognizer } from '../lib/speech-recognizer.js';
import {
  captureSystemAudio,
  captureMic,
  stopStream,
  createLevelMeter,
  createSystemTranscriber,
} from '../lib/audio-capture.js';

const props = defineProps({ config: { type: Object, required: true } });
const emit = defineEmits(['finished']);

// 1面接あたりの AI 解析の上限回数（料金の上限）
const MAX_ANALYZE_CALLS = 100;
// 同じ話者の発言をつなげる間隔（ミリ秒）
const MERGE_GAP_MS = 1500;
// 音声が来ないときに警告するまでの時間（ミリ秒）
const SILENCE_WARN_MS = { interviewer: 30000, mic: 45000 };

const company = findCompany(props.config.companyId);
const reverseQuestions = company ? company.reverseQuestions.map((q) => ({ ...q })) : [];

// ---- 状態 ----
const audioMode = ref(props.config.audioMode);
const startedAt = Date.now();
const startedAtIso = now();
const elapsed = ref(0);
const paused = ref(false);
const starting = ref(true);
const errorMessage = ref('');

const utterances = ref([]);
const interim = reactive({ interviewer: '', mic: '' });
const memo = ref('');
const checked = reactive(new Set());
const suggestedAnswered = reactive(new Set());

const currentQuestion = ref('');
const askedQuestions = [];
const episodeIds = ref([]);
const flash = ref(false);
const analyzing = ref(false);
const analyzeCount = ref(0);

const levels = reactive({ interviewer: 0, mic: 0 });
const silentFor = reactive({ interviewer: 0, mic: 0 });
const sharingEnded = ref(false);

const showTranscript = ref(window.innerWidth > 640);
const confirmingEnd = ref(false);
const showModeSwitch = ref(false);
const memoEl = ref(null);
const transcriptEl = ref(null);

// ---- 音声ソース ----
let micStream = null;
let systemStream = null;
let micMeter = null;
let systemMeter = null;
let systemTranscriber = null;
let recognizer = null;
let meterTimer = null;
let clockTimer = null;

const isHeadphones = computed(() => audioMode.value === 'headphones');

// 発言を追加する。直前と同じ話者で間が短ければ1つの発言につなげる
function addFinal(speaker, text) {
  const at = Date.now() - startedAt;
  const last = utterances.value[utterances.value.length - 1];
  if (last && last.speaker === speaker && at - last.lastAt < MERGE_GAP_MS && last.text.length < 300) {
    last.text += text;
    last.lastAt = at;
  } else {
    utterances.value.push({ speaker, text, at, lastAt: at });
  }
  // 質問の判定は面接官（話者不明を含む）の発言をきっかけにする
  if (speaker !== 'self') scheduleAnalyze();
  scrollTranscript();
}

async function startSources(mode) {
  errorMessage.value = '';
  sharingEnded.value = false;
  try {
    // 画面共有はボタン操作の直後でないと開けないため、最初に要求する
    if (mode === 'headphones') {
      systemStream = await captureSystemAudio();
      systemStream.getAudioTracks()[0].addEventListener('ended', onSharingEnded);
      systemMeter = createLevelMeter(systemStream);
      systemTranscriber = await createSystemTranscriber(systemStream, {
        onInterim: (text) => (interim.interviewer = text),
        onFinal: (text) => addFinal('interviewer', text),
        onError: (message) => (errorMessage.value = message),
      });
    }
    micStream = await captureMic();
    micMeter = createLevelMeter(micStream);
    const micSpeaker = mode === 'headphones' ? 'self' : 'unknown';
    recognizer = createSpeechRecognizer({
      onInterim: (text) => (interim.mic = text),
      onFinal: (text) => addFinal(micSpeaker, text),
      onError: (message) => (errorMessage.value = message),
    });
    if (!paused.value) recognizer.start();
    else systemTranscriber?.pause();
    audioMode.value = mode;
  } catch (error) {
    stopSources();
    errorMessage.value = error.message;
    return false;
  }
  return true;
}

function stopSources() {
  recognizer?.stop();
  systemTranscriber?.stop();
  micMeter?.stop();
  systemMeter?.stop();
  stopStream(micStream);
  stopStream(systemStream);
  recognizer = systemTranscriber = micMeter = systemMeter = micStream = systemStream = null;
  interim.interviewer = interim.mic = '';
  levels.interviewer = levels.mic = 0;
}

function onSharingEnded() {
  sharingEnded.value = true;
  errorMessage.value = '画面共有が停止されたため、面接官の声を取り込めません。「取り込み切替」から選び直してください。';
}

async function switchMode(mode) {
  showModeSwitch.value = false;
  stopSources();
  await startSources(mode);
}

// ---- 一時停止・再開 ----
function togglePause() {
  paused.value = !paused.value;
  if (paused.value) {
    recognizer?.stop();
    systemTranscriber?.pause();
  } else {
    recognizer?.start();
    systemTranscriber?.resume();
  }
}

// ---- AI による質問の要約・関連エピソード・回答済み逆質問の判定 ----
let analyzeTimer = null;
let analyzeAgain = false;

function scheduleAnalyze() {
  clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(runAnalyze, 1200);
}

async function runAnalyze() {
  if (analyzeCount.value >= MAX_ANALYZE_CALLS) return;
  if (analyzing.value) {
    analyzeAgain = true;
    return;
  }
  analyzing.value = true;
  analyzeCount.value++;
  try {
    const res = await postApi('/live/analyze', {
      utterances: utterances.value.slice(-12).map(({ speaker, text }) => ({ speaker, text })),
      episodes: store.episodes.map((e) => ({ id: e.id, title: e.title, tags: e.tags })),
      reverseQuestions: reverseQuestions.map(({ id, text }) => ({ id, text })),
    });
    const question = res.question.trim();
    if (question && question !== currentQuestion.value) {
      currentQuestion.value = question;
      askedQuestions.push({ at: Date.now() - startedAt, text: question });
      triggerFlash();
    }
    if (question) {
      const known = new Set(store.episodes.map((e) => e.id));
      episodeIds.value = res.episodeIds.filter((id) => known.has(id)).slice(0, 3);
    }
    for (const id of res.answeredReverseIds) suggestedAnswered.add(id);
  } catch (error) {
    errorMessage.value = `AI：${error.message}`;
  } finally {
    analyzing.value = false;
    if (analyzeAgain) {
      analyzeAgain = false;
      scheduleAnalyze();
    }
  }
}

function triggerFlash() {
  flash.value = false;
  nextTick(() => {
    flash.value = true;
    setTimeout(() => (flash.value = false), 700);
  });
}

const relatedEpisodes = computed(() =>
  episodeIds.value.map((id) => store.episodes.find((e) => e.id === id)).filter(Boolean),
);

// ---- 逆質問 ----
function toggleChecked(id) {
  if (checked.has(id)) checked.delete(id);
  else checked.add(id);
}

const checkedCount = computed(() => reverseQuestions.filter((q) => checked.has(q.id)).length);

// ---- 文字起こし表示 ----
const recentUtterances = computed(() => utterances.value.slice(showTranscript.value ? -30 : -3));

function speakerLabel(speaker) {
  return { interviewer: '面接官', self: '自分' }[speaker] ?? '';
}

function scrollTranscript() {
  nextTick(() => {
    const el = transcriptEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}
watch(showTranscript, scrollTranscript);

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---- 状態表示 ----
const warning = computed(() => {
  if (paused.value) return '';
  if (isHeadphones.value && systemStream && silentFor.interviewer > SILENCE_WARN_MS.interviewer) {
    return '面接官の声が届いていません。共有した音声を確認してください';
  }
  if (micStream && silentFor.mic > SILENCE_WARN_MS.mic) return 'マイクの音声が届いていません';
  return '';
});

function updateMeters() {
  const step = 150;
  const sources = [
    ['interviewer', systemMeter],
    ['mic', micMeter],
  ];
  for (const [key, meter] of sources) {
    const level = meter ? meter.level() : 0;
    levels[key] = level;
    silentFor[key] = level > 0.03 ? 0 : silentFor[key] + step;
  }
}

// ---- 終了 ----
let endTimer = null;
function requestEnd() {
  confirmingEnd.value = true;
  clearTimeout(endTimer);
  // 押し間違い防止：5秒以内に「終了する」を押さなければ元に戻す
  endTimer = setTimeout(() => (confirmingEnd.value = false), 5000);
}

function finish() {
  clearTimeout(endTimer);
  stopSources();
  const record = stamp({
    companyId: company?.id ?? '',
    companyName: company?.name ?? '企業未指定',
    position: company?.position ?? '',
    stage: company?.stage ?? '',
    startedAt: startedAtIso,
    endedAt: now(),
    durationMs: Date.now() - startedAt,
    audioMode: audioMode.value,
    utterances: utterances.value.map(({ speaker, text, at }) => ({ speaker, text, at })),
    questions: askedQuestions,
    memo: memo.value,
    checklist: reverseQuestions.map((q) => ({ id: q.id, text: q.text, checked: checked.has(q.id) })),
    summary: null,
  });
  store.records.push(record);
  emit('finished', record.id);
}

// ---- キーボードショートカット（メモ入力と衝突しないよう Alt 付き） ----
function onKeydown(event) {
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === 'p') {
    event.preventDefault();
    togglePause();
  } else if (key === 'm') {
    event.preventDefault();
    memoEl.value?.focus();
  } else if (/^[1-9]$/.test(event.key)) {
    const q = reverseQuestions[Number(event.key) - 1];
    if (q) {
      event.preventDefault();
      toggleChecked(q.id);
    }
  }
}

// 面接中にタブを閉じて記録を失わないようにする
function onBeforeUnload(event) {
  event.preventDefault();
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('beforeunload', onBeforeUnload);
  clockTimer = setInterval(() => (elapsed.value = Date.now() - startedAt), 1000);
  meterTimer = setInterval(updateMeters, 150);
  await startSources(audioMode.value);
  starting.value = false;
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('beforeunload', onBeforeUnload);
  clearInterval(clockTimer);
  clearInterval(meterTimer);
  clearTimeout(analyzeTimer);
  clearTimeout(endTimer);
  stopSources();
});
</script>

<template>
  <div class="live">
    <!-- 状態表示（1行） -->
    <header class="status" role="status">
      <span v-if="starting" class="state">… 準備中</span>
      <span v-else-if="paused" class="state paused">❚❚ 一時停止中</span>
      <span v-else class="state rec"><span class="dot" aria-hidden="true" />録音中</span>
      <span class="time" aria-label="経過時間">{{ formatTime(elapsed) }}</span>

      <span class="meters">
        <span v-if="isHeadphones" class="meter" :title="`面接官の声 ${Math.round(levels.interviewer * 100)}%`">
          <span class="meter-label">面接官</span>
          <span class="meter-bar"><span :style="{ transform: `scaleX(${levels.interviewer})` }" /></span>
        </span>
        <span class="meter" :title="`マイク ${Math.round(levels.mic * 100)}%`">
          <span class="meter-label">{{ isHeadphones ? '自分' : 'マイク' }}</span>
          <span class="meter-bar"><span :style="{ transform: `scaleX(${levels.mic})` }" /></span>
        </span>
      </span>

      <span v-if="errorMessage" class="alert">
        ⚠ {{ errorMessage }}
        <button class="link" @click="errorMessage = ''">閉じる</button>
      </span>
      <span v-else-if="warning" class="alert">⚠ {{ warning }}</span>
      <span v-else-if="analyzeCount >= MAX_ANALYZE_CALLS" class="alert">AI解析は上限（{{ MAX_ANALYZE_CALLS }}回）に達しました</span>

      <span class="controls">
        <button class="btn ctrl" :disabled="starting" @click="togglePause">
          {{ paused ? '▶ 再開' : '❚❚ 一時停止' }}
        </button>
        <span class="switch">
          <button class="btn ctrl" :aria-expanded="showModeSwitch" @click="showModeSwitch = !showModeSwitch">
            {{ isHeadphones ? '🎧' : '🔊' }} 取り込み切替
          </button>
          <span v-if="showModeSwitch" class="switch-menu">
            <button class="btn ctrl" @click="switchMode('headphones')">🎧 ヘッドホン・イヤホン{{ sharingEnded ? '（共有し直す）' : '' }}</button>
            <button class="btn ctrl" @click="switchMode('speaker')">🔊 スピーカー</button>
          </span>
        </span>
        <span class="end">
          <template v-if="confirmingEnd">
            <button class="btn ctrl btn-danger" @click="finish">終了する</button>
            <button class="btn ctrl" @click="confirmingEnd = false">戻る</button>
          </template>
          <button v-else class="btn ctrl" @click="requestEnd">■ 終了</button>
        </span>
      </span>
    </header>

    <!-- ① いま聞かれている質問 -->
    <section class="question" :class="{ flash }" aria-live="polite">
      <h2 class="area-label">
        いま聞かれている質問
        <span v-if="analyzing" class="thinking">更新中</span>
      </h2>
      <p v-if="currentQuestion" class="question-text">{{ currentQuestion }}</p>
      <p v-else class="question-text placeholder">質問を待っています</p>
    </section>

    <!-- ② 関連エピソード -->
    <section class="episodes">
      <h2 class="area-label">使えそうなエピソード</h2>
      <ul v-if="relatedEpisodes.length" class="episode-list">
        <li v-for="e in relatedEpisodes" :key="e.id" class="episode">
          <span class="episode-title">{{ e.title }}</span>
          <span v-if="e.tags.length" class="episode-tags">{{ e.tags.slice(0, 3).join('・') }}</span>
        </li>
      </ul>
      <p v-else class="muted none">{{ store.episodes.length ? '質問に合うエピソードがここに出ます' : 'エピソードが未登録です' }}</p>
    </section>

    <!-- ③ 逆質問チェックリスト・メモ -->
    <div class="bottom">
      <section class="checklist">
        <h2 class="area-label">逆質問 {{ checkedCount }}/{{ reverseQuestions.length }}</h2>
        <ul v-if="reverseQuestions.length">
          <li v-for="(q, i) in reverseQuestions" :key="q.id">
            <label class="check" :class="{ done: checked.has(q.id) }">
              <input type="checkbox" :checked="checked.has(q.id)" @change="toggleChecked(q.id)" />
              <span class="check-text">
                {{ q.text }}
                <span v-if="suggestedAnswered.has(q.id) && !checked.has(q.id)" class="maybe">回答済みかも</span>
              </span>
              <kbd v-if="i < 9" class="kbd" :title="`Alt+${i + 1} で切り替え`">{{ i + 1 }}</kbd>
            </label>
          </li>
        </ul>
        <p v-else class="muted none">{{ company ? '逆質問が未登録です' : '企業を指定すると逆質問が表示されます' }}</p>
      </section>

      <section class="memo">
        <h2 class="area-label"><label for="live-memo">メモ</label></h2>
        <textarea
          id="live-memo"
          ref="memoEl"
          v-model="memo"
          class="memo-input"
          placeholder="面接官の名前、気になった点など（Alt+M）"
        />
      </section>
    </div>

    <!-- ④ 文字起こし -->
    <section class="transcript" :class="{ open: showTranscript }">
      <div class="transcript-head">
        <h2 class="area-label">文字起こし</h2>
        <button class="link" :aria-expanded="showTranscript" @click="showTranscript = !showTranscript">
          {{ showTranscript ? '小さくする' : '広げる' }}
        </button>
      </div>
      <div ref="transcriptEl" class="transcript-body">
        <p v-for="(u, i) in recentUtterances" :key="i" class="line" :class="u.speaker">
          <span v-if="speakerLabel(u.speaker)" class="who">{{ speakerLabel(u.speaker) }}</span>{{ u.text }}
        </p>
        <p v-if="interim.interviewer" class="line interviewer interim"><span class="who">面接官</span>{{ interim.interviewer }}</p>
        <p v-if="interim.mic" class="line interim" :class="isHeadphones ? 'self' : ''">
          <span v-if="isHeadphones" class="who">自分</span>{{ interim.mic }}
        </p>
        <p v-if="!utterances.length && !interim.interviewer && !interim.mic" class="muted">話し始めるとここに表示されます</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 本番画面：スクロールなしで1画面に収める */
.live {
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px 12px;
  overflow: hidden;
}

.area-label {
  font-size: calc(13px * var(--scale));
  font-weight: 700;
  color: var(--text-sub);
  margin: 0 0 4px;
  letter-spacing: 0.04em;
}

/* ---- 状態表示 ---- */
.status {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: calc(15px * var(--scale));
}
.state { font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
.rec { color: var(--danger); }
.paused { color: var(--warn); }
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--danger);
}
.time { font-variant-numeric: tabular-nums; color: var(--text-sub); }
.meters { display: inline-flex; gap: 10px; }
.meter { display: inline-flex; align-items: center; gap: 4px; font-size: 0.85em; color: var(--text-sub); }
.meter-bar {
  width: 56px;
  height: 8px;
  border-radius: 4px;
  background: var(--surface-2);
  overflow: hidden;
}
.meter-bar span {
  display: block;
  height: 100%;
  background: var(--ok);
  transform-origin: left;
  transition: transform 0.12s linear;
}
.alert {
  color: var(--warn);
  font-weight: 600;
  flex: 1 1 200px;
  min-width: 0;
}
.controls { display: inline-flex; gap: 8px; margin-left: auto; align-items: center; flex-wrap: wrap; }
.ctrl { min-height: 48px; }
.switch { position: relative; }
.switch-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  display: grid;
  gap: 6px;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  z-index: 5;
  white-space: nowrap;
}
/* 終了ボタンは他の操作から離して誤操作を防ぐ */
.end { margin-left: 16px; display: inline-flex; gap: 8px; }
.link {
  border: none;
  background: none;
  color: var(--accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  padding: 4px;
  text-decoration: underline;
}

/* ---- ① 質問：最も大きく ---- */
.question {
  background: var(--surface);
  border: 2px solid var(--accent);
  border-radius: 14px;
  padding: 12px 18px;
  /* AI の更新でレイアウトがずれないよう、2行分の高さを確保しておく */
  min-height: calc(28px * var(--scale) * 1.4 * 2 + 50px);
}
.question.flash { animation: flash 0.7s ease-out; }
@keyframes flash {
  from { background: var(--highlight); }
  to { background: var(--surface); }
}
.question-text {
  margin: 0;
  font-size: calc(28px * var(--scale));
  font-weight: 700;
  line-height: 1.4;
  color: var(--text);
}
.placeholder { color: var(--text-sub); font-weight: 600; }
.thinking { font-weight: 600; color: var(--accent); margin-left: 8px; }

/* ---- ② エピソード ---- */
/* エピソード1行分（見出し＋タイトル＋タグ）の高さを確保し、表示の有無でずれないようにする */
.episodes { min-height: calc(20px + 66px * var(--scale)); }
.episode-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.episode {
  display: grid;
  padding: 8px 14px;
  border-radius: var(--radius);
  background: var(--accent-weak);
  border-left: 4px solid var(--accent);
}
.episode-title { font-size: calc(20px * var(--scale)); font-weight: 700; line-height: 1.4; }
.episode-tags { font-size: calc(13px * var(--scale)); color: var(--text-sub); }
.none { margin: 0; font-size: calc(16px * var(--scale)); }

/* ---- ③ 逆質問・メモ ---- */
.bottom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-height: 0;
}
.checklist, .memo {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
}
.checklist ul {
  list-style: none;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  display: grid;
  gap: 8px;
  align-content: start;
}
.check {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-height: 48px;
  padding: 6px 4px;
  font-size: calc(18px * var(--scale));
  line-height: 1.45;
  cursor: pointer;
  border-radius: 8px;
}
.check:hover { background: var(--surface-2); }
.check input { width: 26px; height: 26px; margin: 2px 0 0; flex-shrink: 0; accent-color: var(--accent); }
.check-text { flex: 1; }
.check.done .check-text { color: var(--text-sub); text-decoration: line-through; }
.maybe {
  display: inline-block;
  margin-left: 6px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--warn);
  color: var(--warn);
  font-size: 0.7em;
  font-weight: 700;
  text-decoration: none;
  vertical-align: middle;
}
.kbd {
  font-size: 0.65em;
  color: var(--text-sub);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 5px;
  font-family: inherit;
}
.memo-input {
  flex: 1;
  min-height: 0;
  width: 100%;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: calc(18px * var(--scale));
  line-height: 1.5;
  padding: 8px 10px;
}

/* ---- ④ 文字起こし：補助情報なので小さめ ---- */
.transcript {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px 12px 8px;
}
.transcript-head { display: flex; justify-content: space-between; align-items: center; }
.transcript-head .area-label { margin: 0; }
.transcript-body {
  max-height: calc(16px * var(--scale) * 1.5 * 3 + 4px);
  overflow-y: auto;
  font-size: calc(16px * var(--scale));
  line-height: 1.5;
}
.transcript.open .transcript-body { max-height: 28vh; }
.line { margin: 0; }
.who {
  display: inline-block;
  min-width: 3.5em;
  margin-right: 6px;
  font-size: 0.8em;
  font-weight: 700;
  color: var(--text-sub);
}
.line.interviewer .who { color: var(--accent); }
.interim { color: var(--text-sub); }

/* 画面幅が狭いとき（Zoom の横に細く置いた場合） */
@media (max-width: 640px) {
  .bottom { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
  .end { margin-left: 0; }
  .meter-bar { width: 36px; }
}

@media (prefers-reduced-motion: reduce) {
  .question.flash { animation: none; outline: 3px solid var(--warn); }
  .meter-bar span { transition: none; }
}
</style>
