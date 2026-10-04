<script setup>
import { touch } from '../lib/store.js';

const props = defineProps({ episode: { type: Object, required: true } });
const emit = defineEmits(['remove']);

function set(field, value) {
  props.episode[field] = value;
  touch(props.episode);
}

// タグは読点・カンマ・空白区切りで入力する
function setTags(value) {
  set(
    'tags',
    value
      .split(/[、,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

function confirmRemove() {
  if (confirm(`「${props.episode.title}」を削除しますか？`)) emit('remove');
}
</script>

<template>
  <div class="card editor">
    <label class="field">
      <span>タイトル（本番中に一目で思い出せる短い名前）</span>
      <input class="input" :value="episode.title" placeholder="例：学園祭の来場者数を1.5倍にした話" @input="set('title', $event.target.value)" />
    </label>
    <label class="field">
      <span>タグ（読点・スペース区切り）</span>
      <input
        class="input"
        :value="episode.tags.join('、')"
        placeholder="例：リーダーシップ、課題解決、チームワーク"
        @change="setTags($event.target.value)"
      />
    </label>
    <label class="field">
      <span>本文（状況・課題・行動・結果）</span>
      <textarea class="textarea" rows="10" :value="episode.body" @input="set('body', $event.target.value)" />
    </label>
    <div class="actions">
      <span class="muted small">{{ episode.body.length }} 字</span>
      <button class="btn btn-danger" @click="confirmRemove">このエピソードを削除</button>
    </div>
  </div>
</template>

<style scoped>
.editor { display: grid; gap: 12px; }
.actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
