import type { CompressorSettings } from "../../domain/types";
import { smooth, type EffectNode } from "./EffectNode";

export function createCompressor(context: BaseAudioContext, settings: CompressorSettings): EffectNode<CompressorSettings> {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = settings.threshold;
  compressor.ratio.value = settings.ratio;
  compressor.attack.value = settings.attack;
  compressor.release.value = settings.release;

  return {
    input: compressor,
    output: compressor,
    update(next, _bpm, time) {
      smooth(compressor.threshold, next.threshold, time);
      smooth(compressor.ratio, next.ratio, time);
      smooth(compressor.attack, next.attack, time);
      smooth(compressor.release, next.release, time);
    },
    tailSeconds: () => 0,
    reduction: () => {
      // 브라우저가 돌려주는 값은 숫자이고, 아주 오래된 구현은 값 속성이 있는 객체였다.
      const value = compressor.reduction as unknown;
      return typeof value === "number" ? value : ((value as { value?: number } | undefined)?.value ?? 0);
    },
    dispose() {
      compressor.disconnect();
    },
  };
}
