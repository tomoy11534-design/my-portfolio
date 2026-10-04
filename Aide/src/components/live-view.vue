<script setup>
import { ref } from 'vue';
import LiveSetup from './live-setup.vue';
import LiveSession from './live-session.vue';

const emit = defineEmits(['running-change', 'finished']);

// 開始時の設定（企業・音声の取り込み方法）。null の間は設定画面を表示する
const config = ref(null);

function start(value) {
  config.value = value;
  emit('running-change', true);
}

function finish(recordId) {
  config.value = null;
  emit('running-change', false);
  if (recordId) emit('finished', recordId);
}
</script>

<template>
  <LiveSession v-if="config" :config="config" @finished="finish" />
  <LiveSetup v-else @start="start" />
</template>
