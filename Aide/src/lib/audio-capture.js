// 音声の取り込み（PCの再生音・マイク）、音量メーター、再生音の文字起こし

/**
 * 画面共有ダイアログから PC の再生音を取得する
 * ・ブラウザ版の面接：Chromeタブを選び「タブの音声も共有」をON
 * ・アプリ版の面接：画面全体を選び「システム音声も共有」をON
 */
export async function captureSystemAudio() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('このブラウザは画面共有に対応していません。Google Chrome をお使いください。');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      // Chrome は映像なしの共有を受け付けないため、最小限の映像を要求して使わずに止めておく
      video: { width: 320, height: 180, frameRate: 1 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    });
  } catch (error) {
    if (error?.name === 'NotAllowedError') throw new Error('画面共有がキャンセルされました。');
    throw new Error('画面共有を開始できませんでした。');
  }
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('音声が共有されていません。共有ダイアログで「タブの音声も共有」または「システム音声も共有」をONにしてください。');
  }
  stream.getVideoTracks().forEach((t) => (t.enabled = false));
  return stream;
}

// 音量メーター用のマイク入力（文字起こしは Web Speech API が別に行う）
export async function captureMic() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error('マイクの使用が許可されていません。アドレスバーの設定からマイクを許可してください。');
  }
}

export function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * 音量メーター。level() で 0〜1 の音量を返す
 */
export function createLevelMeter(stream) {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);

  return {
    level() {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      // RMS を見やすい範囲に伸ばす
      return Math.min(1, Math.sqrt(sum / data.length) * 4);
    },
    stop() {
      source.disconnect();
      ctx.close();
    },
  };
}

/**
 * PC の再生音を中継サーバー経由で音声認識 API へ送り、文字起こしする
 */
export async function createSystemTranscriber(stream, { onInterim, onFinal, onError }) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('/pcm-worklet.js');
  const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const worklet = new AudioWorkletNode(ctx, 'pcm-worklet');
  // 出力はスピーカーに流さず、処理のためだけにつなぐ
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(worklet).connect(mute).connect(ctx.destination);

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}/ws/stt`);
  ws.binaryType = 'arraybuffer';
  let paused = false;
  let closedByUser = false;
  let errorShown = false;

  worklet.port.onmessage = (event) => {
    if (!paused && ws.readyState === WebSocket.OPEN) ws.send(event.data);
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'transcript') {
      if (msg.isFinal) {
        onInterim('');
        onFinal(msg.text);
      } else {
        onInterim(msg.text);
      }
    } else if (msg.type === 'error') {
      errorShown = true;
      onError(msg.message);
    }
  };
  ws.onclose = () => {
    // サーバーから理由が届いている場合は、それを表示済みなので重ねて出さない
    if (!closedByUser && !errorShown) onError('面接官の声の文字起こしが切断されました。取り込み方法を選び直してください。');
  };

  return {
    pause() {
      paused = true;
      onInterim('');
    },
    resume() {
      paused = false;
    },
    stop() {
      closedByUser = true;
      worklet.port.onmessage = null;
      source.disconnect();
      ctx.close();
      ws.close();
      onInterim('');
    },
  };
}
