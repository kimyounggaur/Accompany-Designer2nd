import type { Clip } from "../../types";
import { planVoice } from "../../domain/timeline/clipMath";
import { ClipVoice } from "./ClipVoice";
import { clipSignature } from "./clipSignature";
import type { SyncDoc } from "./syncPlan";
import { createTickTimer, type TickTimer } from "./tickTimer";
import type { TransportClock, TransportSink } from "./Transport";

/** 앞으로 몇 초 안에 시작할 클립을 미리 예약하는가. 타이머가 늦어져도 이 시간 안에서는 소리가 끊기지 않는다. */
export const LOOKAHEAD_SECONDS = 2;
/** 예약기를 깨우는 간격(ms) */
export const TICK_MS = 25;

export interface SchedulerOptions {
  transport: TransportClock;
  context(): BaseAudioContext | undefined;
  /** 소리 경로가 마지막으로 맞춰진 문서 */
  doc(): SyncDoc | undefined;
  buffer(assetId: string): AudioBuffer | undefined;
  /** 트랙의 입력 노드. 없으면 그 트랙의 클립은 건너뛴다. */
  output(trackId: string): AudioNode | undefined;
  createTimer?: () => TickTimer;
  lookahead?: number;
}

interface ActiveVoice {
  voice: ClipVoice;
  /** 소리에 영향을 주는 값만 모은 표시. 이름·그룹처럼 소리와 무관한 값이 바뀌어도 같다. */
  signature: string;
  trackId: string;
  clip: Clip;
}

/**
 * 25ms마다 깨어나 "앞으로 2초 안에 시작할 클립"을 재생 단위(ClipVoice)로 만들어 예약한다.
 * 클립은 창에 들어오는 순간 끝까지 한 번에 예약하므로, 타이머가 늦어져도 이미 예약된 소리는 끊기지 않는다.
 * 재생 시계(Transport)가 재생 중일 때만 타이머가 돈다.
 */
export class Scheduler implements TransportSink {
  private readonly voices = new Map<string, ActiveVoice>();
  private readonly options: SchedulerOptions;
  private readonly lookahead: number;
  private timer?: TickTimer;
  private offState?: () => void;

  constructor(options: SchedulerOptions) {
    this.options = options;
    this.lookahead = options.lookahead ?? LOOKAHEAD_SECONDS;
    this.offState = options.transport.on("state", () => {
      if (options.transport.state === "playing") this.startTimer();
      else this.stopTimer();
    });
  }

  /** 지금 시계 기준으로, 창 안에 들어온 클립을 예약한다. 이미 예약된 클립은 다시 만들지 않는다. */
  tick(): void {
    const { transport } = this.options;
    const context = this.options.context();
    const doc = this.options.doc();
    if (!context || !doc || transport.state !== "playing") return;
    // 지금 시각이 아니라 "안전한 시각"의 위치에서 계획한다: 중간에서 시작하는 소리도 시작 페이드가 지난 일이 되지 않는다.
    const position = transport.schedulePosition();
    const horizon = position + this.lookahead;
    for (const track of doc.tracks) {
      const out = this.options.output(track.id);
      if (!out) continue;
      for (const clip of track.clips) {
        if (clip.isRecording || clip.muted || this.voices.has(clip.id) || clip.startTime >= horizon) continue;
        const buffer = this.options.buffer(clip.audioBufferId);
        if (!buffer) continue;
        const plan = planVoice(clip, doc.bpm, position, buffer.duration, transport.contextTimeAt);
        if (!plan) continue;
        const voice = new ClipVoice(context, clip, buffer, out, plan, (ended) => this.forget(clip.id, ended));
        this.voices.set(clip.id, { voice, signature: clipSignature(track.id, clip, doc.bpm), trackId: track.id, clip });
      }
    }
    transport.checkEnd();
  }

  /** 시계가 시킨 일: 모든 소리를 부드럽게 내린다. */
  silence(): void {
    this.releaseAll();
  }

  /** 시계가 시킨 일: 지금 시계 기준으로 다시 예약한다. */
  reschedule(): void {
    this.tick();
  }

  releaseAll(): void {
    const at = this.options.transport.safeTime();
    for (const entry of this.voices.values()) entry.voice.stop(at);
    this.voices.clear();
  }

  releaseTrack(trackId: string): void {
    const at = this.options.transport.safeTime();
    for (const [clipId, entry] of this.voices) {
      if (entry.trackId !== trackId) continue;
      entry.voice.stop(at);
      this.voices.delete(clipId);
    }
  }

  /**
   * 문서가 바뀐 뒤, 다시 맞춘 트랙들의 재생 단위 중 소리가 달라졌거나 더 이상 나면 안 되는 것만 내린다.
   * 내린 자리는 이어지는 `tick()`이 새 값으로 채운다. 템포가 바뀌면 소리에 영향을 주는 값(WARP 배율)만 다시 비교한다.
   */
  reconcile(trackIds: ReadonlySet<string>, tempoChanged: boolean): void {
    const doc = this.options.doc();
    if (!doc || this.voices.size === 0 || trackIds.size === 0) return;
    const at = this.options.transport.safeTime();
    const wanted = new Map<string, { clip: Clip; trackId: string }>();
    for (const track of doc.tracks) {
      if (!trackIds.has(track.id)) continue;
      for (const clip of track.clips) wanted.set(clip.id, { clip, trackId: track.id });
    }
    for (const [clipId, entry] of this.voices) {
      const target = wanted.get(clipId);
      if (!trackIds.has(entry.trackId) && !target) continue;
      const keep =
        target !== undefined &&
        target.trackId === entry.trackId &&
        ((target.clip === entry.clip && !tempoChanged) ||
          (!target.clip.muted && !target.clip.isRecording && clipSignature(target.trackId, target.clip, doc.bpm) === entry.signature));
      if (keep) {
        entry.clip = target.clip;
        continue;
      }
      entry.voice.stop(at);
      this.voices.delete(clipId);
    }
  }

  /** 지금 살아 있는(예약됐거나 재생 중인) 재생 단위 수 */
  voiceCount(): number {
    return this.voices.size;
  }

  dispose(): void {
    this.releaseAll();
    this.offState?.();
    this.offState = undefined;
    this.timer?.dispose();
    this.timer = undefined;
  }

  private forget(clipId: string, voice: ClipVoice): void {
    if (this.voices.get(clipId)?.voice === voice) this.voices.delete(clipId);
  }

  private startTimer(): void {
    this.timer ??= (this.options.createTimer ?? createTickTimer)();
    this.timer.start(TICK_MS, () => this.tick());
  }

  private stopTimer(): void {
    this.timer?.stop();
  }
}
