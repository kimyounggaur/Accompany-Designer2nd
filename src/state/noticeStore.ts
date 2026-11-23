import { create } from "zustand";

/**
 * 사용자 안내 통로의 저장소.
 *  - 오류·경고·완료: 토스트로 보인다(오류는 닫을 때까지).
 *  - 정보: 아래 상태 줄에만 보인다.
 *  - 모든 안내의 가장 최근 문구는 상태 줄에 남는다.
 * 같은 안내가 연달아 오면 새로 띄우지 않고 횟수(×3)만 올린다.
 */
export type NoticeLevel = "error" | "warning" | "success" | "info";

export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface Notice {
  id: number;
  level: Exclude<NoticeLevel, "info">;
  message: string;
  count: number;
  /** 같은 안내가 다시 올 때마다 오른다. 자동으로 닫히는 시간을 다시 재는 신호로 쓴다. */
  stamp: number;
  action?: NoticeAction;
}

/** 토스트가 자동으로 닫히는 시간(ms). null이면 사용자가 닫을 때까지 남는다. */
export const NOTICE_DURATION_MS: Record<Exclude<NoticeLevel, "info">, number | null> = {
  error: null,
  warning: 8000,
  success: 3000,
};

export const DEFAULT_STATUS_MESSAGE = "오디오 파일을 업로드하면 첫 트랙에 클립이 생성됩니다.";
const MAX_TOASTS = 5;

interface NoticeStore {
  notices: Notice[];
  statusMessage: string;
  push: (level: NoticeLevel, message: string, options?: { action?: NoticeAction }) => void;
  dismiss: (id: number) => void;
  reset: () => void;
}

let nextId = 1;
let nextStamp = 1;

export const useNoticeStore = create<NoticeStore>((set) => ({
  notices: [],
  statusMessage: DEFAULT_STATUS_MESSAGE,
  push: (level, message, options) =>
    set((state) => {
      if (level === "info") return { statusMessage: message };

      const last = state.notices[state.notices.length - 1];
      if (last && last.level === level && last.message === message) {
        const merged = { ...last, count: last.count + 1, stamp: nextStamp++ };
        return { notices: [...state.notices.slice(0, -1), merged], statusMessage: message };
      }

      const notice: Notice = { id: nextId++, level, message, count: 1, stamp: nextStamp++, action: options?.action };
      return { notices: [...state.notices, notice].slice(-MAX_TOASTS), statusMessage: message };
    }),
  dismiss: (id) => set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })),
  reset: () => set({ notices: [], statusMessage: DEFAULT_STATUS_MESSAGE }),
}));
