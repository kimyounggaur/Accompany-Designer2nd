import { smooth } from "../effects/EffectNode";
import {
  MASTER_VOLUME_DEFAULT_DB, MASTER_VOLUME_MAX_DB, MASTER_VOLUME_MIN_DB, clampMasterVolumeDb, dbToGain,
} from "../../domain/master/volume";
import { LIMITER_CEILING_DB, LIMITER_LOOKAHEAD_SECONDS } from "../worklets/limiterCore";

// 마스터 볼륨의 범위와 변환은 문서(state)도 쓰므로 domain/master/volume.ts에 있다. 예전 경로로도 가져갈 수 있게 다시 내보낸다.
export {
  MASTER_VOLUME_MIN_DB, MASTER_VOLUME_MAX_DB, MASTER_VOLUME_DEFAULT_DB, clampMasterVolumeDb, dbToGain,
};

/** 리미터가 동작량을 알려 오지 않은 지 이 시간(ms)이 지나면 동작량 표시를 0으로 본다 */
const REDUCTION_STALE_MS = 250;

/** 마스터 끝에 놓는 리미터. 진짜(워크렛) 리미터와 대신 쓰는 압축기 둘이 같은 모양이다. */
export interface LimiterHandle {
  /** 소리가 들어가는 노드 */
  readonly input: AudioNode;
  /** 소리가 나오는 노드(입력과 같을 수 있다) */
  readonly output: AudioNode;
  /** 입력보다 출력이 늦는 시간(초) */
  readonly latencySeconds: number;
  /** 리미터가 이득을 내린 양(dB, 0 이하)을 알려 줄 곳 */
  onReduction(listener: (db: number) => void): void;
  dispose(): void;
}

/** 워크렛 리미터를 올린다. 브라우저가 워크렛을 못 쓰면 던진다. */
export async function loadWorkletLimiter(context: BaseAudioContext): Promise<LimiterHandle> {
  // 정적으로 가져오면 Node 단위 시험에서 이 파일을 읽을 수 없으므로, 필요할 때만 불러온다(audio/probe.ts와 같은 방법).
  const { default: moduleUrl } = await import("../worklets/limiter.worklet.ts?worker&url");
  await context.audioWorklet.addModule(moduleUrl);
  const node = new AudioWorkletNode(context, "limiter", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: "explicit",
    outputChannelCount: [2],
  });
  let listener: ((db: number) => void) | undefined;
  node.port.onmessage = (event: MessageEvent<{ reduction: number }>) => listener?.(event.data.reduction);
  return {
    input: node,
    output: node,
    latencySeconds: LIMITER_LOOKAHEAD_SECONDS,
    onReduction: (next) => {
      listener = next;
    },
    dispose() {
      listener = undefined;
      node.port.onmessage = null;
      node.disconnect();
    },
  };
}

/**
 * 워크렛을 쓸 수 없을 때 대신 쓰는 옛 방식(압축기 + 0.98 상한). 소리가 끊기는 것보다 낫지만 겹친 소리가 과하게 눌린다.
 * 동작량은 알 수 없어 늘 0으로 알린다.
 */
export function createFallbackLimiter(context: BaseAudioContext): LimiterHandle {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = LIMITER_CEILING_DB;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.1;
  const ceiling = context.createWaveShaper();
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i += 1) curve[i] = ((i / (curve.length - 1)) * 2 - 1) * 0.98;
  ceiling.curve = curve;
  ceiling.oversample = "2x";
  compressor.connect(ceiling);
  return {
    input: compressor,
    output: ceiling,
    latencySeconds: 0,
    onReduction() {},
    dispose() {
      compressor.disconnect();
      ceiling.disconnect();
    },
  };
}

export interface MasterBusOptions {
  /** 처음 마스터 볼륨(dB) */
  volumeDb?: number;
  /** 소리가 나가는 곳. 기본은 스피커(`context.destination`) */
  destination?: AudioNode;
  /** 시험에서 워크렛 대신 끼우는 리미터 만들기 */
  createLimiter?: (context: BaseAudioContext) => Promise<LimiterHandle>;
  /** 동작량을 알려 온 시각의 기준(ms). 시험에서 바꿔 끼운다. */
  now?: () => number;
}

/**
 * 마스터 길: 트랙 소리가 들어오는 곳(볼륨) → 리미터(5 ms 선읽기, −1 dBFS) → 마스터 미터(분석기) → 스피커.
 * 같은 클래스를 재생에서도, 내보내기(OfflineAudioContext)에서도 쓴다(P3-6).
 */
export class MasterBus {
  /** 트랙 길이 이어지는 곳. 마스터 볼륨이 이 게인이다. */
  readonly input: GainNode;
  /** 마스터 미터가 읽는 분석기(리미터 뒤, 스피커 앞) */
  readonly analyser: AnalyserNode;
  /** 리미터 때문에 소리가 늦는 시간(초). 재생 위치 표시에 더하고, 내보낼 때는 이만큼 앞을 잘라 낸다. */
  readonly latencySeconds: number;
  /** 워크렛 리미터를 못 올려 옛 압축기로 대신하고 있는가 */
  readonly usesFallback: boolean;
  private readonly limiter: LimiterHandle;
  private readonly now: () => number;
  private reduction = 0;
  private reportedAt = Number.NEGATIVE_INFINITY;

  constructor(context: BaseAudioContext, limiter: LimiterHandle, usesFallback: boolean, options: MasterBusOptions = {}) {
    this.limiter = limiter;
    this.usesFallback = usesFallback;
    this.latencySeconds = limiter.latencySeconds;
    this.now = options.now ?? (() => (typeof performance === "undefined" ? Date.now() : performance.now()));
    this.input = context.createGain();
    this.input.gain.value = dbToGain(clampMasterVolumeDb(options.volumeDb ?? MASTER_VOLUME_DEFAULT_DB));
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.input.connect(limiter.input);
    limiter.output.connect(this.analyser);
    this.analyser.connect(options.destination ?? context.destination);
    limiter.onReduction((db) => {
      this.reduction = Math.min(0, db);
      this.reportedAt = this.now();
    });
  }

  /** 마스터 볼륨을 `time`부터 부드럽게 바꾼다(10 ms 시상수). */
  setVolumeDb(db: number, time: number): void {
    smooth(this.input.gain, dbToGain(clampMasterVolumeDb(db)), time);
  }

  /** 마스터 볼륨을 곧바로 바꾼다. 아직 소리가 나지 않을 때(재생을 시작하기 전)만 쓴다. */
  setVolumeDbNow(db: number): void {
    this.input.gain.cancelScheduledValues(0);
    this.input.gain.value = dbToGain(clampMasterVolumeDb(db));
  }

  /** 리미터가 최근에 내린 이득(dB, 0 이하). 한동안 알려 오지 않으면 0이다. */
  reductionDb(): number {
    return this.now() - this.reportedAt > REDUCTION_STALE_MS ? 0 : this.reduction;
  }

  dispose(): void {
    this.limiter.dispose();
    this.input.disconnect();
    this.analyser.disconnect();
  }
}

/** 워크렛 리미터로 마스터 길을 만든다. 워크렛을 못 올리면 옛 압축기로 대신하고 경고를 남긴다. */
export async function createMasterBus(context: BaseAudioContext, options: MasterBusOptions = {}): Promise<MasterBus> {
  try {
    const limiter = await (options.createLimiter ?? loadWorkletLimiter)(context);
    return new MasterBus(context, limiter, false, options);
  } catch (error) {
    console.warn("선읽기 리미터를 올리지 못해 옛 방식(압축기)으로 대신합니다.", error);
    return new MasterBus(context, createFallbackLimiter(context), true, options);
  }
}
