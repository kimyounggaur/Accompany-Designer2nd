import { create } from "zustand";

/**
 * 화면 낭독기에게만 읽어 주는 짧은 안내의 저장소(설계 P6-2). 눈에는 보이지 않는다(ui/feedback/LiveAnnouncer).
 * 토스트·상태 줄은 눈으로 보는 안내이고, 이쪽은 "재생 중", "클립 시작 2.50초"처럼 조작 결과를 소리로만 알려 준다.
 *
 * 같은 문구가 연달아 와도 다시 읽히도록 번호(`seq`)를 올린다: 낭독기는 글자가 바뀌어야 읽기 때문이다.
 */
interface AnnounceStore {
  message: string;
  seq: number;
  announce: (message: string) => void;
  reset: () => void;
}

export const useAnnounceStore = create<AnnounceStore>((set) => ({
  message: "",
  seq: 0,
  announce: (message) => set((state) => ({ message, seq: state.seq + 1 })),
  reset: () => set({ message: "", seq: 0 }),
}));
