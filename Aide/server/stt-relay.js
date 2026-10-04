// 面接官の声（PCの再生音）の文字起こし中継
// ブラウザから届く 16kHz・16bit・モノラルの PCM を Deepgram のストリーミング認識へ送り、結果をブラウザへ返す
import { WebSocket, WebSocketServer } from 'ws';

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';

export function isSttConfigured() {
  return Boolean(process.env.DEEPGRAM_API_KEY);
}

// HTTP サーバーに /ws/stt の WebSocket を取り付ける
export function attachSttRelay(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== '/ws/stt') return; // Vite の HMR など他の接続には触らない
    wss.handleUpgrade(req, socket, head, (client) => relay(client));
  });
}

function relay(client) {
  const send = (payload) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
  };

  if (!isSttConfigured()) {
    send({ type: 'error', message: '音声認識のAPIキー（DEEPGRAM_API_KEY）が設定されていません。' });
    client.close();
    return;
  }

  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || 'nova-2',
    language: 'ja',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    punctuate: 'true',
    smart_format: 'true',
    endpointing: '400',
  });
  const upstream = new WebSocket(`${DEEPGRAM_URL}?${params}`, {
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
  });

  // 接続完了までに届いた音声は貯めておく
  const pending = [];
  let lastAudioAt = Date.now();

  // 一時停止中も接続が切れないよう、音声が途切れたら KeepAlive を送る
  const keepAlive = setInterval(() => {
    if (upstream.readyState === WebSocket.OPEN && Date.now() - lastAudioAt > 5000) {
      upstream.send(JSON.stringify({ type: 'KeepAlive' }));
    }
  }, 4000);

  upstream.on('open', () => {
    for (const chunk of pending.splice(0)) upstream.send(chunk);
    send({ type: 'ready' });
  });

  upstream.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type !== 'Results') return;
    // 日本語は単語ごとに空白が入ることがあるため取り除く
    const text = (msg.channel?.alternatives?.[0]?.transcript ?? '').replace(/\s+/g, '');
    if (!text) return;
    send({ type: 'transcript', text, isFinal: Boolean(msg.is_final) });
  });

  upstream.on('unexpected-response', (_req, res) => {
    const message =
      res.statusCode === 401
        ? '音声認識のAPIキーが無効です。DEEPGRAM_API_KEY を確認してください。'
        : `音声認識サービスに接続できません（${res.statusCode}）。`;
    send({ type: 'error', message });
    client.close();
  });

  upstream.on('error', () => {
    send({ type: 'error', message: '音声認識サービスとの通信でエラーが発生しました。' });
  });

  upstream.on('close', () => {
    clearInterval(keepAlive);
    if (client.readyState === WebSocket.OPEN) client.close();
  });

  client.on('message', (data, isBinary) => {
    if (!isBinary) return;
    lastAudioAt = Date.now();
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
    else if (upstream.readyState === WebSocket.CONNECTING) pending.push(data);
  });

  client.on('close', () => {
    clearInterval(keepAlive);
    if (upstream.readyState === WebSocket.OPEN) {
      // 残りの音声を確定させてから閉じる
      upstream.send(JSON.stringify({ type: 'CloseStream' }));
      setTimeout(() => upstream.close(), 1500);
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      upstream.terminate();
    }
  });
}
