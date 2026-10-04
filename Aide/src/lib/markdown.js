// 面接記録を Markdown に変換する

function formatDateTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatOffset(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const SPEAKER = { interviewer: '面接官', self: '自分' };

export function recordToMarkdown(record) {
  const lines = [];
  lines.push(`# 面接記録：${record.companyName}${record.stage ? `（${record.stage}）` : ''}`);
  lines.push('');
  lines.push(`- 日時：${formatDateTime(record.startedAt)}（${Math.round(record.durationMs / 60000)}分）`);
  if (record.position) lines.push(`- 職種：${record.position}`);
  lines.push(`- 音声の取り込み：${record.audioMode === 'headphones' ? 'ヘッドホン・イヤホン' : 'スピーカー'}`);
  lines.push('');

  const s = record.summary;
  if (s) {
    lines.push('## AIによるまとめ', '', s.overview, '');
    if (s.qa.length) {
      lines.push('### 聞かれた質問と回答の要約', '');
      s.qa.forEach((item, i) => {
        lines.push(`${i + 1}. **${item.question}**`, `   - ${item.answerSummary}`);
      });
      lines.push('');
    }
    const lists = [
      ['良かった点', s.good],
      ['改善点', s.improve],
      ['次回までの宿題', s.homework],
    ];
    for (const [title, items] of lists) {
      if (!items.length) continue;
      lines.push(`### ${title}`, '', ...items.map((t) => `- ${t}`), '');
    }
  }

  if (record.checklist.length) {
    lines.push('## 逆質問', '', ...record.checklist.map((c) => `- [${c.checked ? 'x' : ' '}] ${c.text}`), '');
  }

  if (record.memo.trim()) {
    lines.push('## メモ', '', record.memo.trim(), '');
  }

  if (record.utterances.length) {
    lines.push('## 文字起こし', '');
    for (const u of record.utterances) {
      const who = SPEAKER[u.speaker] ? `**${SPEAKER[u.speaker]}**：` : '';
      lines.push(`- \`${formatOffset(u.at)}\` ${who}${u.text}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function recordFileName(record) {
  const d = new Date(record.startedAt);
  const pad = (n) => String(n).padStart(2, '0');
  return `aide-interview-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`;
}

export { formatDateTime };
