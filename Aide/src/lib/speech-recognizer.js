// マイク音声の文字起こし（ブラウザの Web Speech API・日本語の連続認識）
const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const isSpeechSupported = Boolean(Recognition);

/**
 * @param {object} handlers
 * @param {(text: string) => void} handlers.onInterim 認識途中の文字列
 * @param {(text: string) => void} handlers.onFinal 確定した文字列
 * @param {(message: string, fatal: boolean) => void} handlers.onError エラー
 */
export function createSpeechRecognizer({ onInterim, onFinal, onError }) {
  if (!Recognition) {
    onError('このブラウザは音声認識に対応していません。Google Chrome をお使いください。', true);
    return { start() {}, stop() {} };
  }

  let recognition = null;
  let active = false;

  function build() {
    const r = new Recognition();
    r.lang = 'ja-JP';
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) onFinal(text);
        else interim += text;
      }
      onInterim(interim);
    };

    r.onerror = (event) => {
      // 無音・中断は自動で再開するので無視する
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        active = false;
        onError('マイクの使用が許可されていません。アドレスバーの設定からマイクを許可してください。', true);
        return;
      }
      if (event.error === 'audio-capture') {
        onError('マイクが見つかりません。接続を確認してください。', false);
        return;
      }
      if (event.error === 'network') {
        onError('音声認識の通信エラーです。ネットワークを確認してください。', false);
        return;
      }
      onError(`音声認識エラー（${event.error}）`, false);
    };

    // Chrome は一定時間で認識を終了するため、動作中なら作り直して再開する
    r.onend = () => {
      onInterim('');
      if (!active) return;
      setTimeout(() => {
        if (!active) return;
        recognition = build();
        try {
          recognition.start();
        } catch {
          // すでに開始済みなどは無視する
        }
      }, 250);
    };
    return r;
  }

  return {
    start() {
      if (active) return;
      active = true;
      recognition = build();
      try {
        recognition.start();
      } catch {
        // すでに開始済みなどは無視する
      }
    },
    stop() {
      active = false;
      recognition?.stop();
      recognition = null;
      onInterim('');
    },
  };
}
