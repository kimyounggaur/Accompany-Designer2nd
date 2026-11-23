import { audioEngine } from "../audio/currentEngine";
import { createWaveformPeaks } from "../audio/waveformPeaks";
import { countFixed } from "../domain/project/issues";
import type { AssetMeta } from "../domain/types";
import { ko } from "../i18n/ko";
import { confirmAction } from "../services/confirm";
import { notify, notifyError } from "../services/notify";
import { setPeaks } from "../services/peaksCache";
import { exportProjectFile, PROJECT_FILE_EXTENSION, readProjectFile, restoreAudio } from "../services/persistence/projectFile";
import { useDawStore } from "../store/useDawStore";
import { cancelRecording } from "./recording";
import { openRelinkDialog } from "./relinking";
import { getProjectSnapshot } from "./projectSnapshot";

/**
 * 저장된 음원 데이터를 소리 데이터로 풀어 둔다. 자동 복구 때도 쓰므로 소리 재생 허락(제스처)이 없어도 풀 수 있게 OfflineAudioContext를 쓴다.
 * `commit()`을 부르면 소리 엔진에 올리고 파형을 채운다(풀기만 하는 동안에는 지금 프로젝트에 영향이 없다).
 */
export async function decodeStoredAudio(blob: Blob, asset: AssetMeta): Promise<{ commit: () => void }> {
  const context = new OfflineAudioContext(1, 1, 44100);
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  const peaks = createWaveformPeaks(buffer);
  return {
    commit: () => {
      audioEngine.registerBuffer(asset.id, buffer);
      setPeaks(asset.id, peaks);
    },
  };
}

/** 프로젝트를 .adproj 파일(음원을 담은 zip)로 내려받는다(Ctrl+S, 파일 메뉴, 자동 저장 실패 안내의 단추가 모두 이 함수를 쓴다). */
export async function saveProjectFile(): Promise<void> {
  try {
    const project = getProjectSnapshot();
    const blob = await exportProjectFile(project);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[\\/:*?"<>|\s]+/g, "-").toLowerCase() || "project"}${PROJECT_FILE_EXTENSION}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("success", ko.notice.projectSaved);
  } catch (error) {
    notifyError(error, { kind: "generic", title: ko.failed.projectSave });
  }
}

/**
 * 파일 메뉴의 "프로젝트 불러오기": 파일을 읽고(.adproj·옛 JSON) → 확인받고 → 지금 프로젝트를 바꾼다.
 * 파일에 음원이 빠져 있으면 알리고 "음원 다시 연결" 대화상자를 연다.
 */
export async function loadProjectFile(file: File): Promise<void> {
  try {
    const loaded = await readProjectFile(file);
    const confirmed = await confirmAction({
      title: ko.confirm.loadProject.title,
      message: ko.confirm.loadProject.message,
      confirmLabel: ko.confirm.loadProject.confirmLabel,
      tone: "danger",
    });
    if (!confirmed) return;
    const restored = await restoreAudio(loaded, decodeStoredAudio);
    cancelRecording();
    audioEngine.stop();
    audioEngine.clearBuffers();
    restored.commit();
    useDawStore.getState().importProject(restored.doc);
    if (restored.missing) notify("warning", ko.notice.projectLoadedMissing(restored.missing));
    else notify("success", ko.notice.projectLoaded);
    const fixed = countFixed(loaded.issues);
    if (fixed) notify("info", ko.notice.valuesFixed(fixed));
    if (restored.missing) openRelinkDialog();
  } catch (error) {
    notifyError(error, { kind: "projectFile", title: ko.failed.projectLoad });
  }
}
