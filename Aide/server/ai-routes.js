// AI 機能の API ルート（練習・本番・振り返り）
import { Router } from 'express';
import { askJson, AppError } from './claude.js';

export const aiRouter = Router();

// 文字列の長さを制限する（巨大な入力で料金がかさまないように）
function clip(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// 企業情報をプロンプト用のテキストにする
function describeCompany(company = {}) {
  return [
    `企業名：${clip(company.name, 100) || '（未設定）'}`,
    `職種：${clip(company.position, 100) || '（未設定）'}`,
    `選考段階：${clip(company.stage, 50) || '（未設定）'}`,
    company.memo ? `企業メモ：${clip(company.memo, 2000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// 発言を話者ラベル付きの1行にする（話者不明の場合はラベルなし）
function formatUtterance(u, max) {
  const label = { interviewer: '[面接官] ', self: '[自分] ' }[u.speaker] ?? '';
  return label + clip(u.text, max);
}

// 非同期ハンドラのエラーを共通処理に渡す
const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req.body ?? {}));
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof AppError ? error.message : 'サーバーでエラーが発生しました。';
    if (!(error instanceof AppError)) console.error(error);
    res.status(status).json({ error: message });
  }
};

// ---- 練習モード：面接官役の質問 ----
aiRouter.post(
  '/practice/question',
  handle(async ({ company, history = [] }) => {
    const past = history
      .slice(-6)
      .map((h, i) => `Q${i + 1}：${clip(h.question, 500)}\nA${i + 1}：${clip(h.answer, 2000)}`)
      .join('\n\n');
    return askJson({
      kind: 'deep',
      effort: 'medium',
      maxTokens: 4000,
      system:
        'あなたは日本企業の採用面接官です。応募者が面接の練習をしています。' +
        '企業・職種・選考段階にふさわしい質問を1つだけ、話し言葉で出してください。' +
        'これまでの質疑がある場合は、同じ質問を繰り返さず、直前の回答に曖昧さや掘り下げる価値があれば深掘り質問をしてください。',
      user: `${describeCompany(company)}\n\nこれまでの質疑：\n${past || '（まだありません。最初の質問です）'}`,
      schema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '面接官としての質問文' },
          isFollowUp: { type: 'boolean', description: '直前の回答への深掘り質問なら true' },
        },
        required: ['question', 'isFollowUp'],
        additionalProperties: false,
      },
    });
  }),
);

// ---- 練習モード：回答へのフィードバック ----
aiRouter.post(
  '/practice/feedback',
  handle(async ({ company, question, answer }) => {
    if (!clip(answer, 10).trim()) throw new AppError('回答が空です。', 400);
    const axis = {
      type: 'object',
      properties: {
        score: { type: 'integer', description: '1〜5の5段階評価' },
        comment: { type: 'string', description: '1〜2文の講評' },
      },
      required: ['score', 'comment'],
      additionalProperties: false,
    };
    return askJson({
      kind: 'deep',
      effort: 'medium',
      maxTokens: 8000,
      system:
        'あなたは面接対策の指導者です。応募者の回答（音声の文字起こしのため誤変換を含むことがあります）を評価します。' +
        '観点は「結論の明確さ」「具体性」「質問との一致」「長さ（1分前後・300字程度が目安）」です。' +
        '厳しすぎず、次の練習ですぐ直せる具体的な指摘をしてください。',
      user: `${describeCompany(company)}\n\n質問：${clip(question, 500)}\n\n回答：${clip(answer, 4000)}`,
      schema: {
        type: 'object',
        properties: {
          conclusion: axis,
          specificity: axis,
          relevance: axis,
          length: axis,
          good: { type: 'string', description: '良かった点（1〜2文）' },
          improve: { type: 'string', description: '改善点（1〜2文）' },
          tip: { type: 'string', description: '次に同じ質問をされたときの話の組み立て方のヒント（箇条書き風の短文）' },
        },
        required: ['conclusion', 'specificity', 'relevance', 'length', 'good', 'improve', 'tip'],
        additionalProperties: false,
      },
    });
  }),
);

// ---- 本番モード：いま聞かれている質問の要約と、関連エピソード・回答済み逆質問の判定 ----
aiRouter.post(
  '/live/analyze',
  handle(async ({ utterances = [], episodes = [], reverseQuestions = [] }) => {
    const log = utterances
      .slice(-12)
      .map((u) => formatUtterance(u, 400))
      .join('\n');
    const episodeList = episodes
      .slice(0, 50)
      .map((e) => `- id=${e.id}：${clip(e.title, 80)}${e.tags?.length ? `（${e.tags.slice(0, 5).join('、')}）` : ''}`)
      .join('\n');
    const reverseList = reverseQuestions
      .slice(0, 30)
      .map((q) => `- id=${q.id}：${clip(q.text, 200)}`)
      .join('\n');

    return askJson({
      kind: 'live',
      effort: 'low',
      maxTokens: 4000,
      system:
        '面接を受けている本人の手元メモを整理するアシスタントです。面接の文字起こし（誤変換を含む）を読み、次の3つだけを返します。' +
        '1) question：面接官がいま聞いている質問を、本人が一目で分かる25字以内の短い日本語にしたもの。質問が読み取れなければ空文字。' +
        '2) episodeIds：その質問に関係する、本人が事前に登録したエピソードの id（関連の強い順に最大3件、なければ空配列）。' +
        '3) answeredReverseIds：本人が用意した逆質問のうち、会話の中ですでに答えが出た、または質問済みのものの id。' +
        '回答例・回答文・話す内容の提案は絶対に生成しないでください。',
      user:
        `文字起こし（新しいものが下）：\n${log || '（なし）'}\n\n` +
        `登録済みエピソード：\n${episodeList || '（なし）'}\n\n` +
        `用意した逆質問：\n${reverseList || '（なし）'}`,
      schema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          episodeIds: { type: 'array', items: { type: 'string' } },
          answeredReverseIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['question', 'episodeIds', 'answeredReverseIds'],
        additionalProperties: false,
      },
    });
  }),
);

// ---- 振り返り：面接記録のまとめ ----
aiRouter.post(
  '/review/summary',
  handle(async ({ company, utterances = [], memo = '', checklist = [] }) => {
    const transcript = utterances
      .map((u) => formatUtterance(u, 2000))
      .join('\n');
    if (!transcript.trim() && !memo.trim()) throw new AppError('文字起こしとメモが空のため、まとめられません。', 400);
    const checks = checklist.map((c) => `- [${c.checked ? 'x' : ' '}] ${clip(c.text, 200)}`).join('\n');

    return askJson({
      kind: 'deep',
      effort: 'high',
      maxTokens: 16000,
      system:
        'あなたは面接対策の指導者です。面接を受けた本人のために、面接の記録（音声の文字起こし・メモ・逆質問のチェック結果）を振り返り用にまとめます。' +
        '文字起こしは誤変換を含むので、文脈から補って解釈してください。' +
        '[面接官]・[自分] のラベルがない発言は話者が区別されていないため、文脈から推測してください。' +
        '改善点と宿題は、次の面接までに実行できる具体的な内容にしてください。',
      user:
        `${describeCompany(company)}\n\n` +
        `文字起こし：\n${clip(transcript, 60000) || '（なし）'}\n\n` +
        `メモ：\n${clip(memo, 4000) || '（なし）'}\n\n` +
        `逆質問のチェック結果：\n${checks || '（なし）'}`,
      schema: {
        type: 'object',
        properties: {
          overview: { type: 'string', description: '面接全体の要約（3〜4文）' },
          qa: {
            type: 'array',
            description: '聞かれた質問と本人の回答の要約（時系列順）',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                answerSummary: { type: 'string' },
              },
              required: ['question', 'answerSummary'],
              additionalProperties: false,
            },
          },
          good: { type: 'array', items: { type: 'string' }, description: '良かった点' },
          improve: { type: 'array', items: { type: 'string' }, description: '改善点' },
          homework: { type: 'array', items: { type: 'string' }, description: '次回までの宿題' },
        },
        required: ['overview', 'qa', 'good', 'improve', 'homework'],
        additionalProperties: false,
      },
    });
  }),
);
