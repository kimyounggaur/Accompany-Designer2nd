import type { EqSettings } from "../../domain/types";
import { smooth, type EffectNode } from "./EffectNode";

/** 5밴드 이퀄라이저: 낮은음 선반 → 중저음 → 중고음 → 높은음 선반 → 프레즌스. 주파수는 고정이고 게인만 바뀐다. */
export function createEq5Band(context: BaseAudioContext, settings: EqSettings): EffectNode<EqSettings> {
  const bass = context.createBiquadFilter();
  const middleLow = context.createBiquadFilter();
  const middleHigh = context.createBiquadFilter();
  const high = context.createBiquadFilter();
  const presence = context.createBiquadFilter();
  bass.type = "lowshelf"; bass.frequency.value = 110;
  middleLow.type = "peaking"; middleLow.frequency.value = 360; middleLow.Q.value = 0.9;
  middleHigh.type = "peaking"; middleHigh.frequency.value = 1800; middleHigh.Q.value = 0.85;
  high.type = "highshelf"; high.frequency.value = 5600;
  presence.type = "peaking"; presence.frequency.value = 10000; presence.Q.value = 0.75;
  const bands = [bass, middleLow, middleHigh, high, presence];
  const gainsOf = (value: EqSettings) => [value.bassGain, value.middleLowGain, value.middleHighGain, value.highGain, value.presenceGain];
  gainsOf(settings).forEach((gain, index) => { bands[index].gain.value = gain; });
  bass.connect(middleLow); middleLow.connect(middleHigh); middleHigh.connect(high); high.connect(presence);

  return {
    input: bass,
    output: presence,
    update(next, _bpm, time) {
      gainsOf(next).forEach((gain, index) => smooth(bands[index].gain, gain, time));
    },
    tailSeconds: () => 0,
    dispose() {
      for (const band of bands) band.disconnect();
    },
  };
}
