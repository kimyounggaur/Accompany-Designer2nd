import type { AudioAsset, Clip, DawProject, FadeCurve, Track } from "../types";
import { createDelayInsert } from "./delay";
import { createReverbInsert } from "./reverb";
import { encodeWav } from "../utils/wavEncoder";
import { getDelayTimeMs, normalizeDelaySettings } from "../utils/delay";
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
  private sources = new Map<string, ScheduledClip>();
  private trackGraphs = new Map<string, TrackGraph>();
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
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      this.master.connect(limiter);
      const ceiling = createSafetyCeiling(this.context);
      limiter.connect(ceiling);
      ceiling.connect(this.analyser);
      this.analyser.connect(this.context.destination);
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

  removeBuffer(assetId: string) {
    this.buffers.delete(assetId);
  }

  clearBuffers() {
    this.buffers.clear();
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
    this.stop();
    this.startedAt = context.currentTime;
    this.playheadAtStart = playhead;
    this.playing = true;
    this.sync(project);
  }

  /** Reconcile only the changed clips and parameters; leave unrelated sources and effect tails running. */
  sync(project: DawProject) {
    if (!this.playing || !this.context || !this.master) return;
    const context = this.context;
    const solo = project.tracks.some((track) => track.solo);
    const trackIds = new Set(project.tracks.map((track) => track.id));
    for (const [id, graph] of this.trackGraphs) {
      if (!trackIds.has(id)) {
        disposeGraph(graph);
        this.trackGraphs.delete(id);
        this.trackAnalysers.delete(id);
      }
    }
    const activeClips = new Set<string>();
    for (const track of project.tracks) {
      const signature = graphSignature(track, project.bpm);
      let graph = this.trackGraphs.get(track.id);
      if (!graph || graph.signature !== signature) {
        if (graph) disposeGraph(graph);
        graph = createTrackGraph(context, this.master, track, project.bpm);
        this.trackGraphs.set(track.id, graph);
        this.trackAnalysers.set(track.id, graph.analyser);
        // Only sources on this particular track need reconnecting.
        for (const [id, scheduled] of this.sources) {
          if (scheduled.trackId === track.id) {
            stopSource(scheduled.source);
            this.sources.delete(id);
          }
        }
      }
      updateTrackGraph(graph, track, solo, context.currentTime, project.bpm);
      for (const clip of track.clips) {
        if (clip.isRecording || clip.muted) continue;
        const buffer = this.buffers.get(clip.audioBufferId);
        if (!buffer) continue;
        const clipSignature = JSON.stringify([track.id, clip.audioBufferId, clip.startTime, clip.offset, clip.duration,
          getClipPlaybackRate(project.bpm, clip), clip.gain, clip.fadeIn, clip.fadeOut, clip.fadeCurve]);
        activeClips.add(clip.id);
        const previous = this.sources.get(clip.id);
        if (previous?.signature === clipSignature) continue;
        if (previous) stopSource(previous.source);
        const source = scheduleClip(context, graph.input, buffer, clip, project.bpm, this.getCurrentPlayhead());
        if (source) this.sources.set(clip.id, { source, signature: clipSignature, trackId: track.id });
        else this.sources.delete(clip.id);
      }
    }
    for (const [id, scheduled] of this.sources) {
      if (!activeClips.has(id)) {
        stopSource(scheduled.source);
        this.sources.delete(id);
      }
    }
  }

  stop() {
    for (const scheduled of this.sources.values()) stopSource(scheduled.source);
    this.sources.clear();
    for (const graph of this.trackGraphs.values()) disposeGraph(graph);
    this.trackGraphs.clear();
    this.trackAnalysers.clear();
    this.playing = false;
  }

  getCurrentPlayhead() {
    if (!this.context || !this.playing) return this.playheadAtStart;
    return this.playheadAtStart + (this.context.currentTime - this.startedAt);
  }

  isPlaying() { return this.playing; }

  /** Render the same track/effect graph used for playback to 16-bit stereo WAV. */
  async renderMix(project: DawProject): Promise<Blob> {
    const clips = project.tracks.flatMap((track) => track.clips.filter((clip) => !clip.muted && !clip.isRecording));
    if (!clips.length) throw new Error("내보낼 클립이 없습니다.");
    const missing = clips.filter((clip) => !this.buffers.has(clip.audioBufferId));
    if (missing.length) throw new Error(`음원 ${missing.length}개를 찾을 수 없습니다. 음원을 다시 연결해 주세요.`);
    const end = Math.max(...clips.map((clip) => clip.startTime + getClipTimelineDuration(project.bpm, clip)));
    const tail = project.tracks.reduce((max, track) => {
      const reverbTail = track.reverb?.enabled ? track.reverb.decay + track.reverb.preDelayMs / 1000 : 0;
      const delay = track.delay?.enabled ? normalizeDelaySettings(track.delay) : undefined;
      const repeats = delay && delay.feedback > 0 ? Math.ceil(Math.log(0.001) / Math.log(delay.feedback)) : 1;
      const delayTail = delay ? (getDelayTimeMs(delay, project.bpm) / 1000) * repeats : 0;
      // Serial delay followed by reverb can extend the tail by both amounts.
      return Math.max(max, reverbTail + delayTail);
    }, 0);
    const sampleRate = Math.min(48000, Math.max(22050, project.sampleRate || 44100));
    const duration = end + Math.min(30, tail);
    if (duration > 3600) throw new Error("1시간 이하의 프로젝트만 WAV로 내보낼 수 있습니다.");
    const context = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
    const master = context.createGain();
    master.gain.value = 0.92;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.003; limiter.release.value = 0.1;
    const ceiling = createSafetyCeiling(context);
    master.connect(limiter); limiter.connect(ceiling); ceiling.connect(context.destination);
    const solo = project.tracks.some((track) => track.solo);
    for (const track of project.tracks) {
      const graph = createTrackGraph(context, master, track, project.bpm);
      updateTrackGraph(graph, track, solo, 0, project.bpm);
      graph.output.gain.setValueAtTime(track.muted || (solo && !track.solo) ? 0 : track.volume, 0);
      for (const clip of track.clips) {
        const buffer = this.buffers.get(clip.audioBufferId);
        if (buffer && !clip.muted && !clip.isRecording) scheduleClip(context, graph.input, buffer, clip, project.bpm, 0);
      }
    }
    const result = await context.startRendering();
    const interleaved = new Float32Array(result.length * 2);
    const left = result.getChannelData(0), right = result.getChannelData(1);
    for (let i = 0; i < result.length; i++) { interleaved[i * 2] = left[i]; interleaved[i * 2 + 1] = right[i]; }
    return encodeWav([interleaved], sampleRate, 2);
  }

}

function createSafetyCeiling(context: BaseAudioContext): WaveShaperNode {
  // The compressor controls average level; this final ceiling also catches fast peaks.
  const ceiling = context.createWaveShaper();
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) curve[i] = ((i / (curve.length - 1)) * 2 - 1) * 0.98;
  ceiling.curve = curve;
  ceiling.oversample = "2x";
  return ceiling;
}

interface ScheduledClip { source: AudioBufferSourceNode; signature: string; trackId: string; }
interface TrackGraph {
  input: GainNode; output: GainNode; analyser: AnalyserNode; signature: string;
  pan: StereoPannerNode; eq: BiquadFilterNode[]; compressor: DynamicsCompressorNode;
  delay?: ReturnType<typeof createDelayInsert>; reverb?: ReturnType<typeof createReverbInsert>;
}

function disposeGraph(graph: TrackGraph) {
  graph.input.disconnect(); graph.output.disconnect(); graph.analyser.disconnect();
  graph.delay?.dispose();
}

function stopSource(source: AudioBufferSourceNode) {
  try { source.stop(); } catch { /* source may already have ended */ }
  try { source.disconnect(); } catch { /* already disconnected */ }
}

function graphSignature(track: Track, _bpm: number) {
  // Effect topology and effect settings require a new graph. Mixer and EQ/comp parameters update in place.
  return JSON.stringify([track.effectChain, track.eq.enabled, track.compressor.enabled,
    track.delay?.enabled, track.delay?.pingPong, track.reverb?.enabled]);
}

function updateTrackGraph(graph: TrackGraph, track: Track, solo: boolean, time: number, bpm: number) {
  const smooth = (param: AudioParam, value: number) => param.setTargetAtTime(value, time, 0.01);
  smooth(graph.output.gain, track.muted || (solo && !track.solo) ? 0 : track.volume);
  smooth(graph.pan.pan, track.pan);
  [track.eq.bassGain, track.eq.middleLowGain, track.eq.middleHighGain, track.eq.highGain, track.eq.presenceGain]
    .forEach((gain, i) => smooth(graph.eq[i].gain, gain));
  smooth(graph.compressor.threshold, track.compressor.threshold);
  smooth(graph.compressor.ratio, track.compressor.ratio);
  smooth(graph.compressor.attack, track.compressor.attack);
  smooth(graph.compressor.release, track.compressor.release);
  graph.delay?.update(track.delay, bpm);
  graph.reverb?.update(track.reverb);
}

function createTrackGraph(context: BaseAudioContext, master: AudioNode, track: Track, bpm: number): TrackGraph {
  const input = context.createGain();
  const eq = [context.createBiquadFilter(), context.createBiquadFilter(), context.createBiquadFilter(),
    context.createBiquadFilter(), context.createBiquadFilter()];
  const [bass, middleLow, middleHigh, high, presence] = eq;
  bass.type = "lowshelf"; bass.frequency.value = 110; bass.gain.value = track.eq.bassGain;
  middleLow.type = "peaking"; middleLow.frequency.value = 360; middleLow.Q.value = 0.9; middleLow.gain.value = track.eq.middleLowGain;
  middleHigh.type = "peaking"; middleHigh.frequency.value = 1800; middleHigh.Q.value = 0.85; middleHigh.gain.value = track.eq.middleHighGain;
  high.type = "highshelf"; high.frequency.value = 5600; high.gain.value = track.eq.highGain;
  presence.type = "peaking"; presence.frequency.value = 10000; presence.Q.value = 0.75; presence.gain.value = track.eq.presenceGain;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = track.compressor.threshold; compressor.ratio.value = track.compressor.ratio;
  compressor.attack.value = track.compressor.attack; compressor.release.value = track.compressor.release;
  const pan = context.createStereoPanner(); pan.pan.value = track.pan;
  const output = context.createGain(); output.gain.value = track.volume;
  const analyser = context.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.72;
  let delay: ReturnType<typeof createDelayInsert> | undefined;
  let reverb: ReturnType<typeof createReverbInsert> | undefined;
  let effectOutput: AudioNode = input;
  const chain = track.effectChain?.length ? track.effectChain : [
    {id: "eq", type: "eq" as const, enabled: track.eq.enabled},
    {id: "comp", type: "comp" as const, enabled: track.compressor.enabled},
    {id: "delay", type: "delay" as const, enabled: track.delay?.enabled ?? false},
    {id: "reverb", type: "reverb" as const, enabled: track.reverb?.enabled ?? false},
  ];
  for (const slot of chain) {
    if (!slot.enabled) continue;
    if (slot.type === "eq" && track.eq.enabled) {
      effectOutput.connect(bass); bass.connect(middleLow); middleLow.connect(middleHigh); middleHigh.connect(high); high.connect(presence); effectOutput = presence;
    } else if (slot.type === "comp" && track.compressor.enabled) {
      effectOutput.connect(compressor); effectOutput = compressor;
    } else if (slot.type === "delay" && track.delay?.enabled) {
      delay = createDelayInsert(context, track.delay, bpm); effectOutput.connect(delay.input); effectOutput = delay.output;
    } else if (slot.type === "reverb" && track.reverb?.enabled) {
      reverb = createReverbInsert(context, track.reverb); effectOutput.connect(reverb.input); effectOutput = reverb.output;
    }
  }
  effectOutput.connect(pan); pan.connect(output); output.connect(analyser); analyser.connect(master);
  return { input, output, analyser, signature: graphSignature(track, bpm), pan, eq, compressor, delay, reverb };
}

function scheduleClip(context: BaseAudioContext, input: AudioNode, buffer: AudioBuffer, clip: Clip, bpm: number, playhead: number) {
  const rate = getClipPlaybackRate(bpm, clip);
  const timelineDuration = getClipTimelineDuration(bpm, clip);
  if (clip.startTime + timelineDuration <= playhead) return undefined;
  const elapsed = Math.max(0, playhead - clip.startTime);
  const offset = clip.offset + elapsed * rate;
  const duration = Math.min(clip.duration - (offset - clip.offset), buffer.duration - offset);
  if (duration <= 0 || offset >= buffer.duration) return undefined;
  const source = context.createBufferSource(); const gain = context.createGain();
  source.buffer = buffer; source.playbackRate.value = rate; source.connect(gain); gain.connect(input);
  const when = context.currentTime + Math.max(0, clip.startTime - playhead);
  scheduleClipGainEnvelope(gain.gain, clip, when, elapsed, duration / rate, timelineDuration);
  source.start(when, offset, duration);
  return source;
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
