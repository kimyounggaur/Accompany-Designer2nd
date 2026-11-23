/**
 * 마이크 녹음기. 마이크 → (모니터) / 녹음 워크렛 → 소리 없는 끝(워크렛이 계속 처리되도록 이어 둠).
 * 옛 `audio/recorder.ts`의 ScriptProcessorNode(폐기 예정)를 AudioWorklet으로 바꾼 것이다.
 *
 * 순서: `open()`(마이크 허락·워크렛 올리기·연결) → `begin(시작 프레임)`(그 프레임부터 담기) → `finish()`(WAV로 마무리) 또는 `cancel()`.
 * 마이크는 카운트인 동안에도 열려 있지만 담지 않는다: 시작 프레임이 되면 워크렛이 그 샘플부터 담는다(샘플 단위로 정확).
 */
import { encodeWav } from "../../utils/wavEncoder";
import type { RecorderChunk } from "../worklets/recorderCore";

export interface RecorderOpenOptions {
  inputDeviceId?: string;
  monitoringEnabled?: boolean;
  /** 입력 모니터 소리를 보낼 곳(모니터 길의 입력). 없으면 스피커로 바로 보낸다. */
  monitorOutput?: AudioNode;
}

export interface RecorderOpenResult {
  /** 마이크 입력 지연(초). 브라우저가 알려 주지 않으면 0 */
  inputLatency: number;
}

export interface RecorderResult {
  /** 모노 16비트 WAV */
  blob: Blob;
  /** 녹음 길이(초) = 프레임 수 ÷ 샘플레이트 */
  duration: number;
  sampleRate: number;
  /** 녹음된 첫 샘플의 오디오 시계 위치(프레임). 담긴 것이 없으면 -1 */
  firstFrame: number;
  /** 담은 프레임 수 */
  frames: number;
}

/** 녹음 컨트롤러가 기대하는 녹음기의 모양. 시험에서는 가짜를 끼운다. */
export interface RecorderPort {
  /** 조각이 도착할 때마다 불린다(화면 스레드). */
  onChunk: ((chunk: RecorderChunk) => void) | undefined;
  open(context: AudioContext, options: RecorderOpenOptions): Promise<RecorderOpenResult>;
  /** 이 프레임(오디오 시계)부터 담기 시작한다. */
  begin(startFrame: number): void;
  finish(): Promise<RecorderResult>;
  /** 담은 것을 버리고 마이크를 닫는다. */
  cancel(): void;
}

/** 워크렛이 "멈췄다"고 알려 오기를 기다리는 최대 시간(ms). 이 안에 오지 않으면 지금까지 받은 것으로 마무리한다. */
const STOP_TIMEOUT_MS = 2000;

/** 오디오 컨텍스트마다 녹음 워크렛 모듈을 한 번만 올린다. */
const loadedContexts = new WeakSet<BaseAudioContext>();

async function loadRecorderModule(context: BaseAudioContext): Promise<void> {
  if (loadedContexts.has(context)) return;
  // 정적으로 가져오면 Node 단위 시험에서 이 파일을 읽을 수 없으므로 필요할 때만 불러온다(MasterBus의 리미터와 같은 방법).
  const { default: moduleUrl } = await import("../worklets/recorder.worklet.ts?worker&url");
  await context.audioWorklet.addModule(moduleUrl);
  loadedContexts.add(context);
}

type WorkletMessage =
  | ({ type: "chunk" } & RecorderChunk)
  | { type: "stopped"; firstFrame: number; frames: number };

export class MicRecorder implements RecorderPort {
  onChunk: ((chunk: RecorderChunk) => void) | undefined;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private sink?: GainNode;
  private monitorGain?: GainNode;
  private chunks: Float32Array[] = [];
  private sampleRate = 44100;
  private stopped?: (info: { firstFrame: number; frames: number }) => void;
  private opened = false;
  private firstFrame = -1;
  private frames = 0;

  async open(context: AudioContext, options: RecorderOpenOptions = {}): Promise<RecorderOpenResult> {
    if (this.opened) throw new Error("이미 녹음 중입니다.");
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저는 마이크 녹음을 지원하지 않습니다.");
    }
    if (!context.audioWorklet) {
      throw new Error("이 브라우저는 녹음에 필요한 오디오 처리 장치(AudioWorklet)를 지원하지 않습니다.");
    }
    this.opened = true;
    const constraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (options.inputDeviceId) constraints.deviceId = { exact: options.inputDeviceId };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
      await loadRecorderModule(context);
      this.sampleRate = context.sampleRate;
      this.source = context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(context, "recorder", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.node.port.onmessage = (event: MessageEvent<WorkletMessage>) => this.handleMessage(event.data);
      // 출력이 어디에도 이어지지 않으면 브라우저가 처리를 건너뛸 수 있다. 소리 없는 게인(0)을 거쳐 스피커 끝에 이어 둔다.
      this.sink = context.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.node);
      this.node.connect(this.sink);
      this.sink.connect(context.destination);

      if (options.monitoringEnabled) {
        // 입력 모니터. 모니터 길은 자체 볼륨(기본 0.85)을 가지므로, 길로 보낼 때는 이득 1(그 볼륨만 적용)로 둔다.
        this.monitorGain = context.createGain();
        this.monitorGain.gain.value = options.monitorOutput ? 1 : 0.85;
        this.source.connect(this.monitorGain);
        this.monitorGain.connect(options.monitorOutput ?? context.destination);
      }
      // `latency`는 표준 목록에는 아직 없지만 브라우저가 알려 준다(초 단위).
      const settings = this.stream.getAudioTracks()[0]?.getSettings?.() as (MediaTrackSettings & { latency?: number }) | undefined;
      const latency = settings?.latency;
      return { inputLatency: typeof latency === "number" && Number.isFinite(latency) && latency > 0 ? latency : 0 };
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  begin(startFrame: number): void {
    this.node?.port.postMessage({ type: "start", startFrame });
  }

  async finish(): Promise<RecorderResult> {
    const node = this.node;
    if (!node) throw new Error("진행 중인 녹음이 없습니다.");
    // 워크렛에 멈추라고 하고, 남은 조각과 "멈췄다" 알림이 도착하기를 기다린다.
    const info = await new Promise<{ firstFrame: number; frames: number }>((resolve) => {
      const timer = setTimeout(() => resolve({ firstFrame: this.firstFrame, frames: this.frames }), STOP_TIMEOUT_MS);
      this.stopped = (received) => {
        clearTimeout(timer);
        resolve(received);
      };
      node.port.postMessage({ type: "stop" });
    });
    const sampleRate = this.sampleRate;
    const blob = encodeWav(this.chunks, sampleRate, 1);
    this.cleanup();
    return { blob, duration: info.frames / sampleRate, sampleRate, firstFrame: info.firstFrame, frames: info.frames };
  }

  cancel(): void {
    this.cleanup();
  }

  private handleMessage(message: WorkletMessage): void {
    if (message.type === "chunk") {
      if (this.firstFrame < 0) this.firstFrame = message.firstFrame;
      this.frames += message.samples.length;
      this.chunks.push(message.samples);
      this.onChunk?.({ samples: message.samples, peaks: message.peaks, firstFrame: message.firstFrame });
    } else if (message.type === "stopped") {
      this.stopped?.({ firstFrame: message.firstFrame, frames: message.frames });
    }
  }

  private cleanup(): void {
    if (this.node) this.node.port.onmessage = null;
    this.monitorGain?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.monitorGain = undefined;
    this.node = undefined;
    this.sink = undefined;
    this.source = undefined;
    this.stream = undefined;
    this.stopped = undefined;
    this.opened = false;
    this.chunks = [];
    this.firstFrame = -1;
    this.frames = 0;
  }
}
