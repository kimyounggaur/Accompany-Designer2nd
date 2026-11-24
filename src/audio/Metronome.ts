/**
 * 메트로놈과 카운트인. 소리는 오디오 시계(`context.currentTime`)에 미리 예약하고, 예약하는 일(틱)은 Worker 타이머가 깨운다.
 * 화면 스레드가 바빠도 박이 밀리지 않고, 박의 시각은 "기준 시각 + 박 번호 × 박 길이"로 곱해서 구하므로 오차가 쌓이지 않는다
 * (옛 방식은 `+= 박 길이`를 되풀이해 부동소수 오차가 쌓였고 타이머 틱에 따라 흔들렸다).
 */
import { clamp } from "../utils/audioMath";

/** 틱마다 앞으로 이만큼(초) 안에 오는 박을 예약한다. 틱 간격(25 ms)보다 넉넉히 길어야 틱이 한두 번 늦어도 박을 놓치지 않는다. */
export const METRONOME_LOOKAHEAD_SECONDS = 0.15;
/** 카운트인·녹음 시작을 지금보다 이만큼(초) 뒤로 잡는다: 예약한 소리가 닿을 시간을 준다. */
export const COUNT_IN_LEAD_SECONDS = 0.1;
export const DEFAULT_BEATS_PER_BAR = 4;
/** 클릭 한 번이 몇 분음표인가의 기본값(4 = 4분음표). 6/8처럼 8분음표를 세는 박자표는 8. */
export const DEFAULT_BEAT_UNIT = 4;

/** 4분음표 한 박의 길이(초). 템포는 20~300으로 맞춘다. */
export function beatSeconds(bpm: number): number {
  return 60 / clamp(Number(bpm) || 120, 20, 300);
}

/**
 * 클릭 한 번의 길이(초). 템포는 4분음표 기준이라, 단위가 8분음표(6/8)면 절반이다.
 * 단위가 4(기본)이면 `beatSeconds`와 같다.
 */
export function clickInterval(bpm: number, beatUnit: number = DEFAULT_BEAT_UNIT): number {
  const unit = Number(beatUnit) > 0 ? Number(beatUnit) : DEFAULT_BEAT_UNIT;
  return (beatSeconds(bpm) * DEFAULT_BEAT_UNIT) / unit;
}

export interface Click {
  /** 소리가 나는 오디오 시각 */
  time: number;
  /** 마디의 첫 박 */
  strong: boolean;
  /** 박 번호(기준 박이 0, 카운트인은 음수) */
  beat: number;
}

export interface CountInPlan {
  /** 첫 카운트인 클릭의 오디오 시각 */
  t0: number;
  /** 클릭 한 번의 길이(초) */
  beatSeconds: number;
  /** 카운트인이 끝나 반주 재생과 녹음이 시작하는 오디오 시각 = t0 + 박 수 × 박 길이 */
  startTime: number;
  /** 카운트인 클릭들(첫 박이 강박, 마디 길이를 알려 주면 마디마다 첫 박이 강박). 박 수가 0이면 비어 있다. */
  clicks: Click[];
}

/**
 * 카운트인 계획. `t0 = 지금 + 0.1초`부터 박마다 클릭을 예약하고, 반주 재생과 녹음 시작을 정확히 `t0 + 박 수 × 박 길이`에 맞춘다.
 * 박 수가 0이면 카운트인 없이 `t0`(= 지금 + 0.1초)에 시작한다.
 * 박자표를 알려 주면(`beatsPerBar`, `beatUnit`) 클릭 길이는 단위음표를 따르고(6/8은 8분음표), 마디의 첫 박마다 강박이다.
 * 알려 주지 않으면 4분음표 클릭에 첫 박만 강박이다(박자표가 없던 때와 같다).
 */
export function planCountIn(options: { now: number; beats: number; bpm: number; lead?: number; beatsPerBar?: number; beatUnit?: number }): CountInPlan {
  const beat = clickInterval(options.bpm, options.beatUnit);
  const count = clamp(Math.round(Number(options.beats) || 0), 0, 16);
  const bar = options.beatsPerBar === undefined ? undefined : Math.max(1, Math.round(options.beatsPerBar) || DEFAULT_BEATS_PER_BAR);
  const t0 = options.now + (options.lead ?? COUNT_IN_LEAD_SECONDS);
  const clicks: Click[] = [];
  for (let index = 0; index < count; index += 1) {
    const strong = bar === undefined ? index === 0 : index % bar === 0;
    clicks.push({ time: t0 + index * beat, strong, beat: index - count });
  }
  return { t0, beatSeconds: beat, startTime: t0 + count * beat, clicks };
}

/** 박 번호가 마디의 첫 박인가(음수 박도 마디 안에서 센다). */
export function isStrongBeat(beat: number, beatsPerBar: number): boolean {
  const bar = Math.max(1, Math.round(beatsPerBar) || DEFAULT_BEATS_PER_BAR);
  return (((beat % bar) + bar) % bar) === 0;
}

export interface MetronomeOptions {
  /** 지금 오디오 시각 */
  now: () => number;
  /** 클릭 하나를 그 시각에 울리도록 예약한다. 이미 예약한 것을 거둘 수 있으면 `cancel`을 돌려준다. */
  click: (click: Click) => { cancel(): void } | void;
  bpm: number;
  beatsPerBar?: number;
  /** 클릭 한 번이 몇 분음표인가(기본 4 = 4분음표, 6/8은 8). 클릭 사이 간격이 이 단위음표의 길이가 된다. */
  beatUnit?: number;
  /** 박 `anchorBeat`가 오는 오디오 시각 */
  anchorTime: number;
  /** 기준 박 번호(기본 0). 박 n의 시각 = anchorTime + (n − anchorBeat) × 박 길이 */
  anchorBeat?: number;
  /** 처음으로 예약할 박 번호(기본 기준 박) */
  firstBeat?: number;
  lookahead?: number;
}

/** 박 n의 오디오 시각. 곱해서 구하므로 몇 시간이 지나도 오차가 쌓이지 않는다. */
export function beatTime(anchorTime: number, anchorBeat: number, beat: number, secondsPerBeat: number): number {
  return anchorTime + (beat - anchorBeat) * secondsPerBeat;
}

/** 틱을 받을 때마다 앞으로 `lookahead` 안에 오는 박을 예약하는 메트로놈. 소리 합성은 `click`이 맡아서 Web Audio 없이도 시험할 수 있다. */
export class Metronome {
  private readonly options: MetronomeOptions;
  private readonly secondsPerBeat: number;
  private readonly anchorBeat: number;
  private next: number;
  private pending: Array<{ time: number; cancel(): void }> = [];
  private stopped = false;

  constructor(options: MetronomeOptions) {
    this.options = options;
    this.secondsPerBeat = clickInterval(options.bpm, options.beatUnit);
    this.anchorBeat = options.anchorBeat ?? 0;
    this.next = options.firstBeat ?? this.anchorBeat;
  }

  /** 다음에 예약할 박 번호 */
  get nextBeat(): number {
    return this.next;
  }

  /** 예약한 박들을 돌려준다(시험·진단용). 이미 지난 박(늦게 깨어났을 때)은 소리 없이 건너뛴다. */
  tick(): Click[] {
    if (this.stopped) return [];
    const { now, click, beatsPerBar = DEFAULT_BEATS_PER_BAR, anchorTime, lookahead = METRONOME_LOOKAHEAD_SECONDS } = this.options;
    const current = now();
    const horizon = current + lookahead;
    const scheduled: Click[] = [];
    this.pending = this.pending.filter((entry) => entry.time > current);
    for (;;) {
      const time = beatTime(anchorTime, this.anchorBeat, this.next, this.secondsPerBeat);
      if (time >= horizon) break;
      const beat = this.next;
      this.next += 1;
      if (time < current) continue; // 이미 지났다: 늦게 울리느니 건너뛴다
      const entry: Click = { time, strong: isStrongBeat(beat, beatsPerBar), beat };
      const handle = click(entry);
      if (handle) this.pending.push({ time, cancel: () => handle.cancel() });
      scheduled.push(entry);
    }
    return scheduled;
  }

  /** 멈춘다. 아직 울리지 않은 클릭은 거둔다. */
  stop(): void {
    this.stopped = true;
    const current = this.options.now();
    for (const entry of this.pending) if (entry.time > current) entry.cancel();
    this.pending = [];
  }
}

/** 클릭 소리(Web Audio). 마디의 첫 박은 높고 크게, 나머지는 낮고 작게 짧게 울린다. */
export function createClickPlayer(context: BaseAudioContext, output: () => AudioNode | undefined): (click: Click) => { cancel(): void } {
  return ({ time, strong }) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(strong ? 1320 : 880, time);
    gain.gain.setValueAtTime(strong ? 0.18 : 0.11, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.055);
    oscillator.connect(gain);
    // 메트로놈은 모니터 길로 보낸다(마스터 길·미터·내보내기에 섞이지 않고, 모니터 볼륨을 따른다).
    gain.connect(output() ?? context.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.06);
    return {
      cancel() {
        try {
          oscillator.stop();
        } catch {
          /* 이미 끝났다 */
        }
        oscillator.disconnect();
        gain.disconnect();
      },
    };
  };
}
