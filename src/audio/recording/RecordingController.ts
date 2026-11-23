/**
 * 녹음 흐름을 하나로 모은 곳(예전에는 App.tsx 안에 흩어져 있던 약 280줄).
 *
 *   idle → preparing → counting-in → recording → stopping → idle
 *
 * - preparing: 마이크 허락과 녹음 워크렛 준비. 허락이 거부되면 idle로 돌아가고 오류를 알린다.
 * - counting-in: 타이머가 아니라 오디오 시계로 예약한다. `t0 = 지금 + 0.1초`부터 박마다 클릭을 예약하고,
 *   반주 재생과 녹음 시작을 정확히 `t0 + 박 수 × 박 길이`에 맞춘다(녹음기는 그 프레임부터 담으므로 샘플 단위로 맞는다).
 * - recording: 녹음 중 파형은 문서에 쓰지 않는다. 화면용 임시 파형만 `host.update`로 초당 20회 이하로 쌓는다.
 * - stopping: 녹음을 WAV로 마무리하고 음원·클립을 문서에 한 번에 넣는다(실행 취소 1단계 "녹음 추가").
 *
 * 이 파일은 `audio/` 층이라 스토어·문서·안내 문구를 모른다. 그런 것은 `host`로 주입받고, 연결은 `app/recording.ts`가 한다.
 */
import type { AudioAsset } from "../../types";
import { clamp } from "../../utils/audioMath";
import { Metronome, planCountIn, type Click, type CountInPlan } from "../Metronome";
import type { TickTimer } from "../engine/tickTimer";
import type { RecorderChunk } from "../worklets/recorderCore";
import { placeRecording, type LatencyInputs } from "../../domain/recording/latency";
import type { RecorderPort, RecorderResult } from "./Recorder";

export type RecordingPhase = "idle" | "preparing" | "counting-in" | "recording" | "stopping";

/** 화면이 보는 녹음 값의 일부(바뀐 것만 넘긴다). */
export interface RecordingProgress {
  status?: Exclude<RecordingPhase, "idle">;
  trackId?: string;
  startedAtProjectTime?: number;
  elapsed?: number;
  countInRemaining?: number;
  waveformPeaks?: number[];
}

export interface RecordingSettings {
  armedTrackId?: string;
  inputDeviceId?: string;
  monitoringEnabled: boolean;
  metronomeEnabled: boolean;
  countInBeats: number;
  /** 사용자 지연 보정(ms) */
  latencyOffsetMs: number;
}

/** 안내를 띄울 일. 문구는 `app/recording.ts`가 정한다. */
export type RecordingEvent =
  | { type: "countIn"; remaining: number }
  | { type: "countInCancelled" }
  | { type: "started"; fileName: string }
  | { type: "saving"; fileName: string }
  | { type: "saved"; fileName: string }
  | { type: "empty" };

/** 녹음이 끝났을 때 문서에 넣을 것 */
export interface RecordingCommit {
  trackId: string;
  /** 디코드한 음원 정보(이름·길이·파형 …) */
  asset: AudioAsset;
  clipId: string;
  /** 클립이 놓일 곳(초) */
  startTime: number;
  /** 곡의 시작보다 앞으로 밀려난 만큼 녹음 앞쪽에서 잘라 낸 길이(초) */
  trim: number;
  bpm: number;
}

/** 컨트롤러가 소리 엔진에서 쓰는 것 */
export interface RecordingEngine {
  ensureContext(): Promise<AudioContext>;
  /** 곡 재생. `atContextTime`이 있으면 그 오디오 시각에 정확히 시작한다(카운트인 뒤). */
  play(from: number, options?: { atContextTime?: number }): Promise<void>;
  /** 재생을 멈춘다(위치는 `getCurrentPlayhead`로 먼저 읽어 둔다). */
  stop(): void;
  isPlaying(): boolean;
  getCurrentPlayhead(): number;
  /** 오디오 시각에 곡 시계가 가리키는 위치(초) */
  positionAt(contextTime: number): number;
  /** 스피커까지의 지연(초, 마스터 길의 지연 포함) */
  getOutputLatency(): number;
  getBaseLatency(): number;
  getMonitorInput(): AudioNode | undefined;
  /** 녹음 WAV를 디코드해 엔진에 등록하고 음원 정보를 돌려준다. */
  decode(blob: Blob, fileName: string, assetId: string): Promise<AudioAsset>;
}

/** 컨트롤러가 스토어·문서·안내에 하는 일 */
export interface RecordingHost {
  settings(): RecordingSettings;
  bpm(): number;
  /** 재생·녹음을 시작할 자리(편집 커서) */
  playhead(): number;
  update(patch: RecordingProgress): void;
  /** 녹음 값을 처음(대기 또는 idle)으로 되돌린다. */
  reset(): void;
  setPlaying(playing: boolean): void;
  setPlayhead(position: number): void;
  /** 녹음할 트랙을 정한다: 녹음 대기 트랙 → 비어 있는 첫 트랙 → 새 트랙(이력에 남기지 않고 만든다). */
  chooseTrack(): { trackId: string; created: boolean };
  /** 이 컨트롤러가 만든 새 트랙이 아직 비어 있으면 거둔다. */
  discardTrack(trackId: string): void;
  nextFileName(): string;
  newId(prefix: "asset" | "clip"): string;
  /** 녹음을 문서에 한 번에 넣는다(실행 취소 1단계). */
  commit(recording: RecordingCommit): void;
  /** 저장·복구가 쓸 수 있게 녹음 원본을 기억해 둔다. */
  remember(assetId: string, blob: Blob): void;
  event(event: RecordingEvent): void;
  fail(error: unknown, stage: "start" | "save"): void;
}

export interface RecordingDeps {
  engine: RecordingEngine;
  host: RecordingHost;
  createRecorder: () => RecorderPort;
  createTimer: () => TickTimer;
  /** 클릭 소리를 내는 함수를 만든다(Web Audio). */
  createClickPlayer: (context: AudioContext) => (click: Click) => { cancel(): void };
  /** 시험에서 화면 갱신 간격을 손으로 돌릴 때(ms) */
  nowMs?: () => number;
}

/** 화면에 쌓는 임시 파형·경과 시간은 초당 20회 이하로 갱신한다. */
export const UI_UPDATE_MIN_INTERVAL_MS = 50;
/** 틱 간격(ms): 메트로놈 예약과 카운트인 표시를 깨운다. */
export const RECORDING_TICK_MS = 25;
/** 녹음 조각의 최대값 몇 개를 하나로 묶어 화면 파형 한 칸으로 쓸지. 오래 녹음해도 화면에 쌓이는 양이 커지지 않게 한다. */
export const PEAKS_PER_DISPLAY_BAR = 4;

interface Session {
  context: AudioContext;
  recorder?: RecorderPort;
  timer?: TickTimer;
  metronome?: Metronome;
  clickHandles: Array<{ cancel(): void }>;
  plan?: CountInPlan;
  from: number;
  startedPlayback: boolean;
  trackId?: string;
  createdTrack: boolean;
  fileName: string;
  assetId: string;
  clipId: string;
  bpm: number;
  latencyOffsetMs: number;
  inputLatency: number;
  /** 첫 조각이 도착했을 때 곡 시계가 가리키던 위치(그 조각의 첫 샘플 시각 기준) */
  positionAtFirst?: number;
  /** 녹음이 시작하기로 한 시각에 곡 시계가 가리키는 위치(첫 조각이 오기 전의 잠정값) */
  positionAtStart?: number;
  frames: number;
  /** 화면에 그릴 파형(조각 4개의 최대값마다 하나) */
  peaks: number[];
  pendingPeak: number;
  pendingPeakCount: number;
  lastUiUpdate: number;
  lastCountIn: number;
  cancelled: boolean;
}

export class RecordingController {
  private readonly deps: RecordingDeps;
  private current: RecordingPhase = "idle";
  private session?: Session;

  constructor(deps: RecordingDeps) {
    this.deps = deps;
  }

  get phase(): RecordingPhase {
    return this.current;
  }

  /** 녹음 버튼: 쉬는 중이면 시작하고, 진행 중이면 멈춘다(준비·카운트인 중에는 취소). */
  async toggle(): Promise<void> {
    if (this.current === "idle") await this.start();
    else await this.stop();
  }

  async start(): Promise<void> {
    if (this.current !== "idle") return;
    const { engine, host } = this.deps;
    this.current = "preparing";
    host.update({ status: "preparing", countInRemaining: 0, elapsed: 0, waveformPeaks: [] });
    const settings = host.settings();
    const session: Session = {
      context: undefined as unknown as AudioContext,
      clickHandles: [],
      from: 0,
      startedPlayback: false,
      createdTrack: false,
      fileName: host.nextFileName(),
      assetId: host.newId("asset"),
      clipId: host.newId("clip"),
      bpm: host.bpm(),
      latencyOffsetMs: settings.latencyOffsetMs,
      inputLatency: 0,
      frames: 0,
      peaks: [],
      pendingPeak: 0,
      pendingPeakCount: 0,
      lastUiUpdate: Number.NEGATIVE_INFINITY,
      lastCountIn: 0,
      cancelled: false,
    };
    this.session = session;
    try {
      session.context = await engine.ensureContext();
      if (session.cancelled) return;

      const recorder = this.deps.createRecorder();
      session.recorder = recorder;
      recorder.onChunk = (chunk) => this.handleChunk(session, chunk);
      const opened = await recorder.open(session.context, {
        inputDeviceId: settings.inputDeviceId,
        monitoringEnabled: settings.monitoringEnabled,
        monitorOutput: engine.getMonitorInput(),
      });
      if (session.cancelled) {
        recorder.cancel();
        return;
      }
      session.inputLatency = opened.inputLatency;

      // 이미 재생 중이면 카운트인 없이 지금 흐르는 곡에 맞춰 바로 녹음한다(재생을 다시 시작하지 않는다).
      const playing = engine.isPlaying();
      const context = session.context;
      const plan = planCountIn({ now: context.currentTime, beats: playing ? 0 : settings.countInBeats, bpm: session.bpm });
      session.plan = plan;
      session.from = playing ? engine.getCurrentPlayhead() : host.playhead();

      // 소리 쪽 예약은 먼저 끝낸다(모두 오디오 시계에 건다): 카운트인 클릭 → 녹음 시작 프레임 → 반주 재생 → 메트로놈.
      const click = this.deps.createClickPlayer(context);
      for (const entry of plan.clicks) session.clickHandles.push(click(entry));
      recorder.begin(Math.round(plan.startTime * context.sampleRate));
      if (!playing) {
        // 기다리는 사이 취소해도 멈출 수 있도록 먼저 표시해 둔다.
        session.startedPlayback = true;
        await engine.play(session.from, { atContextTime: plan.startTime });
        if (session.cancelled) {
          engine.stop();
          return;
        }
      }
      if (settings.metronomeEnabled) {
        session.metronome = new Metronome({
          now: () => context.currentTime,
          click,
          bpm: session.bpm,
          anchorTime: plan.startTime,
          anchorBeat: 0,
          firstBeat: 0,
        });
      }
      const timer = this.deps.createTimer();
      session.timer = timer;
      timer.start(RECORDING_TICK_MS, () => this.tick(session));

      if (plan.clicks.length > 0) {
        this.current = "counting-in";
        session.lastCountIn = 0;
        host.update({ status: "counting-in", countInRemaining: plan.clicks.length });
      } else {
        this.enterRecording(session);
      }
    } catch (error) {
      if (session.cancelled) return;
      this.abort(session);
      host.fail(error, "start");
    }
  }

  /** 정지 버튼 또는 녹음 버튼. 녹음 중이면 마무리해 저장하고, 준비·카운트인 중이면 취소한다. */
  async stop(): Promise<void> {
    switch (this.current) {
      case "idle":
      case "stopping":
        return;
      case "preparing":
        this.cancel({ silent: true });
        return;
      case "counting-in":
        this.cancel();
        return;
      case "recording":
        await this.finalize();
    }
  }

  /** 하던 일을 버리고 처음으로 돌아간다(저장하지 않는다). */
  cancel(options: { silent?: boolean } = {}): void {
    const session = this.session;
    if (!session) return;
    const wasCountingIn = this.current === "counting-in";
    session.cancelled = true;
    this.teardown(session);
    const { engine, host } = this.deps;
    if (session.startedPlayback) {
      engine.stop();
      host.setPlaying(false);
      host.setPlayhead(session.from);
    }
    if (session.createdTrack && session.trackId) host.discardTrack(session.trackId);
    this.session = undefined;
    this.current = "idle";
    host.reset();
    if (wasCountingIn && !options.silent) host.event({ type: "countInCancelled" });
  }

  dispose(): void {
    this.cancel({ silent: true });
  }

  // ───────────────────────── 내부 ─────────────────────────

  private latencyOf(session: Session): LatencyInputs {
    const { engine } = this.deps;
    return {
      outputLatency: engine.getOutputLatency(),
      baseLatency: engine.getBaseLatency(),
      inputLatency: session.inputLatency,
      userOffsetMs: session.latencyOffsetMs,
    };
  }

  /** 틱: 메트로놈 예약, 카운트인 표시, 카운트인이 끝나면 녹음 단계로. */
  private tick(session: Session): void {
    if (session !== this.session || session.cancelled) return;
    session.metronome?.tick();
    const plan = session.plan;
    if (this.current !== "counting-in" || !plan) return;
    const now = session.context.currentTime;
    const total = plan.clicks.length;
    const fired = clamp(Math.floor((now - plan.t0) / plan.beatSeconds) + 1, 0, total);
    if (fired > session.lastCountIn) {
      session.lastCountIn = fired;
      const remaining = total - fired + 1;
      this.deps.host.update({ countInRemaining: remaining });
      this.deps.host.event({ type: "countIn", remaining });
    }
    if (now >= plan.startTime) this.enterRecording(session);
  }

  private enterRecording(session: Session): void {
    const { engine, host } = this.deps;
    const plan = session.plan;
    if (!plan) return;
    const target = host.chooseTrack();
    session.trackId = target.trackId;
    session.createdTrack = target.created;
    this.current = "recording";
    // 반주는 카운트인이 끝나는 이 시각에 흐르기 시작한다. 화면의 재생 상태도 이제 켠다.
    if (session.startedPlayback) host.setPlaying(true);
    session.positionAtStart = engine.positionAt(plan.startTime);
    const startedAt = placeRecording(session.positionAtFirst ?? session.positionAtStart, this.latencyOf(session)).startTime;
    host.update({
      status: "recording",
      trackId: target.trackId,
      startedAtProjectTime: startedAt,
      countInRemaining: 0,
      elapsed: 0,
      waveformPeaks: [],
    });
    host.event({ type: "started", fileName: session.fileName });
  }

  private handleChunk(session: Session, chunk: RecorderChunk): void {
    if (session !== this.session || session.cancelled) return;
    const { engine, host } = this.deps;
    const sampleRate = session.context.sampleRate;
    if (session.positionAtFirst === undefined) {
      // 첫 샘플의 오디오 시각에 곡 시계가 가리키던 자리. 지연만큼 앞당긴 값이 클립의 시작 위치다.
      session.positionAtFirst = engine.positionAt(chunk.firstFrame / sampleRate);
      host.update({ startedAtProjectTime: placeRecording(session.positionAtFirst, this.latencyOf(session)).startTime });
    }
    session.frames += chunk.samples.length;
    for (const peak of chunk.peaks) {
      session.pendingPeak = Math.max(session.pendingPeak, peak);
      session.pendingPeakCount += 1;
      if (session.pendingPeakCount >= PEAKS_PER_DISPLAY_BAR) {
        session.peaks.push(session.pendingPeak);
        session.pendingPeak = 0;
        session.pendingPeakCount = 0;
      }
    }
    const now = (this.deps.nowMs ?? (() => performance.now()))();
    if (now - session.lastUiUpdate >= UI_UPDATE_MIN_INTERVAL_MS) {
      session.lastUiUpdate = now;
      host.update({ elapsed: session.frames / sampleRate, waveformPeaks: session.peaks.slice() });
    }
  }

  /** 녹음을 마무리해 저장한다. */
  private async finalize(): Promise<void> {
    const session = this.session;
    if (!session || !session.recorder) return;
    const { engine, host } = this.deps;
    this.current = "stopping";
    host.update({ status: "stopping" });
    host.event({ type: "saving", fileName: session.fileName });
    session.metronome?.stop();
    session.timer?.stop();

    // 재생은 멈추고 멈춘 그 자리에 둔다.
    if (session.startedPlayback || engine.isPlaying()) {
      const stoppedAt = engine.getCurrentPlayhead();
      engine.stop();
      host.setPlaying(false);
      host.setPlayhead(stoppedAt);
    }

    try {
      const result = await session.recorder.finish();
      // 기다리는 사이 취소됐다면(프로젝트를 열었다 등) 저장하지 않는다.
      if (session.cancelled) return;
      if (result.frames <= 0) {
        this.finish(session, true);
        host.event({ type: "empty" });
        return;
      }
      await this.save(session, result);
      if (session.cancelled) return;
      this.finish(session, false);
      host.event({ type: "saved", fileName: session.fileName });
    } catch (error) {
      if (session.cancelled) return;
      this.finish(session, true);
      host.fail(error, "save");
    }
  }

  private async save(session: Session, result: RecorderResult): Promise<void> {
    const { engine, host } = this.deps;
    const trackId = session.trackId;
    if (!trackId) throw new Error("녹음할 트랙이 없습니다.");
    const positionAtFirst = session.positionAtFirst ?? session.positionAtStart ?? 0;
    const placement = placeRecording(positionAtFirst, this.latencyOf(session));
    const asset = await engine.decode(result.blob, session.fileName, session.assetId);
    // 디코드하는 사이 취소됐다면 문서에 넣지 않는다.
    if (session.cancelled) return;
    host.remember(asset.id, result.blob);
    host.commit({
      trackId,
      asset,
      clipId: session.clipId,
      startTime: placement.startTime,
      trim: Math.min(placement.trim, Math.max(0, asset.duration - 0.01)),
      bpm: session.bpm,
    });
  }

  /** 끝낸 뒤 정리. `discard`면 만든 빈 트랙을 거둔다. */
  private finish(session: Session, discard: boolean): void {
    const { host } = this.deps;
    this.teardown(session);
    if (discard && session.createdTrack && session.trackId) host.discardTrack(session.trackId);
    this.session = undefined;
    this.current = "idle";
    host.reset();
  }

  /** 시작하다 실패했을 때: 한 일을 모두 되돌린다. */
  private abort(session: Session): void {
    session.cancelled = true;
    this.teardown(session);
    const { engine, host } = this.deps;
    if (session.startedPlayback) {
      engine.stop();
      host.setPlaying(false);
      host.setPlayhead(session.from);
    }
    if (session.createdTrack && session.trackId) host.discardTrack(session.trackId);
    this.session = undefined;
    this.current = "idle";
    host.reset();
  }

  private teardown(session: Session): void {
    session.metronome?.stop();
    session.metronome = undefined;
    const now = session.context?.currentTime ?? 0;
    // 카운트인 클릭 중 아직 울리지 않은 것은 거둔다(취소했는데 소리가 나지 않게).
    const plan = session.plan;
    if (plan) {
      plan.clicks.forEach((entry, index) => {
        if (entry.time > now) session.clickHandles[index]?.cancel();
      });
    }
    session.clickHandles = [];
    session.timer?.stop();
    session.timer?.dispose();
    session.timer = undefined;
    // 마이크를 닫는다. 마무리를 마친 뒤에는 이미 닫혀 있으므로 `cancel()`은 아무 일도 하지 않는다(여러 번 불러도 된다).
    session.recorder?.cancel();
    if (session.recorder) session.recorder.onChunk = undefined;
  }
}
