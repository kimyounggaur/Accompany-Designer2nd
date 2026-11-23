import type { DawProject } from "../../types";
import { getProjectDuration } from "../../utils/audioMath";
import { BrowserAudioEngine } from "../audioEngine";
import { Scheduler } from "./Scheduler";
import { planSync, type SyncDoc } from "./syncPlan";
import type { TickTimer } from "./tickTimer";
import { createTrackGraph, disposeGraph, graphSignature, updateTrackGraph, type TrackGraph } from "./trackGraph";
import { TransportClock } from "./Transport";

/** 소리 경로를 끊기 전에 기다리는 시간(ms): 내려가는 중인 소리와 이펙트 꼬리가 이 안에 끝난다. */
export const RETIRE_MS = 60;

export interface AudioEngineV2Options {
  /** 시험에서 손으로 돌리는 타이머를 끼울 때 */
  createTimer?: () => TickTimer;
  /** 시험에서 끊기를 기다리지 않을 때 */
  retire?: (action: () => void) => void;
  /** 시험에서 "지금"에서 띄울 간격을 정해 둘 때(기본은 baseLatency에서 계산) */
  lead?: () => number;
}

/**
 * 새 엔진(`?engine=v2`). 재생 시계(Transport)·예약기(Scheduler)·클립 재생 단위(ClipVoice)로 재생을 맡는다.
 * 아직 옮기지 않은 부분(마스터 출력, 트랙 소리 경로, 음원 보관, 녹음 연결, 내보내기)은 옛 엔진 것을 그대로 쓴다:
 * 트랙 경로는 P3-3, 마스터는 P3-4, 녹음은 P3-5, 내보내기는 P3-6에서 바뀐다.
 */
/**
 * 새 소리를 시작하거나 내릴 때 "지금"에서 얼마나 뒤로 잡을지(초)의 범위.
 * 화면 스레드가 읽는 currentTime은 소리 스레드가 실제로 처리하는 시각보다 늦고, 명령이 소리 스레드에 닿는 데도 시간이 든다.
 * 지금 시각에 걸면 페이드가 이미 지난 일이 되어 값이 갑자기 바뀐다(클릭).
 */
export const MIN_LEAD_SECONDS = 0.02;
export const MAX_LEAD_SECONDS = 0.06;

/** 오디오 하드웨어 버퍼(baseLatency)의 두 배 + 여유를 범위 안으로 */
export function scheduleLead(baseLatency: number | undefined): number {
  const wanted = (baseLatency && baseLatency > 0 ? baseLatency : 0) * 2 + 0.01;
  return Math.min(MAX_LEAD_SECONDS, Math.max(MIN_LEAD_SECONDS, wanted));
}

export class AudioEngineV2 extends BrowserAudioEngine {
  readonly transport: TransportClock;
  private readonly scheduler: Scheduler;
  private readonly retire: (action: () => void) => void;
  /** 소리 경로가 마지막으로 맞춰진 문서. 다음 sync는 이것과 비교한다. */
  private doc?: SyncDoc;
  /** 재생을 시작하는 동안(await 사이) 들어온 문서 */
  private pendingDoc?: SyncDoc;
  private holdOpenCheck: () => boolean = () => false;

  constructor(options: AudioEngineV2Options = {}) {
    super();
    this.retire = options.retire ?? ((action) => void setTimeout(action, RETIRE_MS));
    this.transport = new TransportClock({
      now: () => this.context?.currentTime ?? 0,
      lead: options.lead ?? (() => scheduleLead(this.context?.baseLatency)),
      outputLatency: () => {
        const context = this.context as (AudioContext & { outputLatency?: number }) | undefined;
        return context?.outputLatency || context?.baseLatency || 0;
      },
      ensureRunning: async () => {
        await this.ensureContext();
      },
      end: () => (this.doc ? getProjectDuration(this.doc) : 0),
      holdOpen: () => this.holdOpenCheck(),
    });
    this.scheduler = new Scheduler({
      transport: this.transport,
      context: () => this.context,
      doc: () => this.doc,
      buffer: (assetId) => this.buffers.get(assetId),
      output: (trackId) => this.trackGraphs.get(trackId)?.input,
      createTimer: options.createTimer,
    });
    this.transport.connect(this.scheduler);
    this.transport.on("state", () => {
      if (this.transport.state !== "playing") this.retireAllGraphs();
    });
  }

  /** 녹음 중처럼 곡 끝에 닿아도 멈추면 안 될 때 true를 돌려주는 함수를 알려 준다. */
  setHoldOpen(check: () => boolean): void {
    this.holdOpenCheck = check;
  }

  override async play(project: DawProject, playhead: number): Promise<void> {
    // 이 호출 뒤에, 시작을 기다리는 사이 들어온 문서만 "나중 문서"로 본다(await 앞에서 비워야 그 문서를 놓치지 않는다).
    this.pendingDoc = undefined;
    await this.ensureContext();
    if (this.transportPlaying()) {
      // 이미 재생 중이면 다시 시작하지 않고 그 자리로 옮긴다(8ms 페이드 아웃 → 10ms 뒤 새 위치에서 시작).
      this.applyDoc(this.takePendingDoc() ?? project);
      await this.transport.play(playhead);
      return;
    }
    this.retireAllGraphs();
    this.doc = undefined;
    this.applyDoc(this.takePendingDoc() ?? project);
    await this.transport.play(playhead);
    // 시작을 기다리는 사이에 문서가 바뀌었다면 그 내용까지 맞춘다.
    const latest = this.takePendingDoc();
    if (latest && this.transportPlaying()) this.applyDoc(latest);
  }

  /** 옛 엔진과 같은 이름: 소리를 멈춘다. 위치는 그대로 두므로 다시 재생하면 화면이 정한 자리에서 시작한다. */
  override stop(): void {
    this.transport.pause();
  }

  pause(): void {
    this.transport.pause();
  }

  seek(position: number): void {
    this.transport.seek(position);
  }

  override getCurrentPlayhead(): number {
    return this.transport.position();
  }

  override isPlaying(): boolean {
    return this.transportPlaying();
  }

  /**
   * 문서에 맞춰 소리 경로와 재생 단위를 고친다. 비교는 참조(===)로만 한다: 바뀌지 않은 트랙과 클립은 건드리지 않는다.
   * 클립이 바뀌면 그 클립의 재생 단위만 8ms에 걸쳐 내리고 새 값으로 다시 예약한다.
   */
  override sync(project: SyncDoc, _previous?: SyncDoc): void {
    if (!this.transportPlaying()) {
      this.pendingDoc = project;
      return;
    }
    this.applyDoc(project);
  }

  dispose(): void {
    this.transport.stop();
    this.scheduler.dispose();
  }

  /** 읽을 때마다 새로 확인한다(await 앞뒤로 상태가 바뀔 수 있다). */
  private transportPlaying(): boolean {
    return this.transport.state === "playing";
  }

  private takePendingDoc(): SyncDoc | undefined {
    const doc = this.pendingDoc;
    this.pendingDoc = undefined;
    return doc;
  }

  private applyDoc(project: SyncDoc): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || project === this.doc) return;
    const plan = planSync(project, this.doc);

    for (const id of plan.removedTrackIds) {
      this.scheduler.releaseTrack(id);
      this.retireGraph(this.trackGraphs.get(id));
      this.trackGraphs.delete(id);
      this.trackAnalysers.delete(id);
    }

    const touched = new Set<string>();
    for (const step of plan.steps) {
      const { track } = step;
      let graph = this.trackGraphs.get(track.id);
      let rebuilt = false;
      // 이펙트 켜기/끄기·순서 같은 연결 모양이 바뀌었을 때만 이 트랙의 소리 경로를 새로 만든다(P3-3에서 이 일이 없어진다).
      if (!graph || (step.trackChanged && graph.signature !== graphSignature(track, project.bpm))) {
        const previous = graph;
        graph = createTrackGraph(context, master, track, project.bpm);
        this.trackGraphs.set(track.id, graph);
        this.trackAnalysers.set(track.id, graph.analyser);
        if (previous) {
          // 옛 경로에 붙은 소리는 내려가는 동안 그 경로를 지나가야 하므로, 경로는 조금 있다가 끊는다.
          this.scheduler.releaseTrack(track.id);
          this.retireGraph(previous);
        }
        rebuilt = true;
      }
      if (step.updateParams || rebuilt) updateTrackGraph(graph, track, plan.solo, context.currentTime, project.bpm);
      if (step.reconcileClips || rebuilt) touched.add(track.id);
    }

    this.doc = project;
    this.scheduler.reconcile(touched, plan.tempoChanged);
    this.scheduler.tick();
  }

  private retireGraph(graph: TrackGraph | undefined): void {
    if (!graph) return;
    this.retire(() => disposeGraph(graph));
  }

  /** 멈출 때: 트랙 소리를 10ms 안에 0으로 내리고, 조금 뒤 소리 경로를 끊는다. */
  private retireAllGraphs(): void {
    const now = this.context?.currentTime ?? 0;
    const graphs = [...this.trackGraphs.values()];
    this.trackGraphs.clear();
    this.trackAnalysers.clear();
    for (const graph of graphs) {
      graph.output.gain.cancelScheduledValues(now);
      graph.output.gain.setTargetAtTime(0, now, 0.004);
      this.retireGraph(graph);
    }
  }
}
