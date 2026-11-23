import { smooth } from "../effects/EffectNode";

/** 모니터 볼륨(0~1)의 처음 값. 메트로놈 클릭과 입력 모니터가 늘 이 크기를 거친다. */
export const MONITOR_VOLUME_DEFAULT = 0.85;

export function clampMonitorVolume(volume: number): number {
  if (!Number.isFinite(volume)) return MONITOR_VOLUME_DEFAULT;
  return Math.min(1, Math.max(0, volume));
}

/**
 * 모니터 길: 메트로놈과 입력 모니터가 스피커로만 나가는 길. 마스터 길(MasterBus)을 거치지 않으므로
 * 믹스·마스터 미터·리미터·내보내기에는 섞이지 않고, 마스터 볼륨의 영향도 받지 않는다. 볼륨은 따로 있다.
 */
export class MonitorBus {
  /** 메트로놈·입력 모니터가 이어지는 곳. 모니터 볼륨이 이 게인이다. */
  readonly input: GainNode;

  constructor(context: BaseAudioContext, volume: number = MONITOR_VOLUME_DEFAULT, destination: AudioNode = context.destination) {
    this.input = context.createGain();
    this.input.gain.value = clampMonitorVolume(volume);
    this.input.connect(destination);
  }

  setVolume(volume: number, time: number): void {
    smooth(this.input.gain, clampMonitorVolume(volume), time);
  }

  dispose(): void {
    this.input.disconnect();
  }
}
