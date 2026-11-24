import { create } from "zustand";

/**
 * 우클릭 메뉴가 열려 있는지(P5-4).
 * 메뉴가 열려 있는 동안에는 키가 메뉴에만 가야 하므로 창 전체의 단축키 처리(app/keyboard)가 이것을 읽고 비켜 선다.
 * 열린 메뉴 수를 센다: 한 메뉴가 닫히고 다른 메뉴가 열리는 순간 두 메뉴가 겹쳐 있을 수 있기 때문이다.
 */
interface MenuStore {
  openCount: number;
  opened: () => void;
  closed: () => void;
}

export const useMenuStore = create<MenuStore>((set) => ({
  openCount: 0,
  opened: () => set((state) => ({ openCount: state.openCount + 1 })),
  closed: () => set((state) => ({ openCount: Math.max(0, state.openCount - 1) })),
}));

export function isContextMenuOpen(): boolean {
  return useMenuStore.getState().openCount > 0;
}
