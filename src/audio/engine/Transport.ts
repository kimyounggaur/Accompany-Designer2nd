export type TransportState = "stopped" | "playing" | "paused";

/** 재생 시계. 지금 곡의 몇 초를 재생하는지 알려 주는 단 하나의 기준이다. */
export interface Transport {
  readonly state: TransportState;
  /** 끝에 있으면 0부터 (C4). atContextTime을 주면 그 오디오 시각에 정확히 시작 (카운트인용) */
  play(from?: number, options?: { atContextTime?: number }): Promise<void>;
  pause(): void;
  stop(): void; // 처음으로
  seek(position: number): void; // 재생 중이면 클릭 없이 다시 예약
  position(): number; // 지금 예약·처리 중인 타임라인 위치(초)
  visualPosition(): number; // 출력 지연을 뺀, 지금 들리는 위치(화면용)
  contextTimeAt(position: number): number;
  positionAt(contextTime: number): number;
  on(event: "state" | "ended", listener: () => void): () => void;
}

/** 재생 중 이동할 때, 이전 소리가 내려갈 시간을 주기 위해 새 위치의 시작을 늦추는 간격(초) */
export const SEEK_GAP_SECONDS = 0.01;

/** 시계가 바깥(오디오 컨텍스트·문서)에서 알아야 하는 것 */
export interface TransportEnv {
  /** 지금 오디오 시각(context.currentTime) */
  now(): number;
  /**
   * 소리를 새로 시작하거나 내리기 시작할 때 지금보다 얼마나 뒤로 잡을지(초).
   * 화면 스레드가 읽는 오디오 시각은 실제로 소리를 처리하는 시각보다 조금 늦다. 지금 시각에 일을 걸면 소리 쪽에서는 이미 지난 일이 되어,
   * 페이드가 건너뛰어지고 값이 갑자기 바뀌어 클릭이 난다(재생 중 시크·클립 이동에서 실측).
   */
  lead(): number;
  /** 소리가 스피커까지 가는 데 걸리는 시간(초) */
  outputLatency(): number;
  /** 오디오 컨텍스트를 시작한다(사용자 동작 안에서 부른다). */
  ensureRunning(): Promise<void>;
  /** 곡 끝(초) */
  end(): number;
  /** true면 끝에 닿아도 멈추지 않는다(녹음 중) */
  holdOpen(): boolean;
}

/** 시계가 소리 쪽(예약기)에 시키는 일 */
export interface TransportSink {
  /** 재생 중인 소리를 모두 부드럽게 내린다. */
  silence(): void;
  /** 지금 시계 기준으로 소리를 (다시) 예약한다. */
  reschedule(): void;
}

type Listener = () => void;

/**
 * `Transport` 구현. 오디오 시계(context.currentTime)에 기준점(위치·시각 한 쌍)을 걸어 두고
 * 위치 = 기준 위치 + (지금 − 기준 시각)으로 계산한다. 화면 갱신과 무관하게 정확하다.
 */
export class TransportClock implements Transport {
  private current: TransportState = "stopped";
  /** 재생 중이 아닐 때의 위치 */
  private held = 0;
  private anchorPosition = 0;
  private anchorTime = 0;
  private sink?: TransportSink;
  private readonly env: TransportEnv;
  private readonly listeners: Record<"state" | "ended", Set<Listener>> = { state: new Set(), ended: new Set() };

  constructor(env: TransportEnv) {
    this.env = env;
  }

  /** 소리 쪽(예약기)을 연결한다. */
  connect(sink: TransportSink): void {
    this.sink = sink;
  }

  get state(): TransportState {
    return this.current;
  }

  async play(from?: number, options: { atContextTime?: number } = {}): Promise<void> {
    await this.env.ensureRunning();
    if (this.current === "playing" && from === undefined) return;
    let start = from ?? this.held;
    if (!(start >= 0)) start = 0;
    if (start >= this.env.end()) start = 0; // 끝에 있으면 처음부터
    if (this.current === "playing") {
      this.moveTo(start);
      return;
    }
    this.anchorPosition = start;
    this.anchorTime = options.atContextTime ?? this.safeTime();
    this.current = "playing";
    this.emit("state");
    this.sink?.reschedule();
  }

  pause(): void {
    if (this.current !== "playing") return;
    this.held = this.position();
    this.sink?.silence();
    this.current = "paused";
    this.emit("state");
  }

  stop(): void {
    const previous = this.current;
    if (previous === "playing") this.sink?.silence();
    this.held = 0;
    this.current = "stopped";
    if (previous !== "stopped") this.emit("state");
  }

  seek(position: number): void {
    const target = position >= 0 ? position : 0;
    if (this.current !== "playing") {
      this.held = target;
      return;
    }
    this.moveTo(target);
  }

  position(): number {
    if (this.current !== "playing") return this.held;
    return this.anchorPosition + Math.max(0, this.env.now() - this.anchorTime);
  }

  visualPosition(): number {
    if (this.current !== "playing") return this.held;
    return Math.max(this.anchorPosition, this.position() - this.env.outputLatency());
  }

  /** 지금 소리를 새로 시작하거나 내리기 시작해도 안전한 가장 이른 오디오 시각 */
  safeTime(): number {
    return this.env.now() + this.env.lead();
  }

  /**
   * 새 소리를 낼 수 있는 가장 이른 타임라인 위치: 안전한 시각(`safeTime`)에 시계가 가 있을 위치. 시작점보다 앞서지는 않는다.
   * 재생 중이 아니면 멈춘 위치. 예약기는 `position()`이 아니라 이 값을 기준으로 클립을 계획한다.
   */
  schedulePosition(): number {
    if (this.current !== "playing") return this.held;
    return Math.max(this.anchorPosition, this.positionAt(this.safeTime()));
  }

  contextTimeAt = (position: number): number => this.anchorTime + (position - this.anchorPosition);

  positionAt = (contextTime: number): number => this.anchorPosition + (contextTime - this.anchorTime);

  on(event: "state" | "ended", listener: Listener): () => void {
    this.listeners[event].add(listener);
    return () => {
      this.listeners[event].delete(listener);
    };
  }

  /**
   * 예약기가 틱마다 부른다. 곡 끝에 닿았고 녹음 중이 아니면 소리를 내리고 멈춘다(위치는 끝에 둔다: 다시 재생하면 0부터).
   * 멈췄으면 true.
   */
  checkEnd(): boolean {
    if (this.current !== "playing") return false;
    const end = this.env.end();
    if (this.position() < end || this.env.holdOpen()) return false;
    this.held = end;
    this.sink?.silence();
    this.current = "stopped";
    this.emit("state");
    this.emit("ended");
    return true;
  }

  /** 재생 중 위치 이동: 안전한 시각부터 이전 소리를 8ms에 걸쳐 내리고, 그보다 10ms 뒤 새 위치에서 시작한다. */
  private moveTo(target: number): void {
    this.sink?.silence();
    this.anchorPosition = target;
    this.anchorTime = this.safeTime() + SEEK_GAP_SECONDS;
    this.sink?.reschedule();
  }

  private emit(event: "state" | "ended"): void {
    for (const listener of [...this.listeners[event]]) listener();
  }
}
