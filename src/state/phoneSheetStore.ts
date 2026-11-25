import { create } from "zustand";

/** 휴대폰 "재생·녹음" 모드의 아래 시트(트랙 볼륨·음소거·녹음 설정)가 열려 있는가. 상단 바의 단추와 시트가 같이 쓴다. */
interface PhoneSheetStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const usePhoneSheetStore = create<PhoneSheetStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
