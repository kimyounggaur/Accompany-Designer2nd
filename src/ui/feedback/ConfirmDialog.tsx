import { useEffect, useRef } from "react";
import { useDialogStore } from "../../state/dialogStore";

/** 브라우저 기본 확인창 대신 쓰는 확인창. 되돌리기 어려운 작업(danger)은 취소 단추에 초점을 둔다. */
export function ConfirmDialog() {
  const request = useDialogStore((state) => state.confirm);
  const close = useDialogStore((state) => state.close);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!request && dialog.open) dialog.close();
  }, [request]);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      data-testid="confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      onCancel={(event) => {
        event.preventDefault();
        if (request) close(request.id, false);
      }}
    >
      {request && (
        <div className="confirm-dialog__body">
          <h2 id="confirm-dialog-title">{request.title}</h2>
          <p id="confirm-dialog-message">{request.message}</p>
          <div className="confirm-dialog__buttons">
            <button
              type="button"
              className="text-button"
              data-testid="confirm-cancel"
              data-autofocus={request.tone === "danger" ? "" : undefined}
              onClick={() => close(request.id, false)}
            >
              {request.cancelLabel}
            </button>
            <button
              type="button"
              className={`text-button ${request.tone === "danger" ? "danger" : "primary"}`}
              data-testid="confirm-ok"
              data-autofocus={request.tone === "danger" ? undefined : ""}
              onClick={() => close(request.id, true)}
            >
              {request.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
