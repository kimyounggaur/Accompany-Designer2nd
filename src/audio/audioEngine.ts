import type { AudioAsset, Clip, DawProject } from "../types";
import { attachProbe, isProbeEnabled } from "./probe";
import { planSync, type SyncDoc } from "./engine/syncPlan";
import { clipSignature } from "./engine/clipSignature";
import { scheduleClipGainEnvelope } from "./engine/clipEnvelope";
import { createTrackGraph, disposeGraph, graphSignature, updateTrackGraph, type TrackGraph } from "./engine/trackGraph";
import { getProjectDuration } from "../utils/audioMath";
import { encodeWav } from "../utils/wavEncoder";
import { projectTailSeconds } from "./effects/tail";
import {
  createId,
  getClipPlaybackRate,
  getClipTimelineDuration,
} from "../utils/audioMath";

interface DecodedAudio {
  asset: AudioAsset;
  buffer: AudioBuffer;
}

/**
 * 옛 엔진(재생 구조 교체 전). 새 엔진(`engine/AudioEngine.ts`, `?engine=v2`)이 이 클래스를 이어받아 소리 경로·마스터·음원 보관 같은
 * 아직 옮기지 않은 부분을 그대로 쓴다. 3단계가 끝나 옛 엔진을 지울 때 함께 정리된다.
 */
export class BrowserAudioEngine {
  protected context?: AudioContext;
  protected master?: GainNode;
  protected analyser?: AnalyserNode;
  protected buffers = new Map<string, AudioBuffer>();
  private sources = new Map<string, ScheduledClip>();
  protected trackGraphs = new Map<string, TrackGraph>();
  protected trackAnalysers = new Map<string, AnalyserNode>();
  private startedAt = 0;
  private playheadAtStart = 0;
  private playing = false;
  /** 소리 경로가 마지막으로 맞춰진 문서. 다음 sync는 이것과 비교한다(재생 시작 직후 문서가 바뀐 경우도 안전하다). */
  private syncedDoc?: SyncDoc;

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
      // 주소에 ?probe=1이 있을 때만: 스피커로 나가는 신호를 직접 재는 개발용 프로브(audio/probe.ts)
      if (isProbeEnabled()) {
        attachProbe(this.context, this.analyser).catch((error: unknown) => console.warn("출력 측정 프로브를 붙이지 못했습니다.", error));
      }
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

  /** 재생이 끝나는 타임라인 위치(초). 옛 엔진은 곡 길이(마지막 클립 + 여백)에서 멈춘다. */
  getPlaybackEnd(project: Pick<DawProject, "bpm" | "tracks">): number {
    return getProjectDuration(project);
  }

  async play(project: DawProject, playhead: number) {
    const context = await this.ensureContext();
    this.stop();
    this.startedAt = context.currentTime;
    this.playheadAtStart = playhead;
    this.playing = true;
    this.sync(project);
  }

  /**
   * 문서에 맞춰 소리 경로를 고친다. 비교는 참조(===)로만 한다: 바뀌지 않은 트랙과 클립은 건드리지 않고,
   * 재생 중인 소스와 이펙트 꼬리는 그대로 둔다. 두 번째 인자는 알려 주는 용도일 뿐, 기준은 엔진이 마지막으로 맞춘 문서다.
   */
  sync(project: SyncDoc, _previous?: SyncDoc) {
    if (!this.playing || !this.context || !this.master) return;
    if (project === this.syncedDoc) return;
    const context = this.context;
    const plan = planSync(project, this.syncedDoc);

    for (const id of plan.removedTrackIds) {
      for (const [clipId, scheduled] of this.sources) {
        if (scheduled.trackId === id) {
          stopSource(scheduled.source);
          this.sources.delete(clipId);
        }
      }
      const graph = this.trackGraphs.get(id);
      if (graph) disposeGraph(graph);
      this.trackGraphs.delete(id);
      this.trackAnalysers.delete(id);
    }

    const touchedTracks = new Set<string>();
    const activeClips = new Set<string>();
    for (const step of plan.steps) {
      const { track } = step;
      let graph = this.trackGraphs.get(track.id);
      let rebuilt = false;
      // 이펙트 켜기/끄기·순서 같은 연결 모양이 바뀌었을 때만 이 트랙의 그래프를 새로 만든다.
      if (!graph || (step.trackChanged && graph.signature !== graphSignature(track, project.bpm))) {
        if (graph) disposeGraph(graph);
        graph = createTrackGraph(context, this.master, track, project.bpm);
        this.trackGraphs.set(track.id, graph);
        this.trackAnalysers.set(track.id, graph.analyser);
        // 이 트랙의 소스만 다시 연결하면 된다.
        for (const [clipId, scheduled] of this.sources) {
          if (scheduled.trackId === track.id) {
            stopSource(scheduled.source);
            this.sources.delete(clipId);
          }
        }
        rebuilt = true;
      }
      if (step.updateParams || rebuilt) updateTrackGraph(graph, track, plan.solo, context.currentTime, project.bpm);
      if (!step.reconcileClips && !rebuilt) continue;

      touchedTracks.add(track.id);
      for (const clip of track.clips) {
        if (clip.isRecording || clip.muted) continue;
        const buffer = this.buffers.get(clip.audioBufferId);
        if (!buffer) continue;
        activeClips.add(clip.id);
        const previous = this.sources.get(clip.id);
        // 같은 클립 객체이고 템포·그래프가 그대로면 예약을 건드리지 않는다.
        if (previous && previous.clip === clip && previous.trackId === track.id && !plan.tempoChanged) continue;
        const signature = clipSignature(track.id, clip, project.bpm);
        if (previous?.signature === signature) {
          previous.clip = clip;
          continue;
        }
        if (previous) stopSource(previous.source);
        const source = scheduleClip(context, graph.input, buffer, clip, project.bpm, this.getCurrentPlayhead());
        if (source) this.sources.set(clip.id, { source, signature, trackId: track.id, clip });
        else this.sources.delete(clip.id);
      }
    }

    // 다시 맞춘 트랙에서 더 이상 소리 나면 안 되는 클립(지움·음소거·녹음 중)은 멈춘다.
    for (const [clipId, scheduled] of this.sources) {
      if (touchedTracks.has(scheduled.trackId) && !activeClips.has(clipId)) {
        stopSource(scheduled.source);
        this.sources.delete(clipId);
      }
    }
    this.syncedDoc = project;
  }

  stop() {
    for (const scheduled of this.sources.values()) stopSource(scheduled.source);
    this.sources.clear();
    for (const graph of this.trackGraphs.values()) disposeGraph(graph);
    this.trackGraphs.clear();
    this.trackAnalysers.clear();
    this.syncedDoc = undefined;
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
    const tail = projectTailSeconds(project);
    const sampleRate = Math.min(48000, Math.max(22050, project.sampleRate || 44100));
    const duration = end + tail;
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

interface ScheduledClip { source: AudioBufferSourceNode; signature: string; trackId: string; clip: Clip; }

function stopSource(source: AudioBufferSourceNode) {
  try { source.stop(); } catch { /* source may already have ended */ }
  try { source.disconnect(); } catch { /* already disconnected */ }
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
