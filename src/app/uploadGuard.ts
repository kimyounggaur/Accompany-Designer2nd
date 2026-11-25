import { audioEngine } from "../audio/currentEngine";
import { limitsFor, type MemoryLimits } from "../domain/memory/budget";
import { confirmAction } from "../services/confirm";
import { createUploadGuard } from "../services/memoryGuard";

/** 소리 장치를 아직 열지 않았을 때 풀린 크기를 어림하는 샘플레이트(실제 장치는 보통 44.1kHz 또는 48kHz이므로 큰 쪽) */
const ASSUMED_OUTPUT_RATE = 48_000;

/** 이 기기에 맞는 메모리 기준(설계서 §P6-4): 메모리 4GB 이하로 알려졌거나 화면 폭이 768px 미만이면 휴대폰 기준 */
export function deviceMemoryLimits(): Readonly<MemoryLimits> {
  const deviceMemory = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const width = typeof window === "undefined" || typeof window.innerWidth !== "number" ? Number.POSITIVE_INFINITY : window.innerWidth;
  return limitsFor({ deviceMemory, width });
}

/** 파일을 올릴 때 쓰는 메모리 검사: 올린 소리 전체의 크기는 소리 엔진에서 읽고, 묻는 창은 앱의 확인창을 쓴다. */
export const uploadGuard = createUploadGuard({
  usedBytes: () => audioEngine.getDecodedBytes(),
  outputRate: () => audioEngine.getOutputSampleRate() ?? ASSUMED_OUTPUT_RATE,
  limits: deviceMemoryLimits,
  ask: (options) => confirmAction(options),
  inform: async (options) => {
    await confirmAction({ ...options, cancelLabel: options.confirmLabel, showCancel: false });
  },
});
