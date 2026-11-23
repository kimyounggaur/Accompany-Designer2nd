import { create } from "zustand";

/**
 * 음원 다시 연결 대화상자의 상태(P4-2). 프로젝트 문서가 아니다.
 *
 * 열 때 데이터가 빠져 있던 음원들을 `items`에 붙들어 둔다(연결한 뒤에도 줄이 사라지지 않고 "연결했습니다"로 바뀐다).
 * 줄마다 상태는 `rows`에 있다:
 *   waiting → (파일을 고르면) checking → linked(같은 파일) | confirm(이름·길이가 비슷 → 확인) | different(다른 파일) | failed(읽을 수 없음)
 */
export interface RelinkItem {
  assetId: string;
  fileName: string;
  duration: number;
  clipCount: number;
}

export type RelinkRow =
  | { kind: "waiting" }
  | { kind: "checking" }
  /** 해시가 같다고 확인되어 연결했다 */
  | { kind: "linked"; sameFile: boolean }
  /** 이름이 같고 길이가 비슷하다. 사용자가 확인하면 연결한다. */
  | { kind: "confirm"; fileName: string; duration: number }
  | { kind: "different"; reason: "length" | "name"; actualDuration: number }
  | { kind: "failed"; fileName: string };

interface RelinkState {
  open: boolean;
  items: RelinkItem[];
  rows: Record<string, RelinkRow>;
  show: (items: RelinkItem[]) => void;
  setRow: (assetId: string, row: RelinkRow) => void;
  hide: () => void;
}

export const useRelinkStore = create<RelinkState>((set) => ({
  open: false,
  items: [],
  rows: {},
  show: (items) => set({ open: true, items, rows: Object.fromEntries(items.map((item) => [item.assetId, { kind: "waiting" } as RelinkRow])) }),
  setRow: (assetId, row) => set((state) => ({ rows: { ...state.rows, [assetId]: row } })),
  hide: () => set({ open: false }),
}));

/** 재연결 대화상자가 열려 있는가(단축키·재생 같은 다른 동작을 막을 때 본다) */
export function isRelinkOpen(): boolean {
  return useRelinkStore.getState().open;
}
