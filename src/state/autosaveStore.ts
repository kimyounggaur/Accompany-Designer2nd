import { create } from "zustand";

/** 자동 저장이 지금 어떤 상태인지. 상태 줄 오른쪽에 보인다("저장 중…" · "자동 저장됨 02:41" · "자동 저장 실패"). */
export type AutosaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; savedAt: number }
  | { state: "failed" };

interface AutosaveStore {
  status: AutosaveStatus;
  setStatus: (status: AutosaveStatus) => void;
  reset: () => void;
}

export const useAutosaveStore = create<AutosaveStore>((set) => ({
  status: { state: "idle" },
  setStatus: (status) => set({ status }),
  reset: () => set({ status: { state: "idle" } }),
}));
