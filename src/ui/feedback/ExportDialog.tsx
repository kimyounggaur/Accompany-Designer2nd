import { useEffect, useRef } from "react";
import { cancelExport, planCurrentExport, setExportOptions, startExport } from "../../app/exporting";
import {
  EXPORT_BIT_DEPTHS,
  EXPORT_SAMPLE_RATES,
  type ExportBitDepth,
  type ExportSampleRate,
} from "../../domain/export/exportOptions";
import { formatBytes, formatDuration } from "../../domain/export/exportFormat";
import { ko } from "../../i18n/ko";
import { useExportStore } from "../../state/exportStore";

/**
 * 믹스 WAV 내보내기 대화상자(P3-6). 옵션을 고르고 → 진행률을 보고 → 취소할 수 있다.
 * 열려 있는 동안은 모달이라 문서를 고칠 수 없다(렌더하는 중 문서가 바뀌지 않는다).
 */
export function ExportDialog() {
  const stage = useExportStore((state) => state.stage);
  const options = useExportStore((state) => state.options);
  const progress = useExportStore((state) => state.progress);
  const cancelling = useExportStore((state) => state.cancelling);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (stage && !dialog.open) dialog.showModal();
    // 단계가 바뀌면 이전 단계의 단추가 사라지므로, 새 단계의 기본 단추로 초점을 옮긴다.
    if (stage) dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    if (!stage && dialog.open) dialog.close();
  }, [stage]);

  const plan = stage === "options" ? planCurrentExport(options) : undefined;
  const percent = Math.round(progress * 100);

  return (
    <dialog
      ref={ref}
      className="export-dialog"
      data-testid="export-dialog"
      aria-labelledby="export-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        cancelExport();
      }}
    >
      {stage && (
        <div className="export-dialog__body">
          <h2 id="export-dialog-title">{ko.exportDialog.title}</h2>
          {stage === "options" ? (
            <>
              {plan?.ok && (
                <p className="export-dialog__summary" data-testid="export-summary">
                  {ko.exportDialog.summary(formatDuration(plan.plan.durationSeconds), formatBytes(plan.plan.bytes))}
                </p>
              )}
              <fieldset className="export-dialog__group" data-testid="export-sample-rate">
                <legend>{ko.exportDialog.sampleRate}</legend>
                {EXPORT_SAMPLE_RATES.map((rate: ExportSampleRate) => (
                  <label key={rate} className="export-dialog__choice">
                    <input
                      type="radio"
                      name="export-sample-rate"
                      value={rate}
                      checked={options.sampleRate === rate}
                      onChange={() => setExportOptions({ ...options, sampleRate: rate })}
                    />
                    <span>{ko.exportDialog.sampleRateOption(rate)}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="export-dialog__group" data-testid="export-bit-depth">
                <legend>{ko.exportDialog.bitDepth}</legend>
                {EXPORT_BIT_DEPTHS.map((bits: ExportBitDepth) => (
                  <label key={bits} className="export-dialog__choice">
                    <input
                      type="radio"
                      name="export-bit-depth"
                      value={bits}
                      checked={options.bitDepth === bits}
                      onChange={() => setExportOptions({ ...options, bitDepth: bits })}
                    />
                    <span>{ko.exportDialog.bitDepthOption(bits)}</span>
                  </label>
                ))}
              </fieldset>
              <p className="export-dialog__hint">{ko.exportDialog.bitDepthHint}</p>
              <div className="export-dialog__buttons">
                <button type="button" className="text-button" data-testid="export-cancel" onClick={() => cancelExport()}>
                  {ko.exportDialog.cancel}
                </button>
                <button
                  type="button"
                  className="text-button primary"
                  data-testid="export-start"
                  data-autofocus=""
                  disabled={!plan?.ok}
                  onClick={() => void startExport()}
                >
                  {ko.exportDialog.start}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="export-dialog__status" role="status" data-testid="export-status">
                {cancelling ? ko.exportDialog.cancelling : stage === "rendering" ? ko.exportDialog.rendering : ko.exportDialog.encoding}
              </p>
              <div
                className="export-dialog__progress"
                role="progressbar"
                aria-label={ko.exportDialog.progressLabel}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={stage === "encoding" ? 100 : percent}
                data-testid="export-progress"
              >
                <div className="export-dialog__bar" style={{ width: `${stage === "encoding" ? 100 : percent}%` }} />
              </div>
              <p className="export-dialog__percent" aria-hidden="true">
                {ko.exportDialog.progress(stage === "encoding" ? 100 : percent)}
              </p>
              <div className="export-dialog__buttons">
                <button
                  type="button"
                  className="text-button"
                  data-testid="export-cancel"
                  data-autofocus=""
                  disabled={cancelling}
                  onClick={() => cancelExport()}
                >
                  {ko.exportDialog.cancel}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
