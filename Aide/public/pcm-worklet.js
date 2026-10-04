// 音声を 16bit PCM に変換し、約100ミリ秒ごとにメインスレッドへ送る AudioWorklet
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    // AudioContext は 16kHz で作るため、1600 サンプル ≒ 100ミリ秒
    this.buffer = new Int16Array(1600);
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.length++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.length === this.buffer.length) {
        this.port.postMessage(this.buffer.buffer.slice(0));
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
