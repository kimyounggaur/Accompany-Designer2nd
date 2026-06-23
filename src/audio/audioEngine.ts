import type { AudioAsset, Clip, DawProject, FadeCurve, Track } from "../types";
import { createDelayInsert } from "./delay";
import { createReverbInsert } from "./reverb";
import {
  createId,
  getClipPlaybackRate,
  getClipTimelineDuration,
} from "../utils/audioMath";

interface DecodedAudio {
  asset: AudioAsset;
  buffer: AudioBuffer;
}

class BrowserAudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private analyser?: AnalyserNode;
  private buffers = new Map<string, AudioBuffer>();
  private sources: AudioBufferSourceNode[] = [];
  // 매 play마다 생성되는 트랙 체인 출력 노드를 추적해 stop() 시 완전 해제
  private trackOutputs: GainNode[] = [];
  private trackAnalysers = new Map<string, AnalyserNode>();
  private startedAt = 0;
  private playheadAtStart = 0;
  private playing = false;

  async ensureContext() {
    if (!this.context) {
      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.context = new AudioContextCtor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.92;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.master.connect(this.analyser);
      this.master.connect(this.context.destination);
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    return this.context;
  }

  async decodeFile(file: File): Promise<DecodedAudio> {
    const context = await this.ensureContext();
    const data = await file.arrayBuffer();
    const buffer = await context.decodeAudioData(data.slice(0));
    const asset: AudioAsset = {
      id: createId("asset"),
      fileName: file.name,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      waveformPeaks: createWaveformPeaks(buffer),
      sourceType: "upload",
      mimeType: file.type || undefined,
      byteSize: file.size,
    };

    this.buffers.set(asset.id, buffer);
    return { asset, buffer };
  }

  async decodeBlob(
    blob: Blob,
    fileName: string,
    assetId = createId("asset"),
    sourceType: AudioAsset["sourceType"] = "recording",
  ): Promise<DecodedAudio> {
    const context = await this.ensureContext();
    const data = await blob.arrayBuffer();
    const buffer = await context.decodeAudioData(data.slice(0));
    const asset: AudioAsset = {
      id: assetId,
      fileName,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      waveformPeaks: createWaveformPeaks(buffer),
      sourceType,
      blobUrl: URL.createObjectURL(blob),
      mimeType: blob.type || "audio/wav",
      byteSize: blob.size,
      recordedAt: sourceType === "recording" ? new Date().toISOString() : undefined,
    };

    this.buffers.set(asset.id, buffer);
    return { asset, buffer };
  }

  registerBuffer(assetId: string, buffer: AudioBuffer) {
    this.buffers.set(assetId, buffer);
  }

  getBuffer(assetId: string) {
    return this.buffers.get(assetId);
  }

  getAnalyser(): AnalyserNode | undefined {
    return this.analyser;
  }

  getMasterAnalyser(): AnalyserNode | undefined {
    return this.analyser;
  }

  getTrackAnalyser(trackId: string): AnalyserNode | undefined {
    return this.trackAnalysers.get(trackId);
  }

  async play(project: DawProject, playhead: number) {
    const context = await this.ensureContext();
    this.stop(); // 이전 체인 완전 해제 후 재생 시작

    this.startedAt = context.currentTime;
    this.playheadAtStart = playhead;
    this.playing = true;

    const soloActive = project.tracks.some((track) => track.solo);

    for (const track of project.tracks) {
      if (track.muted || (soloActive && !track.solo)) {
        continue;
      }

      const trackInput = this.createTrackInput(track, project.bpm);

      for (const clip of track.clips) {
        if (clip.muted) {
          continue;
        }

        const buffer = this.buffers.get(clip.audioBufferId);
        if (!buffer) {
          continue;
        }

        const playbackRate = getClipPlaybackRate(project.bpm, clip);
        const timelineDuration = getClipTimelineDuration(project.bpm, clip);
        const clipStart = clip.startTime;
        const clipEnd = clipStart + timelineDuration;

        if (clipEnd <= playhead) {
          continue;
        }

        const elapsedInsideClip = Math.max(0, playhead - clipStart);
        const offset = clip.offset + elapsedInsideClip * playbackRate;
        const sourceDuration = Math.min(
          clip.duration - (offset - clip.offset),
          buffer.duration - offset,
        );
        const scheduledTimelineDuration = sourceDuration / playbackRate;

        if (sourceDuration <= 0 || offset >= buffer.duration) {
          continue;
        }

        const source = context.createBufferSource();
        const clipGain = context.createGain();
        source.buffer = buffer;
        source.playbackRate.value = playbackRate;

        source.connect(clipGain);
        clipGain.connect(trackInput);

        const when = context.currentTime + Math.max(0, clipStart - playhead);
        scheduleClipGainEnvelope(
          clipGain.gain,
          clip,
          when,
          elapsedInsideClip,
          scheduledTimelineDuration,
          timelineDuration,
        );
        source.start(when, offset, sourceDuration);
        this.sources.push(source);
      }
    }
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped sources throw in some browsers.
      }
      source.disconnect();
    }
    this.sources = [];

    // 트랙 처리 체인(EQ·컴프레서·팬)을 master에서 완전히 해제
    for (const output of this.trackOutputs) {
      try {
        output.disconnect();
      } catch {
        // ignore
      }
    }
    this.trackOutputs = [];
    this.trackAnalysers.clear();

    this.playing = false;
  }

  getCurrentPlayhead() {
    if (!this.context || !this.playing) {
      return this.playheadAtStart;
    }

    return this.playheadAtStart + (this.context.currentTime - this.startedAt);
  }

  isPlaying() {
    return this.playing;
  }

  private createTrackInput(track: Track, bpm: number) {
    const context = this.context!;
    const input = context.createGain();
    const bass = context.createBiquadFilter();
    const middleLow = context.createBiquadFilter();
    const middleHigh = context.createBiquadFilter();
    const high = context.createBiquadFilter();
    const presence = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const pan = context.createStereoPanner();
    const output = context.createGain();
    const trackAnalyser = context.createAnalyser();

    bass.type = "lowshelf";
    bass.frequency.value = 110;
    bass.gain.value = track.eq.bassGain;

    middleLow.type = "peaking";
    middleLow.frequency.value = 360;
    middleLow.Q.value = 0.9;
    middleLow.gain.value = track.eq.middleLowGain;

    middleHigh.type = "peaking";
    middleHigh.frequency.value = 1800;
    middleHigh.Q.value = 0.85;
    middleHigh.gain.value = track.eq.middleHighGain;

    high.type = "highshelf";
    high.frequency.value = 5600;
    high.gain.value = track.eq.highGain;

    presence.type = "peaking";
    presence.frequency.value = 10000;
    presence.Q.value = 0.75;
    presence.gain.value = track.eq.presenceGain;

    compressor.threshold.value = track.compressor.threshold;
    compressor.ratio.value = track.compressor.ratio;
    compressor.attack.value = track.compressor.attack;
    compressor.release.value = track.compressor.release;

    pan.pan.value = track.pan;
    output.gain.value = track.volume;
    trackAnalyser.fftSize = 2048;
    trackAnalyser.smoothingTimeConstant = 0.72;

    let effectOutput: AudioNode = input;
    const effectChain = track.effectChain?.length
      ? track.effectChain
      : [
          { id: "eq", type: "eq" as const, enabled: track.eq.enabled },
          { id: "comp", type: "comp" as const, enabled: track.compressor.enabled },
          { id: "delay", type: "delay" as const, enabled: track.delay?.enabled ?? false },
          { id: "reverb", type: "reverb" as const, enabled: track.reverb?.enabled ?? false },
        ];

    for (const slot of effectChain) {
      if (!slot.enabled) {
        continue;
      }

      if (slot.type === "eq" && track.eq.enabled) {
        effectOutput.connect(bass);
        bass.connect(middleLow);
        middleLow.connect(middleHigh);
        middleHigh.connect(high);
        high.connect(presence);
        effectOutput = presence;
        continue;
      }

      if (slot.type === "comp" && track.compressor.enabled) {
        effectOutput.connect(compressor);
        effectOutput = compressor;
        continue;
      }

      if (slot.type === "delay" && track.delay?.enabled) {
        const delayInsert = createDelayInsert(context, track.delay, bpm);
        effectOutput.connect(delayInsert.input);
        effectOutput = delayInsert.output;
        continue;
      }

      if (slot.type === "reverb" && track.reverb?.enabled) {
        const reverbInsert = createReverbInsert(context, track.reverb);
        effectOutput.connect(reverbInsert.input);
        effectOutput = reverbInsert.output;
      }
    }

    effectOutput.connect(pan);

    pan.connect(output);
    output.connect(trackAnalyser);
    trackAnalyser.connect(this.master!);
    this.trackAnalysers.set(track.id, trackAnalyser);

    // stop() 시 master에서 분리할 수 있도록 추적
    this.trackOutputs.push(output);

    return input;
  }
}

function createFadeCurve(
  curve: FadeCurve,
  direction: "in" | "out",
  startRatio: number,
  endRatio: number,
  gain: number,
) {
  const sampleCount = 64;
  const values = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    const position = startRatio + ((endRatio - startRatio) * index) / (sampleCount - 1);
    const safePosition = Math.min(1, Math.max(0, position));
    const value =
      direction === "in"
        ? curve === "linear"
          ? safePosition
          : Math.sin((Math.PI / 2) * safePosition)
        : curve === "linear"
          ? 1 - safePosition
          : Math.cos((Math.PI / 2) * safePosition);
    values[index] = Math.max(0.0001, value * gain);
  }

  return values;
}

function getFadeGainAt(
  position: number,
  clipGain: number,
  fadeIn: number,
  fadeOut: number,
  timelineDuration: number,
  curve: FadeCurve,
) {
  let gain = clipGain;

  if (fadeIn > 0 && position < fadeIn) {
    const ratio = Math.min(1, Math.max(0, position / fadeIn));
    gain *= curve === "linear" ? ratio : Math.sin((Math.PI / 2) * ratio);
  }

  if (fadeOut > 0 && position > timelineDuration - fadeOut) {
    const ratio = Math.min(1, Math.max(0, (position - (timelineDuration - fadeOut)) / fadeOut));
    gain *= curve === "linear" ? 1 - ratio : Math.cos((Math.PI / 2) * ratio);
  }

  return Math.max(0.0001, gain);
}

function scheduleFadeSegment(
  param: AudioParam,
  curve: FadeCurve,
  direction: "in" | "out",
  gain: number,
  when: number,
  segmentStart: number,
  segmentEnd: number,
  fadeStart: number,
  fadeDuration: number,
  playbackSegmentStart: number,
) {
  const duration = Math.max(0, segmentEnd - segmentStart);
  if (duration <= 0.001) {
    return;
  }

  const startRatio = Math.min(1, Math.max(0, (segmentStart - fadeStart) / fadeDuration));
  const endRatio = Math.min(1, Math.max(0, (segmentEnd - fadeStart) / fadeDuration));
  const startTime = when + (segmentStart - playbackSegmentStart);

  if (curve === "linear") {
    const startGain =
      direction === "in" ? gain * startRatio : gain * (1 - startRatio);
    const endGain = direction === "in" ? gain * endRatio : gain * (1 - endRatio);
    param.setValueAtTime(Math.max(0.0001, startGain), startTime);
    param.linearRampToValueAtTime(Math.max(0.0001, endGain), startTime + duration);
    return;
  }

  param.setValueCurveAtTime(
    createFadeCurve(curve, direction, startRatio, endRatio, gain),
    startTime,
    duration,
  );
}

function scheduleClipGainEnvelope(
  param: AudioParam,
  clip: Clip,
  when: number,
  elapsedInsideClip: number,
  scheduledTimelineDuration: number,
  timelineDuration: number,
) {
  const gain = Math.max(0, clip.gain);
  const curve = clip.fadeCurve ?? "equalPower";
  const fadeLimit = Math.max(0, timelineDuration / 2);
  const fadeIn = Math.min(Math.max(0, clip.fadeIn || 0), fadeLimit);
  const fadeOut = Math.min(Math.max(0, clip.fadeOut || 0), fadeLimit);
  const segmentStart = Math.max(0, elapsedInsideClip);
  const segmentEnd = Math.min(timelineDuration, segmentStart + scheduledTimelineDuration);

  param.cancelScheduledValues(when);
  if (gain <= 0) {
    param.setValueAtTime(0, when);
    return;
  }

  param.setValueAtTime(
    getFadeGainAt(segmentStart, gain, fadeIn, fadeOut, timelineDuration, curve),
    when,
  );

  if (fadeIn > 0 && segmentStart < fadeIn && segmentEnd > 0) {
    scheduleFadeSegment(
      param,
      curve,
      "in",
      gain,
      when,
      Math.max(segmentStart, 0),
      Math.min(segmentEnd, fadeIn),
      0,
      fadeIn,
      segmentStart,
    );
  }

  if (fadeIn > 0 && segmentStart < fadeIn && segmentEnd > fadeIn) {
    param.setValueAtTime(gain, when + (fadeIn - segmentStart));
  }

  const fadeOutStart = Math.max(0, timelineDuration - fadeOut);
  if (fadeOut > 0 && segmentEnd > fadeOutStart) {
    scheduleFadeSegment(
      param,
      curve,
      "out",
      gain,
      when,
      Math.max(segmentStart, fadeOutStart),
      segmentEnd,
      fadeOutStart,
      fadeOut,
      segmentStart,
    );
  }
}

function createWaveformPeaks(buffer: AudioBuffer, targetPeaks = 1800) {
  const peaks: number[] = [];
  const channelCount = buffer.numberOfChannels;
  const samplesPerPeak = Math.max(1, Math.floor(buffer.length / targetPeaks));
  const peakCount = Math.ceil(buffer.length / samplesPerPeak);
  const channels = Array.from({ length: channelCount }, (_, index) =>
    buffer.getChannelData(index),
  );

  for (let peakIndex = 0; peakIndex < peakCount; peakIndex += 1) {
    const start = peakIndex * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, buffer.length);
    let peak = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      for (const channel of channels) {
        peak = Math.max(peak, Math.abs(channel[sampleIndex]));
      }
    }

    peaks.push(peak);
  }

  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((peak) => peak / maxPeak);
}

export const audioEngine = new BrowserAudioEngine();
