class PCM16WorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const cfg = (options && options.processorOptions) || {};
    this.targetSampleRate = Number(cfg.targetSampleRate || 16000);
    this.frameSize = Number(cfg.frameSize || 2048);
    this.sampleBuffer = [];
  }

  downsample(input, inputRate, outputRate) {
    if (outputRate >= inputRate) {
      return input;
    }
    const ratio = inputRate / outputRate;
    const outputLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(outputLength);
    let out = 0;
    let inOffset = 0;
    while (out < outputLength) {
      const next = Math.floor((out + 1) * ratio);
      let sum = 0;
      let count = 0;
      for (let i = inOffset; i < next && i < input.length; i += 1) {
        sum += input[i];
        count += 1;
      }
      output[out] = count > 0 ? sum / count : 0;
      out += 1;
      inOffset = next;
    }
    return output;
  }

  floatToInt16Buffer(floatArray) {
    const int16 = new Int16Array(floatArray.length);
    for (let i = 0; i < floatArray.length; i += 1) {
      const s = Math.max(-1, Math.min(1, floatArray[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16.buffer;
  }

  flushFrames() {
    while (this.sampleBuffer.length >= this.frameSize) {
      const frame = this.sampleBuffer.slice(0, this.frameSize);
      this.sampleBuffer = this.sampleBuffer.slice(this.frameSize);
      const frameFloat = new Float32Array(frame);
      const pcmBuffer = this.floatToInt16Buffer(frameFloat);
      this.port.postMessage({ buffer: pcmBuffer }, [pcmBuffer]);
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const mono = input[0];
    const downsampled = this.downsample(mono, sampleRate, this.targetSampleRate);
    for (let i = 0; i < downsampled.length; i += 1) {
      this.sampleBuffer.push(downsampled[i]);
    }
    this.flushFrames();
    return true;
  }
}

registerProcessor('pcm16-worklet', PCM16WorkletProcessor);
