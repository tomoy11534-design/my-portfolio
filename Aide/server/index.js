// Aide の中継サーバー
// ・Claude API と音声認識 API のキーをブラウザに出さずに中継する
// ・開発時は Vite をミドルウェアとして組み込み、1つのポートで画面と API を提供する
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { aiRouter } from './ai-routes.js';
import { MODELS } from './claude.js';
import { attachSttRelay, isSttConfigured } from './stt-relay.js';

const isProd = process.argv.includes('--prod');
const port = Number(process.env.PORT) || 5173;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const app = express();
const httpServer = createServer(app);

app.use(express.json({ limit: '2mb' }));

// 画面側で使える機能の確認用
app.get('/api/status', (_req, res) => {
  res.json({ stt: isSttConfigured(), models: MODELS });
});
app.use('/api', aiRouter);

attachSttRelay(httpServer);

if (isProd) {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

// マイク・画面共有はセキュアな環境（localhost か HTTPS）でしか使えないため localhost で待ち受ける
httpServer.listen(port, '127.0.0.1', () => {
  console.log(`Aide: http://localhost:${port}`);
  if (!isSttConfigured()) {
    console.log('※ DEEPGRAM_API_KEY が未設定のため、面接官の声（ヘッドホン使用時）の文字起こしは使えません。');
  }
});
