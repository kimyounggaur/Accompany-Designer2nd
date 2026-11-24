import { create } from "zustand";

/**
 * BPM 감지의 진행 상태(P4-4). 프로젝트 문서가 아니다. 한 번에 하나만 돌고, 어느 클립의 것인지 `clipId`로 붙들어 둔다
 * (다른 클립을 고르면 그 클립의 칸에서는 보이지 않고, 돌아오면 이어서 보인다).
 *
 *   idle → running(진행률) → done(감지값과 화면에 보이는 제안) | failed(이유) | cancelled
 */
export type BpmDetection =
  | { status: "idle" }
  | { status: "running"; clipId: string; progress: number }
  /** `value`는 화면에 보이는 제안 값이다: 감지값에서 ×½·×2로 고친 뒤의 값 */
  | { status: "done"; clipId: string; detected: number; value: number }
  | { status: "failed"; clipId: string; message: string }
  | { status: "cancelled"; clipId: string };

interface BpmState {
  detection: BpmDetection;
  set: (detection: BpmDetection) => void;
  reset: () => void;
}

export const useBpmStore = create<BpmState>((set) => ({
  detection: { status: "idle" },
  set: (detection) => set({ detection }),
  reset: () => set({ detection: { status: "idle" } }),
}));
