import type { ProjectDoc } from "../../domain/types";
import { MASTER_VOLUME_DEFAULT_DB } from "../../domain/master/volume";
import { planVoice } from "../../domain/timeline/clipMath";
import type { EffectTimers } from "../effects/EffectNode";
import type { EffectEnv } from "../effects/registry";
import { limiterLookaheadFrames } from "../worklets/limiterCore";
import { ClipVoice } from "./ClipVoice";
import { createMasterBus, type LimiterHandle, type MasterBus } from "./MasterBus";
import { MixCancelledError } from "./mixErrors";
import { EXPORT_CHANNELS, mixClips, progressMarks, type MixPlan } from "./mixPlan";
import { TrackStrip } from "./TrackStrip";

/**
 * 믹스 내보내기(P3-6): 재생에서 쓰는 `TrackStrip`·`MasterBus`를 `OfflineAudioContext` 위에 그대로 만들어 한 번에 렌더한다.
 * 그래서 재생에서 들은 소리(이펙트·마스터 볼륨·−1 dBFS 리미터)가 파일에도 같게 들어간다. 옛 `renderMix`는 마스터 길이 따로였다.
 *
 *  - 길이: 계획(`planMixRender`)이 정한 프레임 수 = 마지막 클립 끝 + 이펙트 꼬리.
 *  - 리미터 지연: 워크렛 리미터는 소리를 5 ms(44.1 kHz에서 221프레임) 늦춘다. 그만큼 더 렌더하고 파일 앞에서 잘라 낸다.
 *    옛 압축기로 대신한 경우(지연 0)는 앞에서부터 그대로 쓴다.
 *  - 진행률: 렌더 전에 2초 간격으로 `suspend(t)`를 예약해 두고, 멈출 때마다 알린 뒤 `resume()`한다.
 *  - 취소: 알림이 와도 이어 가지 않고 버린다. 소리 길을 끊어 두므로 남은 구간은 빈 그래프로 금방 끝나 자원이 돌아온다.
 */

/** 오프라인 렌더에 쓰는 컨텍스트가 갖춰야 하는 것. 실제로는 `OfflineAudioContext`. */
export type OfflineContext = BaseAudioContext & {
  readonly length: number;
  startRendering(): Promise<AudioBuffer>;
  suspend(suspendTime: number): Promise<void>;
  resume(): Promise<void>;
};

export interface MixRenderRequest {
  project: Pick<ProjectDoc, "bpm" | "tracks" | "master">;
  /** `planMixRender`가 만든 계획. 샘플레이트와 길이는 여기서 온다. */
  plan: MixPlan;
  /** 음원 id → 디코딩된 버퍼 */
  getBuffer: (assetId: string) => AudioBuffer | undefined;
  /** 렌더가 진행될 때마다(약 2초 분량마다) 0~1로 알린다. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface MixRenderDeps {
  /** 시험에서 가짜 오프라인 컨텍스트를 끼울 때 */
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineContext;
  /** 시험에서 워크렛 리미터 대신 끼울 리미터 만들기 */
  createLimiter?: (context: BaseAudioContext) => Promise<LimiterHandle>;
  /** 시험에서 리버브 잔향 만들기를 바꿔 끼울 때 */
  makeImpulse?: EffectEnv["makeImpulse"];
}

export interface RenderedMix {
  sampleRate: number;
  /** 채널마다의 프레임 수(파일 길이) */
  frames: number;
  /** 곡 위치에 맞춘 채널 데이터(리미터 지연을 잘라 낸 것). 소유권을 Worker로 넘길 수 있다. */
  channels: Float32Array<ArrayBuffer>[];
  /** 파일 앞에서 잘라 낸 프레임 수(워크렛 리미터의 지연. 대신 쓴 압축기면 0) */
  trimmedFrames: number;
  /** 워크렛 리미터를 못 올려 옛 압축기로 대신했는가 */
  usedFallbackLimiter: boolean;
}

/** 오프라인 렌더에서는 이펙트가 "나중에 할 일"을 맡길 일이 없다(값이 바뀌지 않는다). 아무것도 예약하지 않는다. */
const NO_TIMERS: EffectTimers = { after: () => () => {} };

function createOfflineContext(channels: number, length: number, sampleRate: number): OfflineContext {
  try {
    return new OfflineAudioContext(channels, length, sampleRate);
  } catch (error) {
    // 곡이 길거나 샘플레이트가 높으면 결과를 담을 메모리를 못 잡을 수 있다.
    throw new Error("믹스를 담을 메모리를 확보하지 못했습니다. 곡 길이를 줄이거나 샘플레이트를 낮춰 다시 시도해 주세요.", { cause: error });
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new MixCancelledError();
}

/** 결과를 가져올 때 한 번에 복사하는 프레임 수(채널마다 4 MB). 곡이 길어도 화면 스레드를 오래 붙잡지 않는다. */
export const COPY_CHUNK_FRAMES = 1 << 20;

/** 화면 스레드를 한 번 놓아 준다(다른 입력·그리기가 끼어들 틈). 쓸 수 있으면 `scheduler.yield`, 아니면 타이머. */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === "function") return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 렌더 결과에서 `frames`프레임을 `offset`부터 채널별로 복사해 온다. 덩어리마다 화면 스레드를 놓아 주고,
 * 그 틈에 취소가 오면 멈춘다.
 */
async function copyChannels(rendered: AudioBuffer, offset: number, frames: number, signal: AbortSignal | undefined): Promise<Float32Array<ArrayBuffer>[]> {
  const channels: Float32Array<ArrayBuffer>[] = [];
  for (let channel = 0; channel < EXPORT_CHANNELS; channel += 1) {
    const data = new Float32Array(frames);
    for (let start = 0; start < frames; start += COPY_CHUNK_FRAMES) {
      rendered.copyFromChannel(data.subarray(start, Math.min(frames, start + COPY_CHUNK_FRAMES)), channel, offset + start);
      await yieldToMain();
      throwIfAborted(signal);
    }
    channels.push(data);
  }
  return channels;
}

/**
 * 렌더를 시작하고 2초 분량마다 진행을 알린다. 취소하면 곧바로 `MixCancelledError`로 끝내고 `discard()`를 부른다.
 * 취소한 뒤에도 남은 멈춤 지점마다 `resume()`해서 렌더 스레드가 끝까지 비워 돌고 컨텍스트가 놓이게 한다(결과는 버린다).
 */
function renderWithProgress(
  context: OfflineContext,
  totalFrames: number,
  sampleRate: number,
  onProgress: ((fraction: number) => void) | undefined,
  signal: AbortSignal | undefined,
  discard: () => void,
): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let cancelled = false;
    let settled = false;
    const cancel = () => {
      if (cancelled || settled) return;
      cancelled = true;
      discard();
      reject(new MixCancelledError());
    };
    if (signal) {
      if (signal.aborted) {
        cancel();
        return;
      }
      signal.addEventListener("abort", cancel, { once: true });
    }
    for (const time of progressMarks(totalFrames, sampleRate)) {
      context
        .suspend(time)
        .then(() => {
          if (!cancelled) onProgress?.(Math.min(1, (time * sampleRate) / totalFrames));
          return context.resume();
        })
        .catch(() => {
          /* 이미 끝났거나 멈출 수 없는 시각: 진행률만 건너뛴다 */
        });
    }
    context.startRendering().then(
      (buffer) => {
        signal?.removeEventListener("abort", cancel);
        if (cancelled) return;
        settled = true;
        resolve(buffer);
      },
      (error: unknown) => {
        signal?.removeEventListener("abort", cancel);
        if (cancelled) return;
        settled = true;
        reject(error);
      },
    );
  });
}

/**
 * 문서를 믹스 한 덩어리로 렌더한다. 화면 스레드를 막지 않는다: 렌더는 오디오 스레드에서 돌고, 이 함수는 그래프를 만들 때와
 * 결과를 복사할 때만 화면 스레드를 쓴다.
 */
export async function renderOfflineMix(request: MixRenderRequest, deps: MixRenderDeps = {}): Promise<RenderedMix> {
  const { project, plan, getBuffer, onProgress, signal } = request;
  throwIfAborted(signal);
  const { sampleRate } = plan.options;
  const lookahead = limiterLookaheadFrames(sampleRate);
  const totalFrames = plan.frames + lookahead;
  const context = (deps.createContext ?? createOfflineContext)(EXPORT_CHANNELS, totalFrames, sampleRate);

  const strips: TrackStrip[] = [];
  let bus: MasterBus | undefined;
  const teardown = () => {
    for (const strip of strips) strip.dispose();
    strips.length = 0;
    bus?.dispose();
    bus = undefined;
  };

  try {
    bus = await createMasterBus(context, {
      volumeDb: project.master?.volumeDb ?? MASTER_VOLUME_DEFAULT_DB,
      createLimiter: deps.createLimiter,
    });
    throwIfAborted(signal);

    // 소리가 나는 클립이 있는 트랙만 소리 길을 만든다(클립이 없는 트랙은 어떤 소리도 내지 못한다).
    const solo = project.tracks.some((track) => track.solo);
    const clips = mixClips(project);
    const stripByTrack = new Map<string, TrackStrip>();
    for (const track of project.tracks) {
      if (!clips.some((entry) => entry.track.id === track.id)) continue;
      const strip = new TrackStrip(context, bus.input, track, project.bpm, { solo, timers: NO_TIMERS, makeImpulse: deps.makeImpulse });
      strips.push(strip);
      stripByTrack.set(track.id, strip);
    }
    for (const { track, clip } of clips) {
      const buffer = getBuffer(clip.audioBufferId);
      if (!buffer) throw new Error("음원을 찾을 수 없습니다. 음원을 다시 연결해 주세요.");
      const strip = stripByTrack.get(track.id);
      if (!strip) continue;
      // 곡 처음(0초)부터 렌더하므로 타임라인 위치가 곧 컨텍스트 시각이다.
      const voice = planVoice(clip, project.bpm, 0, buffer.duration, (position) => position);
      if (voice) new ClipVoice(context, clip, buffer, strip.input, voice);
    }
    throwIfAborted(signal);

    const rendered = await renderWithProgress(context, totalFrames, sampleRate, onProgress, signal, teardown);
    const usedFallbackLimiter = bus.usesFallback;
    const trimmedFrames = usedFallbackLimiter ? 0 : lookahead;
    teardown();

    const channels = await copyChannels(rendered, trimmedFrames, plan.frames, signal);
    onProgress?.(1);
    return { sampleRate, frames: plan.frames, channels, trimmedFrames, usedFallbackLimiter };
  } finally {
    teardown();
  }
}
