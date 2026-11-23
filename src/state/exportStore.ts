import { create } from "zustand";
import type { ExportOptions } from "../domain/export/exportOptions";

/**
 * 내보내기 대화상자의 상태(P3-6). 프로젝트 문서가 아니다.
 *
 *   (닫힘) → options(옵션을 고른다) → rendering(렌더 중, 취소 가능) → encoding(파일 만드는 중) → (닫힘)
 *
 * 대화상자가 열려 있는 동안은 화면이 모달이라 문서가 바뀌지 않는다. 그래서 길이·크기 안내는 열 때 한 번 계산해 두지 않고
 * 옵션이 바뀔 때마다 `app/exporting.ts`가 같은 문서로 다시 계산한다.
 */
export type ExportStage = "options" | "rendering" | "encoding";

interface ExportState {
  stage?: ExportStage;
  options: ExportOptions;
  /** 렌더 진행률 0~1 */
  progress: number;
  /** 취소를 눌렀다(렌더가 멈추기를 기다리는 동안) */
  cancelling: boolean;
  open: (options: ExportOptions) => void;
  setOptions: (options: ExportOptions) => void;
  start: () => void;
  setProgress: (progress: number) => void;
  setStage: (stage: ExportStage) => void;
  markCancelling: () => void;
  close: () => void;
}

export const useExportStore = create<ExportState>((set) => ({
  stage: undefined,
  options: { sampleRate: 44100, bitDepth: 16 },
  progress: 0,
  cancelling: false,
  open: (options) => set({ stage: "options", options, progress: 0, cancelling: false }),
  setOptions: (options) => set({ options }),
  start: () => set({ stage: "rendering", progress: 0, cancelling: false }),
  setProgress: (progress) => set({ progress: Math.min(1, Math.max(0, progress)) }),
  setStage: (stage) => set({ stage }),
  markCancelling: () => set({ cancelling: true }),
  close: () => set({ stage: undefined, progress: 0, cancelling: false }),
}));

/** 내보내기 대화상자가 열려 있는가(단축키·재생 같은 다른 동작을 막을 때 본다) */
export function isExportOpen(): boolean {
  return useExportStore.getState().stage !== undefined;
}
