<script setup>
import { ref, watchEffect } from 'vue';
import { store } from './lib/store.js';
import PrepareView from './components/prepare-view.vue';
import PracticeView from './components/practice-view.vue';
import LiveView from './components/live-view.vue';
import ReviewView from './components/review-view.vue';
import SettingsView from './components/settings-view.vue';

const tabs = [
  { id: 'prepare', label: '準備' },
  { id: 'practice', label: '練習' },
  { id: 'live', label: '本番' },
  { id: 'review', label: '振り返り' },
  { id: 'settings', label: '設定' },
];

const current = ref('prepare');
// 本番の面接中はナビゲーションを隠して画面を広く使う
const liveRunning = ref(false);
// 振り返り画面で最初に開く面接記録
const openRecordId = ref(null);

function openReview(recordId) {
  openRecordId.value = recordId;
  current.value = 'review';
}

// テーマと文字サイズを <html> に反映する
watchEffect(() => {
  const root = document.documentElement;
  if (store.settings.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = store.settings.theme;
  root.dataset.fontScale = store.settings.fontScale;
});
</script>

<template>
  <div class="shell" :class="{ 'is-live': liveRunning }">
    <header v-if="!liveRunning" class="topbar">
      <div class="brand">
        <span class="logo" aria-hidden="true">A</span>
        <span>Aide</span>
      </div>
      <nav class="tabs" aria-label="メインメニュー">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab"
          :class="{ active: current === tab.id }"
          :aria-current="current === tab.id ? 'page' : undefined"
          @click="current = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>
    </header>

    <p v-if="store.saveError && !liveRunning" class="notice notice-error save-error">{{ store.saveError }}</p>

    <main class="main">
      <PrepareView v-if="current === 'prepare'" />
      <PracticeView v-else-if="current === 'practice'" />
      <LiveView
        v-else-if="current === 'live'"
        @running-change="liveRunning = $event"
        @finished="openReview"
      />
      <ReviewView v-else-if="current === 'review'" :initial-record-id="openRecordId" @opened="openRecordId = null" />
      <SettingsView v-else-if="current === 'settings'" />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 1.1em;
}

.logo {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font-weight: 700;
}

.tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
}

.tab {
  min-height: 44px;
  padding: 0 16px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-sub);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.tab:hover { background: var(--surface-2); }
.tab.active {
  background: var(--accent-weak);
  color: var(--text);
}

.save-error { margin: 12px 16px 0; }

.main {
  flex: 1;
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 16px 40px;
}

.is-live .main {
  max-width: none;
  padding: 0;
}
</style>
