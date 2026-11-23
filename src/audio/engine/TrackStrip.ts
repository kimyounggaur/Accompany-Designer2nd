import type { EffectSlotType, Track } from "../../domain/types";
import { effectOrder, isEffectActive } from "../effects/chain";
import { fadeTo, realTimers, smooth, type EffectTimers } from "../effects/EffectNode";
import { EFFECT_KINDS, type EffectEnv, type SlotEffect } from "../effects/registry";

/** 이펙트를 켜고 끌 때 원음과 효과 소리가 서로 넘어가는 시간(초) */
export const CROSSFADE_SECONDS = 0.01;
/** 이펙트 순서를 바꿀 때 트랙 소리를 0으로 내렸다 올리는 시간(초) */
export const REORDER_DIP_SECONDS = 0.01;
/** 꺼진 지 이만큼 지나면 효과 길의 입력 연결을 끊어 계산을 아낀다(ms) */
export const IDLE_DISCONNECT_MS = 1000;
/** 효과를 바꿔 끼운 뒤 옛 효과를 치우기까지의 여유(ms). 교차가 끝난 뒤여야 한다. */
const EFFECT_RETIRE_MS = 100;
/** 순서를 바꾸는 연결 작업은 소리가 거의 0이 된 다음에 한다: 내리는 시간에 더하는 여유(초). 10ms 뒤 0.7%(−43dB), 15ms 뒤 0.06%(−65dB)가 남는다. */
const REWIRE_MARGIN_SECONDS = 0.005;

/** 효과 길 하나: 이펙트와 그 소리의 크기를 정하는 wet 게인 */
interface EffectPath {
  effect: SlotEffect;
  wet: GainNode;
  key: string;
  connected: boolean;
}

/**
 * 이펙트 한 칸. 모든 이펙트가 같은 껍데기에 들어간다.
 *
 *   칸 입력 ─┬─ dry ───────────────────┬─ 칸 출력
 *            └─ 이펙트 → wet(효과 길) ─┘
 *
 * 켜기/끄기는 연결을 바꾸지 않고 dry와 wet의 크기를 10ms 동안 맞바꾸는 것으로 끝난다. 그래서 소리 소스는 그대로 흐른다.
 */
class Slot {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly context: BaseAudioContext;
  private readonly env: EffectEnv;
  private readonly type: EffectSlotType;
  private path?: EffectPath;
  private active = false;
  private cancelIdle?: () => void;
  private readonly retiring = new Map<EffectPath, () => void>();

  constructor(type: EffectSlotType, context: BaseAudioContext, env: EffectEnv) {
    this.type = type;
    this.context = context;
    this.env = env;
    this.input = context.createGain();
    this.output = context.createGain();
    this.dry = context.createGain();
    this.input.connect(this.dry);
    this.dry.connect(this.output);
  }

  /** 트랙을 처음 만들 때: 켜져 있으면 교차 없이 바로 효과 길로 간다(아직 들리는 소리가 없다). */
  start(track: Track, bpm: number, active: boolean): void {
    if (!active) return;
    const path = this.createPath(track, bpm);
    this.path = path;
    this.dry.gain.value = 0;
    path.wet.gain.value = 1;
    this.active = true;
  }

  apply(track: Track, bpm: number, time: number, active: boolean): void {
    const kind = EFFECT_KINDS[this.type];
    if (active) {
      if (this.path && this.path.key !== kind.structureKey(track)) {
        this.replacePath(track, bpm, time);
      } else if (!this.path) {
        this.path = this.createPath(track, bpm);
        this.crossfade(true, time);
      } else {
        this.path.effect.update(track, bpm, time);
        if (!this.path.connected) this.connect(this.path); // 연결 → 교차 순서
        if (!this.active) this.crossfade(true, time);
      }
      this.cancelIdle?.();
      this.cancelIdle = undefined;
    } else if (this.active) {
      this.crossfade(false, time);
      this.scheduleIdleDisconnect();
    } else if (this.path && this.path.key !== kind.structureKey(track)) {
      // 꺼져 있는 동안 연결 모양이 달라졌다: 다음에 켤 때 새로 만든다.
      this.disposePath(this.path);
      this.path = undefined;
    }
    this.active = active;
  }

  /** 이 칸의 이펙트가 지금 걸고 있는 압축량(dB). 꺼져 있거나 압축기가 아니면 0. */
  reduction(): number {
    return this.active ? this.path?.effect.reduction?.() ?? 0 : 0;
  }

  dispose(): void {
    this.cancelIdle?.();
    this.cancelIdle = undefined;
    for (const cancel of this.retiring.values()) cancel();
    for (const path of this.retiring.keys()) this.disposePath(path);
    this.retiring.clear();
    if (this.path) this.disposePath(this.path);
    this.path = undefined;
    for (const node of [this.input, this.output, this.dry]) node.disconnect();
  }

  private createPath(track: Track, bpm: number): EffectPath {
    const kind = EFFECT_KINDS[this.type];
    const effect = kind.create(this.context, track, bpm, this.env);
    const wet = this.context.createGain();
    wet.gain.value = 0;
    effect.output.connect(wet);
    wet.connect(this.output);
    const path: EffectPath = { effect, wet, key: kind.structureKey(track), connected: false };
    this.connect(path);
    return path;
  }

  private connect(path: EffectPath): void {
    this.input.connect(path.effect.input);
    path.connected = true;
  }

  private disposePath(path: EffectPath): void {
    if (path.connected) this.input.disconnect(path.effect.input);
    path.connected = false;
    path.effect.dispose();
    path.wet.disconnect();
  }

  private crossfade(toEffect: boolean, time: number): void {
    if (!this.path) return;
    fadeTo(this.dry.gain, toEffect ? 0 : 1, time, CROSSFADE_SECONDS);
    fadeTo(this.path.wet.gain, toEffect ? 1 : 0, time, CROSSFADE_SECONDS);
  }

  /** 켜진 채로 연결 모양이 바뀌었다: 새 효과 길을 만들어 옛 길과 10ms 동안 교차하고, 옛 길은 조금 뒤에 치운다. */
  private replacePath(track: Track, bpm: number, time: number): void {
    const previous = this.path;
    if (!previous) return;
    const next = this.createPath(track, bpm);
    fadeTo(previous.wet.gain, 0, time, CROSSFADE_SECONDS);
    fadeTo(next.wet.gain, 1, time, CROSSFADE_SECONDS);
    this.path = next;
    const waitMs = Math.max(0, (time + CROSSFADE_SECONDS - this.context.currentTime) * 1000) + EFFECT_RETIRE_MS;
    this.retiring.set(previous, this.env.timers.after(waitMs, () => {
      this.retiring.delete(previous);
      this.disposePath(previous);
    }));
  }

  private scheduleIdleDisconnect(): void {
    this.cancelIdle?.();
    const path = this.path;
    this.cancelIdle = this.env.timers.after(IDLE_DISCONNECT_MS, () => {
      this.cancelIdle = undefined;
      if (this.active || !path || this.path !== path || !path.connected) return;
      this.input.disconnect(path.effect.input);
      path.connected = false;
    });
  }
}

export interface TrackStripOptions {
  /** 트랙을 만들 때 다른 트랙이 솔로 중인가(음소거와 같이 소리 크기를 정한다) */
  solo?: boolean;
  timers?: EffectTimers;
  makeImpulse?: EffectEnv["makeImpulse"];
}

function levelOf(track: Track, solo: boolean): number {
  return track.muted || (solo && !track.solo) ? 0 : track.volume;
}

function sameOrder(a: readonly EffectSlotType[], b: readonly EffectSlotType[]): boolean {
  return a.length === b.length && a.every((type, index) => type === b[index]);
}

/**
 * 트랙 하나의 소리 길: 입력 → 이펙트 칸들(순서대로) → 순서 바꿀 때 쓰는 게인 → 팬 → 볼륨 → 미터 → 마스터.
 * 이펙트를 켜고 끄거나 순서를 바꿔도 길을 새로 만들지 않으므로, 입력에 붙은 소리 소스는 멈추거나 다시 시작하지 않는다.
 */
export class TrackStrip {
  /** 클립 소리가 들어오는 곳 */
  readonly input: GainNode;
  /** 트랙 볼륨(음소거·솔로 포함) */
  readonly output: GainNode;
  readonly analyser: AnalyserNode;
  private readonly dip: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly context: BaseAudioContext;
  private readonly env: EffectEnv;
  private readonly slots = new Map<EffectSlotType, Slot>();
  private order: EffectSlotType[];
  private pendingOrder?: EffectSlotType[];
  private cancelRewire?: () => void;

  constructor(context: BaseAudioContext, master: AudioNode, track: Track, bpm: number, options: TrackStripOptions = {}) {
    this.context = context;
    this.env = { timers: options.timers ?? realTimers, makeImpulse: options.makeImpulse };
    this.input = context.createGain();
    this.dip = context.createGain();
    this.pan = context.createStereoPanner();
    this.output = context.createGain();
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.72;
    this.pan.pan.value = track.pan;
    // 처음부터 음소거·솔로가 반영된 크기로 시작한다(소리가 붙기 전에 이미 닫혀 있어야 한다).
    this.output.gain.value = levelOf(track, options.solo ?? false);
    this.dip.connect(this.pan);
    this.pan.connect(this.output);
    this.output.connect(this.analyser);
    this.analyser.connect(master);

    this.order = effectOrder(track);
    for (const type of this.order) {
      const slot = this.slotFor(type);
      slot.start(track, bpm, isEffectActive(track, type));
    }
    this.wire(this.order);
  }

  /** 트랙 값에 맞춘다: 크기·팬, 이펙트 켜기/끄기(10ms 교차), 순서(10ms 내렸다 올림), 이펙트 값. */
  update(track: Track, solo: boolean, bpm: number, time: number): void {
    smooth(this.output.gain, levelOf(track, solo), time);
    smooth(this.pan.pan, track.pan, time);
    const order = effectOrder(track);
    for (const type of order) this.slotFor(type);
    if (!sameOrder(order, this.pendingOrder ?? this.order)) this.reorder(order, time);
    for (const type of order) this.slotFor(type).apply(track, bpm, time, isEffectActive(track, type));
  }

  /** 컴프레서가 지금 걸고 있는 압축량(dB, 0 이하). 컴프레서가 꺼져 있으면 0. 컴프레서 바늘이 화면 갱신마다 읽는다. */
  compressorReduction(): number {
    return this.slots.get("comp")?.reduction() ?? 0;
  }

  /** 멈출 때: 트랙 소리를 곧바로 0으로 내린다(이펙트 꼬리도 이 뒤에 있으므로 함께 사라진다). */
  fadeOut(time: number): void {
    this.output.gain.cancelScheduledValues(time);
    this.output.gain.setTargetAtTime(0, time, 0.004);
  }

  dispose(): void {
    this.cancelRewire?.();
    this.cancelRewire = undefined;
    for (const slot of this.slots.values()) slot.dispose();
    for (const node of [this.input, this.dip, this.pan, this.output, this.analyser]) node.disconnect();
  }

  private slotFor(type: EffectSlotType): Slot {
    let slot = this.slots.get(type);
    if (!slot) {
      slot = new Slot(type, this.context, this.env);
      this.slots.set(type, slot);
    }
    return slot;
  }

  /** 입력 → 칸들 → 순서 게인으로 잇는다. */
  private wire(order: readonly EffectSlotType[]): void {
    let previous: AudioNode = this.input;
    for (const type of order) {
      const slot = this.slotFor(type);
      previous.connect(slot.input);
      previous = slot.output;
    }
    previous.connect(this.dip);
  }

  /** 입력과 칸 출구의 이어진 곳을 모두 끊는다(칸 안쪽 연결은 그대로). */
  private unwire(): void {
    this.input.disconnect();
    for (const slot of this.slots.values()) slot.output.disconnect();
  }

  /**
   * 순서 바꾸기: 소리를 10ms 동안 0으로 내리고, 0이 된 뒤에 연결을 바꾸고, 다시 올린다. 소리 소스는 멈추지 않는다.
   * 내리는 중에 또 바뀌면 마지막 순서만 쓴다.
   */
  private reorder(order: EffectSlotType[], time: number): void {
    this.pendingOrder = order;
    if (this.cancelRewire) return;
    fadeTo(this.dip.gain, 0, time, REORDER_DIP_SECONDS);
    const waitMs = Math.max(0, (time + REORDER_DIP_SECONDS + REWIRE_MARGIN_SECONDS - this.context.currentTime) * 1000);
    this.cancelRewire = this.env.timers.after(waitMs, () => {
      this.cancelRewire = undefined;
      const next = this.pendingOrder;
      this.pendingOrder = undefined;
      if (next) {
        this.unwire();
        this.wire(next);
        this.order = next;
      }
      fadeTo(this.dip.gain, 1, this.context.currentTime + REWIRE_MARGIN_SECONDS, REORDER_DIP_SECONDS);
    });
  }
}
