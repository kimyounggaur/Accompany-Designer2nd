import { useEffect, useRef } from "react";
import { chooseRelinkFile, closeRelinkDialog, confirmRelinkFile, declineRelinkFile } from "../../app/relinking";
import { formatDuration } from "../../domain/export/exportFormat";
import { ko } from "../../i18n/ko";
import { useRelinkStore, type RelinkItem, type RelinkRow } from "../../state/relinkStore";

/** 줄에 보일 결과 문구(없으면 빈 글자) */
function rowMessage(item: RelinkItem, row: RelinkRow): string {
  switch (row.kind) {
    case "checking":
      return ko.relink.checking;
    case "linked":
      return row.sameFile ? ko.relink.linkedSame : ko.relink.linked;
    case "confirm":
      return ko.relink.ask(row.fileName, formatDuration(row.duration));
    case "different":
      return row.reason === "length"
        ? ko.relink.differentLength(formatDuration(item.duration), formatDuration(row.actualDuration))
        : ko.relink.differentName;
    case "failed":
      return ko.relink.failed(row.fileName);
    default:
      return "";
  }
}

/** 줄 하나: 빠진 음원의 이름·길이·쓰는 클립 수, 파일을 찾는 단추, 판정 결과 */
function RelinkRowView({ item, row, first }: { item: RelinkItem; row: RelinkRow; first: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canFind = row.kind === "waiting" || row.kind === "different" || row.kind === "failed";
  const message = rowMessage(item, row);

  return (
    <li className="relink-row" data-testid="relink-row" data-state={row.kind} aria-label={ko.relink.rowLabel(item.fileName)}>
      <div className="relink-row__info">
        <strong className="relink-row__name">{item.fileName}</strong>
        <span className="relink-row__meta">
          {ko.relink.length(formatDuration(item.duration))} · {ko.relink.clips(item.clipCount)}
        </span>
      </div>
      {message && (
        <p className="relink-row__message" role="status" data-testid="relink-message">
          {message}
        </p>
      )}
      <div className="relink-row__buttons">
        {canFind && (
          <button
            type="button"
            className="text-button"
            data-testid="relink-find"
            data-autofocus={first ? "" : undefined}
            onClick={() => inputRef.current?.click()}
          >
            {ko.relink.find}
          </button>
        )}
        {row.kind === "confirm" && (
          <>
            <button
              type="button"
              className="text-button primary"
              data-testid="relink-confirm"
              data-autofocus=""
              onClick={() => confirmRelinkFile(item.assetId)}
            >
              {ko.relink.askYes}
            </button>
            <button type="button" className="text-button" data-testid="relink-decline" onClick={() => declineRelinkFile(item.assetId)}>
              {ko.relink.askNo}
            </button>
          </>
        )}
      </div>
      {/* 숨은 입력은 단추가 없는 상태에서도 항상 렌더링한다(자동 시험이 직접 접근). */}
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a"
        hidden
        data-testid="relink-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void chooseRelinkFile(item.assetId, file);
          event.target.value = "";
        }}
      />
    </li>
  );
}

/**
 * 음원 다시 연결 대화상자(설계서 §P4-2). 프로젝트에 음원 데이터가 빠져 있으면 목록을 보이고,
 * 줄마다 [파일 찾기]로 원래 파일을 고르게 한다. 판정 규칙은 `domain/project/relink`, 동작은 `app/relinking`.
 */
export function RelinkDialog() {
  const open = useRelinkStore((state) => state.open);
  const items = useRelinkStore((state) => state.items);
  const rows = useRelinkStore((state) => state.rows);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // 확인 단추가 나타나면 초점을 그리로 옮긴다(키보드로 바로 답할 수 있게).
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('[data-testid="relink-confirm"]')?.focus();
  }, [open, rows]);

  return (
    <dialog
      ref={ref}
      className="relink-dialog"
      data-testid="relink-dialog"
      aria-labelledby="relink-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        closeRelinkDialog();
      }}
    >
      {open && (
        <div className="relink-dialog__body">
          <h2 id="relink-dialog-title">{ko.relink.title}</h2>
          <p className="relink-dialog__intro">{items.length ? ko.relink.intro(items.length) : ko.relink.none}</p>
          {items.length > 0 && (
            <ul className="relink-list" data-testid="relink-list">
              {items.map((item, index) => (
                <RelinkRowView key={item.assetId} item={item} row={rows[item.assetId] ?? { kind: "waiting" }} first={index === 0} />
              ))}
            </ul>
          )}
          <div className="relink-dialog__buttons">
            <button
              type="button"
              className="text-button"
              data-testid="relink-close"
              data-autofocus={items.length === 0 ? "" : undefined}
              onClick={() => closeRelinkDialog()}
            >
              {ko.relink.close}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
