import type { AudioAsset, DawProject, Track } from "../types";
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
  private buffers = new Map<string, AudioBuffer>();
  private sources: AudioBufferSourceNode[] = [];
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

  async play(project: DawProject, playhead: number) {
    const context = await this.ensureContext();
    this.stop();

    if (!this.master) {
      this.master = context.createGain();
      this.master.connect(context.destination);
    }

    this.startedAt = context.currentTime;
    this.playheadAtStart = playhead;
    this.playing = true;

    const soloActive = project.tracks.some((track) => track.solo);

    for (const track of project.tracks) {
      if (track.muted || (soloActive && !track.solo)) {
        continue;
      }

      const trackInput = this.createTrackInput(track);

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

        if (sourceDuration <= 0 || offset >= buffer.duration) {
          continue;
        }

        const source = context.createBufferSource();
        const clipGain = context.createGain();
        source.buffer = buffer;
        source.playbackRate.value = playbackRate;
        clipGain.gain.value = clip.gain;

        source.connect(clipGain);
        clipGain.connect(trackInput);

        const when = context.currentTime + Math.max(0, clipStart - playhead);
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

  private createTrackInput(track: Track) {
    const context = this.context!;
    const input = context.createGain();
    const low = context.createBiquadFilter();
    const mid = context.createBiquadFilter();
    const high = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const pan = context.createStereoPanner();
    const output = context.createGain();

    low.type = "lowshelf";
    low.frequency.value = 180;
    low.gain.value = track.eq.lowGain;

    mid.type = "peaking";
    mid.frequency.value = 1200;
    mid.Q.value = 0.85;
    mid.gain.value = track.eq.midGain;

    high.type = "highshelf";
    high.frequency.value = 6400;
    high.gain.value = track.eq.highGain;

    compressor.threshold.value = track.compressor.threshold;
    compressor.ratio.value = track.compressor.ratio;
    compressor.attack.value = track.compressor.attack;
    compressor.release.value = track.compressor.release;

    pan.pan.value = track.pan;
    output.gain.value = track.volume;

    input.connect(low);
    low.connect(mid);
    mid.connect(high);

    if (track.compressor.enabled) {
      high.connect(compressor);
      compressor.connect(pan);
    } else {
      high.connect(pan);
    }

    pan.connect(output);
    output.connect(this.master!);

    return input;
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
