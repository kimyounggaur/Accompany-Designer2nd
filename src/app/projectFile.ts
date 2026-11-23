import { audioEngine } from "../audio/currentEngine";
import { createWaveformPeaks } from "../audio/waveformPeaks";
import type { AssetMeta } from "../domain/types";
import { ko } from "../i18n/ko";
import { notify, notifyError } from "../services/notify";
import { setPeaks } from "../services/peaksCache";
import { exportProject } from "../services/persistence/projectFile";
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

/** 프로젝트를 .json 파일로 내려받는다(Ctrl+S, 파일 메뉴, 자동 저장 실패 안내의 단추가 모두 이 함수를 쓴다). */
export async function saveProjectFile(): Promise<void> {
  try {
    const project = getProjectSnapshot();
    const blob = await exportProject(project);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[\\/:*?"<>|\s]+/g, "-").toLowerCase() || "project"}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("success", ko.notice.projectSaved);
  } catch (error) {
    notifyError(error, { kind: "generic", title: ko.failed.projectSave });
  }
}
