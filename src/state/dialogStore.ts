import { create } from "zustand";

export interface ConfirmRequest {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** danger: 되돌리기 어려운 작업. 취소 단추에 초점을 둔다. */
  tone: "default" | "danger";
  resolve: (confirmed: boolean) => void;
}

interface DialogStore {
  confirm?: ConfirmRequest;
  open: (request: ConfirmRequest) => void;
  close: (id: number, confirmed: boolean) => void;
}

export const useDialogStore = create<DialogStore>((set, get) => ({
  confirm: undefined,
  open: (request) => {
    // 이미 열린 확인창이 있으면 취소로 닫고 새 요청을 연다.
    get().confirm?.resolve(false);
    set({ confirm: request });
  },
  close: (id, confirmed) => {
    const current = get().confirm;
    if (!current || current.id !== id) return;
    set({ confirm: undefined });
    current.resolve(confirmed);
  },
}));
