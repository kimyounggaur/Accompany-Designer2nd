/** 모든 이펙트가 지키는 약속. 트랙 스트립은 이 약속만 보고 이펙트를 슬롯에 끼운다. */
export interface EffectNode<Settings> {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** 값을 부드럽게 맞춘다. 소리 쪽 예약은 `time`부터 걸린다. */
  update(settings: Settings, bpm: number, time: number): void;
  /** 입력이 끊긴 뒤에도 소리가 남는 시간(초) */
  tailSeconds(settings: Settings, bpm: number): number;
  /** 지금 걸리는 압축량(dB, 0 이하). 컴프레서만 가진다: 화면의 컴프레서 바늘이 읽는다. */
  reduction?(): number;
  /** 모든 연결을 끊고 기다리던 일을 취소한다. */
  dispose(): void;
}

/** 값이 바뀔 때 목표값으로 가는 데 쓰는 시상수(초). 약 30ms면 거의 닿는다. */
export const SMOOTH_SECONDS = 0.01;

export function smooth(param: AudioParam, value: number, time: number): void {
  param.setTargetAtTime(value, time, SMOOTH_SECONDS);
}

/** 일정 시간 뒤에 할 일을 맡기는 곳. 시험에서는 손으로 돌리는 것으로 바꾼다. */
export interface EffectTimers {
  /** `ms` 뒤에 `action`을 하고, 그 전에 취소하는 함수를 돌려준다. */
  after(ms: number, action: () => void): () => void;
}

export const realTimers: EffectTimers = {
  after(ms, action) {
    const id = setTimeout(action, ms);
    return () => clearTimeout(id);
  },
};

/** 페이드가 끝났다고 보는 시상수 배수: 시상수의 5배가 지나면 목표까지 99.3%를 간다. */
const FADE_TIME_CONSTANTS = 5;

/**
 * `time`부터 `seconds` 안에 값을 `target`으로 옮긴다(시상수 = seconds / 5: 끝에서 0.7%만 남는다).
 *
 * 직선 램프(`linearRampToValueAtTime`)는 쓰지 않는다. 직선 램프는 "바로 앞 예약의 끝 시각과 값"에서 시작하므로,
 * 앞서 예약한 일이 오래전에 끝났다면 `time`이 아니라 그때부터 길게 움직여 소리가 서서히 쓸려 내려가거나(순서 바꾸기에서 실제로 튐이 났다),
 * 진행 중이면 갑자기 값이 건너뛴다. 목표값 방식은 `time`에서의 값을 이어받아 시작하므로 앞의 예약이 어떤 상태든 끊김 없이 이어진다.
 */
export function fadeTo(param: AudioParam, target: number, time: number, seconds: number): void {
  param.setTargetAtTime(target, time, seconds / FADE_TIME_CONSTANTS);
}
