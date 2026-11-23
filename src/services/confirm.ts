import { useDialogStore } from "../state/dialogStore";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

let nextId = 1;

/** 브라우저 기본 확인창 대신 쓰는 앱 안의 확인창. 확인하면 true, 취소·Esc면 false로 끝난다. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().open({
      id: nextId++,
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? "확인",
      cancelLabel: options.cancelLabel ?? "취소",
      tone: options.tone ?? "default",
      resolve,
    });
  });
}
