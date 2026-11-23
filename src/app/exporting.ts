import { audioEngine } from "../audio/currentEngine";
import { isMixCancelled } from "../audio/engine/mixErrors";
import { planMixRender, type MixPlanResult } from "../audio/engine/mixPlan";
import { renderOfflineMix, type MixRenderRequest, type RenderedMix } from "../audio/engine/OfflineRenderer";
import { encodeWavInWorker, type WavEncoder } from "../audio/engine/wavWorkerClient";
import type { ExportOptions } from "../domain/export/exportOptions";
import { ko } from "../i18n/ko";
import { notify, notifyError } from "../services/notify";
import { readExportOptions, writeExportOptions } from "../services/exportSettings";
import { useExportStore, isExportOpen } from "../state/exportStore";
import { isRecordingBusy } from "../state/recordingStore";
import type { ProjectDoc } from "../domain/types";
import { getProjectSnapshot } from "./projectSnapshot";

/**
 * 믹스 WAV 내보내기의 흐름(P3-6): 대화상자 열기 → 옵션 고르기 → 오프라인 렌더(진행률·취소) → Worker에서 WAV 만들기 → 내려받기.
 * 소리를 만드는 일은 `audio/engine/OfflineRenderer`, 화면은 `ui/feedback/ExportDialog`, 상태는 `state/exportStore`가 맡고
 * 이 파일은 그 셋을 잇기만 한다. 바깥 일(스냅샷·렌더·인코딩·내려받기)은 `ExportDeps`로 받아서 단위 시험에서 바꿔 끼운다.
 */
export interface ExportDeps {
  snapshot: () => ProjectDoc;
  hasAudio: (assetId: string) => boolean;
  getBuffer: (assetId: string) => AudioBuffer | undefined;
  render: (request: MixRenderRequest) => Promise<RenderedMix>;
  encode: WavEncoder;
  download: (blob: Blob, fileName: string) => void;
}

const defaultDeps: ExportDeps = {
  snapshot: getProjectSnapshot,
  hasAudio: (assetId) => audioEngine.getBuffer(assetId) !== undefined,
  getBuffer: (assetId) => audioEngine.getBuffer(assetId),
  render: (request) => renderOfflineMix(request),
  encode: encodeWavInWorker,
  download: downloadBlob,
};

let running: AbortController | undefined;

/** 내려받을 파일 이름: "프로젝트 이름-mix.wav"(이름에서 파일에 못 쓰는 글자와 공백은 "-"로) */
export function mixFileName(projectName: string): string {
  return `${projectName.replace(/[\\/:*?"<>|\s]+/g, "-") || "project"}-mix.wav`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 내보낼 수 없는 이유를 알린다 */
function notifyUnavailable(result: Extract<MixPlanResult, { ok: false }>): void {
  if (result.reason === "no-clips") notify("warning", ko.notice.exportNoClips);
  else if (result.reason === "missing-audio") notify("error", ko.notice.exportMissingAudio(result.missing));
  else notify("warning", ko.notice.exportTooLong);
}

/** 지금 문서를 `options`로 내보낸다면 얼마나 길고 큰지(대화상자가 보인다). 내보낼 수 없으면 그 이유. */
export function planCurrentExport(options: ExportOptions, deps: Pick<ExportDeps, "snapshot" | "hasAudio"> = defaultDeps): MixPlanResult {
  return planMixRender(deps.snapshot(), deps.hasAudio, options);
}

/** 파일 메뉴의 "완성 믹스 WAV 내보내기": 내보낼 수 있으면 옵션 대화상자를 열고, 아니면 이유를 알린다. */
export function openExportDialog(deps: Pick<ExportDeps, "snapshot" | "hasAudio"> = defaultDeps): void {
  if (isRecordingBusy()) {
    notify("info", ko.notice.exportLockedWhileRecording);
    return;
  }
  if (isExportOpen()) return;
  const project = deps.snapshot();
  const options = readExportOptions(project.sampleRate);
  const result = planMixRender(project, deps.hasAudio, options);
  if (!result.ok) {
    notifyUnavailable(result);
    return;
  }
  useExportStore.getState().open(options);
}

/** 대화상자에서 옵션을 바꾼다(길이·크기 안내가 따라 바뀐다) */
export function setExportOptions(options: ExportOptions): void {
  if (useExportStore.getState().stage === "options") useExportStore.getState().setOptions(options);
}

/** "내보내기" 단추: 렌더 → 인코딩 → 내려받기. 끝나면(성공·취소·실패 모두) 대화상자를 닫는다. */
export async function startExport(deps: ExportDeps = defaultDeps): Promise<void> {
  const store = useExportStore.getState();
  if (store.stage !== "options" || running) return;
  const project = deps.snapshot();
  const options = store.options;
  const result = planMixRender(project, deps.hasAudio, options);
  if (!result.ok) {
    store.close();
    notifyUnavailable(result);
    return;
  }
  writeExportOptions(options);
  const abort = new AbortController();
  running = abort;
  store.start();
  try {
    const mix = await deps.render({
      project,
      plan: result.plan,
      getBuffer: deps.getBuffer,
      onProgress: (fraction) => useExportStore.getState().setProgress(fraction),
      signal: abort.signal,
    });
    useExportStore.getState().setStage("encoding");
    const blob = await deps.encode(mix.channels, mix.sampleRate, options.bitDepth, abort.signal);
    if (abort.signal.aborted) {
      notify("info", ko.notice.mixCancelled);
      return;
    }
    deps.download(blob, mixFileName(project.name));
    notify("success", ko.notice.mixSaved);
  } catch (error) {
    if (isMixCancelled(error)) notify("info", ko.notice.mixCancelled);
    else notifyError(error, { kind: "generic", title: ko.failed.mixSave });
  } finally {
    if (running === abort) running = undefined;
    useExportStore.getState().close();
  }
}

/** "취소" 단추: 옵션을 고르는 중이면 그냥 닫고, 렌더·인코딩 중이면 멈추고 버린다(파일은 만들어지지 않는다). */
export function cancelExport(): void {
  const store = useExportStore.getState();
  if (!store.stage) return;
  if (store.stage === "options" || !running) {
    store.close();
    return;
  }
  store.markCancelling();
  running.abort();
}

/** 시험·화면 정리용: 진행 중인 내보내기를 멈추고 대화상자를 닫는다 */
export function resetExport(): void {
  running?.abort();
  running = undefined;
  useExportStore.getState().close();
}
