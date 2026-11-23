import type { Clip } from "../../types";
import type { VoicePlan } from "../../domain/timeline/clipMath";
import { scheduleClipEnvelope } from "./clipEnvelope";

/** 클립 중간에서 시작할 때만 쓰는 짧은 페이드 인(클릭 방지). 클립 자체의 페이드 곡선과는 별개다. */
export const START_FADE = 0.005;
/** 정지할 때 소리를 내리는 시간. 약 8ms 안에 사실상 0이 된다. */
export const STOP_FADE = 0.008;

/**
 * 클립 1개의 재생 단위: 소스 → 클립 게인(음량·페이드) → 시작·정지 게인 → 트랙 입력.
 * 시작·정지 게인을 따로 두어서, 클립의 페이드 곡선을 건드리지 않고 시작·정지 클릭만 막는다.
 */
export class ClipVoice {
  readonly clip: Clip;
  readonly plan: VoicePlan;
  private readonly ctx: BaseAudioContext;
  private readonly source: AudioBufferSourceNode;
  private readonly envelope: GainNode;
  private readonly gate: GainNode;
  private stopped = false;
  private finished = false;

  constructor(
    ctx: BaseAudioContext,
    clip: Clip,
    buffer: AudioBuffer,
    out: AudioNode,
    plan: VoicePlan,
    onEnded?: (voice: ClipVoice) => void,
  ) {
    this.ctx = ctx;
    this.clip = clip;
    this.plan = plan;
    this.source = ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.playbackRate.value = plan.rate;
    this.envelope = ctx.createGain();
    this.gate = ctx.createGain();
    this.source.connect(this.envelope);
    this.envelope.connect(this.gate);
    this.gate.connect(out);
    scheduleClipEnvelope(this.envelope.gain, clip, plan);
    if (plan.startsMidClip) {
      // 기본 게인은 1이라, 예약한 값(0)이 적용되기 전의 첫 샘플이 그대로 새어 나가 소리가 한 샘플 튄다(겹치는 소리와 합쳐지면 2배).
      // 그래서 처음 값부터 0으로 둔다. 소스는 `when`까지 소리를 내지 않으니 그 전의 0은 들리지 않는다.
      this.gate.gain.value = 0;
      this.gate.gain.setValueAtTime(0, plan.when);
      this.gate.gain.linearRampToValueAtTime(1, plan.when + START_FADE);
    }
    this.source.onended = () => {
      this.release();
      onEnded?.(this);
    };
    this.source.start(plan.when, plan.offset, plan.duration);
  }

  /** 소리를 8ms 안에 부드럽게 내리고 끝낸다. 여러 번 불러도 한 번만 동작한다. */
  stop(at: number = this.ctx.currentTime): void {
    if (this.stopped) return;
    this.stopped = true;
    const gain = this.gate.gain as AudioParam & { cancelAndHoldAtTime?: (time: number) => AudioParam };
    if (typeof gain.cancelAndHoldAtTime === "function") gain.cancelAndHoldAtTime(at);
    else gain.cancelScheduledValues(at);
    gain.setTargetAtTime(0, at, STOP_FADE / 4);
    try {
      this.source.stop(at + STOP_FADE * 2);
    } catch {
      /* 이미 끝났다 */
    }
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  private release(): void {
    if (this.finished) return;
    this.finished = true;
    for (const node of [this.source, this.envelope, this.gate]) {
      try {
        node.disconnect();
      } catch {
        /* 이미 끊김 */
      }
    }
  }
}
