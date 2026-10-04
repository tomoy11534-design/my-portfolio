// Claude API 呼び出しの共通処理
import Anthropic from '@anthropic-ai/sdk';

// クライアントは初回呼び出し時に作る（APIキー未設定でもサーバー自体は起動できるように）
let client = null;
function getClient() {
  if (client) return client;
  try {
    client = new Anthropic();
  } catch {
    throw new AppError('Claude APIの認証情報が見つかりません。.env に ANTHROPIC_API_KEY を設定してください。', 500);
  }
  return client;
}

// 用途ごとのモデル（.env で上書き可能）
export const MODELS = {
  live: process.env.CLAUDE_MODEL_LIVE || 'claude-opus-5',
  deep: process.env.CLAUDE_MODEL_DEEP || 'claude-opus-5',
};

// アプリ内で扱うエラー（画面にそのまま出せる日本語メッセージを持つ）
export class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

// 安全分類器で断られたときに別モデルで自動再実行するサーバー側フォールバックの対象か
function supportsFallback(model) {
  if (process.env.CLAUDE_FALLBACKS === 'off') return false;
  return /^claude-(opus-5|fable-5)/.test(model);
}

// effort（思考の深さ）に対応していないモデルか
function supportsEffort(model) {
  return !/^claude-haiku/.test(model);
}

/**
 * JSON スキーマに沿った応答を受け取る
 * @param {object} p
 * @param {'live'|'deep'} p.kind 用途（モデルの選択に使う）
 * @param {string} p.system システムプロンプト
 * @param {string} p.user ユーザー入力
 * @param {object} p.schema 出力の JSON スキーマ
 * @param {'low'|'medium'|'high'} p.effort 思考の深さ
 * @param {number} p.maxTokens 出力上限
 */
export async function askJson({ kind, system, user, schema, effort, maxTokens = 16000 }) {
  const model = MODELS[kind];
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  };
  if (supportsEffort(model)) params.output_config.effort = effort;
  if (supportsFallback(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  const anthropic = getClient();
  let response;
  try {
    response = await anthropic.beta.messages.create(params);
  } catch (error) {
    throw toAppError(error);
  }

  if (response.stop_reason === 'refusal') {
    throw new AppError('AIがこの内容への応答を控えました。入力を見直してください。', 422);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AppError('AIの応答が長すぎて途中で切れました。もう一度お試しください。', 502);
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('AIの応答を読み取れませんでした。もう一度お試しください。', 502);
  }
}

// SDK のエラーを画面表示用のメッセージに変換する（具体的なものから順に判定）
function toAppError(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return new AppError('Claude APIキーが無効です。.env の ANTHROPIC_API_KEY を確認してください。', 401);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AppError('Claude APIの利用上限に達しました。少し待ってから再度お試しください。', 429);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AppError(`Claude APIへのリクエストが不正です：${error.message}`, 400);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AppError('Claude APIに接続できません。ネットワークを確認してください。', 503);
  }
  if (error instanceof Anthropic.APIError) {
    return new AppError(`Claude APIでエラーが発生しました（${error.status}）。`, 502);
  }
  // API に届く前のエラー（認証情報が見つからない等）。原因の確認用にサーバー側へ出力する
  console.error(error);
  return new AppError('Claude APIを呼び出せません。.env の ANTHROPIC_API_KEY が設定されているか確認してください。', 500);
}
