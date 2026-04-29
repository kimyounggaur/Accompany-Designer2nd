import { encodeWav } from "../utils/wavEncoder";

interface RecorderCallbacks {
  onPeaks: (peaks: number[], elapsed: number) => void;
}

interface RecorderOptions {
  inputDeviceId?: string;
  monitoringEnabled?: boolean;
}

interface RecorderResult {
  blob: Blob;
  duration: number;
  peaks: number[];
  sampleRate: number;
}

class VocalRecorder {
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode;
  private monitorGain?: GainNode;
  private chunks: Float32Array[] = [];
  private peaks: number[] = [];
  private sampleRate = 44100;
  private samplesRecorded = 0;
  private lastPeakUpdate = 0;
  private recording = false;

  async start(
    context: AudioContext,
    callbacks: RecorderCallbacks,
    options: RecorderOptions = {},
  ) {
    if (this.recording) {
      throw new Error("이미 녹음 중입니다.");
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저는 마이크 녹음을 지원하지 않습니다.");
    }

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };

    if (options.inputDeviceId) {
      audioConstraints.deviceId = { exact: options.inputDeviceId };
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
    });
    this.source = context.createMediaStreamSource(this.stream);
    this.processor = context.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.peaks = [];
    this.sampleRate = context.sampleRate;
    this.samplesRecorded = 0;
    this.lastPeakUpdate = performance.now();
    this.recording = true;

    this.processor.onaudioprocess = (event) => {
      if (!this.recording) {
        return;
      }

      const input = event.inputBuffer;
      const output = event.outputBuffer.getChannelData(0);
      output.fill(0);

      const frameCount = input.length;
      const channelCount = input.numberOfChannels;
      const mono = new Float32Array(frameCount);
      let peak = 0;

      for (let sampleIndex = 0; sampleIndex < frameCount; sampleIndex += 1) {
        let sample = 0;
        for (let channel = 0; channel < channelCount; channel += 1) {
          sample += input.getChannelData(channel)[sampleIndex] || 0;
        }

        sample /= Math.max(1, channelCount);
        mono[sampleIndex] = sample;
        peak = Math.max(peak, Math.abs(sample));
      }

      this.chunks.push(mono);
      this.peaks.push(peak);
      this.samplesRecorded += frameCount;

      const now = performance.now();
      if (now - this.lastPeakUpdate >= 80) {
        this.lastPeakUpdate = now;
        callbacks.onPeaks([...this.peaks], this.getElapsed());
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(context.destination);

    if (options.monitoringEnabled) {
      this.monitorGain = context.createGain();
      this.monitorGain.gain.value = 0.85;
      this.source.connect(this.monitorGain);
      this.monitorGain.connect(context.destination);
    }
  }

  stop(): RecorderResult {
    if (!this.recording) {
      throw new Error("진행 중인 녹음이 없습니다.");
    }

    this.recording = false;
    const duration = this.getElapsed();
    const peaks = [...this.peaks];
    const blob = encodeWav(this.chunks, this.sampleRate, 1);
    this.cleanup();

    return {
      blob,
      duration,
      peaks,
      sampleRate: this.sampleRate,
    };
  }

  cancel() {
    this.recording = false;
    this.cleanup();
  }

  isRecording() {
    return this.recording;
  }

  private getElapsed() {
    return this.samplesRecorded / this.sampleRate;
  }

  private cleanup() {
    this.monitorGain?.disconnect();
    this.processor?.disconnect();
    this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }

    this.processor = undefined;
    this.monitorGain = undefined;
    this.source = undefined;
    this.stream = undefined;
  }
}

export const vocalRecorder = new VocalRecorder();
