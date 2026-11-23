import type { EffectSlotType, Track } from "../../types";
import { createCompressor } from "./Compressor";
import { createDelay, delayStructureKey } from "./Delay";
import type { EffectNode, EffectTimers } from "./EffectNode";
import { createEq5Band } from "./Eq5Band";
import { createReverb, type ReverbOptions } from "./Reverb";

/** 이펙트를 만들 때 바깥에서 받는 것: 기다리는 일을 맡길 곳, 시험에서 바꿔 끼울 잔향 만들기 */
export interface EffectEnv {
  timers: EffectTimers;
  makeImpulse?: ReverbOptions["makeImpulse"];
}

/** 슬롯이 보는 이펙트 하나: 트랙 값을 그대로 받아 알아서 자기 설정을 골라 쓴다. */
export interface SlotEffect {
  readonly input: AudioNode;
  readonly output: AudioNode;
  update(track: Track, bpm: number, time: number): void;
  /** 지금 걸리는 압축량(dB). 컴프레서만 가진다. */
  reduction?(): number;
  dispose(): void;
}

export interface EffectKind {
  create(context: BaseAudioContext, track: Track, bpm: number, env: EffectEnv): SlotEffect;
  /** 이 값이 달라지면 이펙트를 새로 만들어야 한다(연결 모양이 다르다). 대부분은 늘 같은 값. */
  structureKey(track: Track): string;
}

function kind<Settings>(
  settingsOf: (track: Track) => Settings,
  create: (context: BaseAudioContext, settings: Settings, bpm: number, env: EffectEnv) => EffectNode<Settings>,
  structureKey: (settings: Settings) => string = () => "",
): EffectKind {
  return {
    create(context, track, bpm, env) {
      const node = create(context, settingsOf(track), bpm, env);
      return {
        input: node.input,
        output: node.output,
        update: (next, nextBpm, time) => node.update(settingsOf(next), nextBpm, time),
        reduction: node.reduction ? () => node.reduction?.() ?? 0 : undefined,
        dispose: () => node.dispose(),
      };
    },
    structureKey: (track) => structureKey(settingsOf(track)),
  };
}

/** 트랙의 이펙트 종류별 만들기. 슬롯 구조는 종류를 몰라도 이 표만 보고 동작한다. */
export const EFFECT_KINDS: Record<EffectSlotType, EffectKind> = {
  eq: kind((track) => track.eq, (context, settings) => createEq5Band(context, settings)),
  comp: kind((track) => track.compressor, (context, settings) => createCompressor(context, settings)),
  delay: kind((track) => track.delay, (context, settings, bpm) => createDelay(context, settings, bpm), delayStructureKey),
  reverb: kind((track) => track.reverb, (context, settings, _bpm, env) => createReverb(context, settings, { timers: env.timers, makeImpulse: env.makeImpulse })),
};
