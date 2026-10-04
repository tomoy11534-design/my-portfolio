// 中継サーバーの API 呼び出し

export async function postApi(path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('サーバーに接続できません。npm run dev で起動しているか確認してください。');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `サーバーエラー（${res.status}）`);
  return data;
}

export async function getStatus() {
  try {
    const res = await fetch('/api/status');
    return res.ok ? await res.json() : { stt: false };
  } catch {
    return { stt: false };
  }
}
