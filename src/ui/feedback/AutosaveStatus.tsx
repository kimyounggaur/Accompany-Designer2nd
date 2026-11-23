import { ko } from "../../i18n/ko";
import { formatClock } from "../../services/persistence/projectRecord";
import { useAutosaveStore } from "../../state/autosaveStore";

/** 아래 상태 줄 오른쪽의 자동 저장 표시: "저장 중…" · "자동 저장됨 02:41" · "자동 저장 실패". 아무 일도 없었으면 비어 있다. */
export function AutosaveStatus() {
  const status = useAutosaveStore((state) => state.status);
  const text =
    status.state === "saving"
      ? ko.autosave.saving
      : status.state === "saved"
        ? ko.autosave.saved(formatClock(status.savedAt))
        : status.state === "failed"
          ? ko.autosave.failed
          : "";
  return (
    <p className="autosave-status" role="status" aria-label={ko.autosave.regionLabel} data-testid="autosave-status" data-state={status.state}>
      {text}
    </p>
  );
}
