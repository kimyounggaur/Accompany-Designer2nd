import { audioEngine } from "../audio/currentEngine";
import { AudioEngineV2 } from "../audio/engine/AudioEngine";
import { ko } from "../i18n/ko";
import { countFixed } from "../domain/project/issues";
import { notify, notifyError } from "../services/notify";
import { recallAudio } from "../services/persistence/audioBlobs";
import { loadAutosave, startAutosave } from "../services/persistence/autosave";
import { restoreAudio } from "../services/persistence/projectFile";
import { readLatencyOffsetMs, writeLatencyOffsetMs } from "../services/recordingSettings";
import { useAutosaveStore } from "../state/autosaveStore";
import { isRecordingBusy, useRecordingStore } from "../state/recordingStore";
import { useDawStore } from "../store/useDawStore";
import { registerAutosave } from "./autosaveControl";
import { connectEngineSync } from "./engineSync";
import { decodeStoredAudio, saveProjectFile } from "./projectFile";
import { getProjectSnapshot } from "./projectSnapshot";
import { consumeSkipRecover } from "./recoverFlag";
import { openRelinkDialog } from "./relinking";

/**
 * 앱이 켜질 때 한 번 하는 일: 자동 저장을 시작하고, 저장해 둔 프로젝트가 있으면 복구한다.
 * 돌려주는 함수를 부르면 모두 거둔다(화면이 사라질 때).
 *
 * 복구 규칙(예전 App.tsx와 같다):
 *  - 읽어 오는 동안 사용자가 이미 작업을 시작했다면 그 작업을 덮어쓰지 않는다.
 *  - 복구가 끝나기 전에는 저장하지 않는다(빈 프로젝트가 저장된 기록을 덮어쓰지 않도록).
 */
export function startApp(): () => void {
  let cancelled = false;
  const initial = getProjectSnapshot();

  // 녹음 지연 보정값은 이 브라우저에 기억해 두었다가 다음에 열 때 되살린다(장치마다 다른 개인 설정이라 문서에는 넣지 않는다).
  useRecordingStore.getState().setLatencyOffsetMs(readLatencyOffsetMs());
  const offLatencySync = useRecordingStore.subscribe((state, previous) => {
    if (state.latencyOffsetMs !== previous.latencyOffsetMs) writeLatencyOffsetMs(state.latencyOffsetMs);
  });

  // 문서가 바뀌면 재생 중인 소리 경로를 바뀐 부분만 맞춘다(예전 App.tsx의 schedulingSignature 효과를 대체).
  const offEngineSync = connectEngineSync(audioEngine);
  // 새 엔진(기본)은 곡 끝에 닿으면 멈추는데, 녹음하는 동안에는 멈추면 안 된다.
  if (audioEngine instanceof AudioEngineV2) {
    audioEngine.setHoldOpen(() => isRecordingBusy());
  }

  const autosave = startAutosave({
    getProject: getProjectSnapshot,
    recallAudio,
    subscribe: (listener) => useDawStore.subscribe(listener),
    isRecording: () => isRecordingBusy(),
    onRecordingIdle: (listener) =>
      useRecordingStore.subscribe((state, previous) => {
        if (previous.status !== "idle" && state.status === "idle") listener();
      }),
    exportToFile: () => void saveProjectFile(),
  });
  registerAutosave(autosave);

  const untouched = () => {
    const now = getProjectSnapshot();
    return (
      now.tracks === initial.tracks &&
      now.name === initial.name &&
      now.bpm === initial.bpm &&
      now.master === initial.master &&
      now.markers === initial.markers &&
      Object.keys(now.assets).length === 0
    );
  };

  void (async () => {
    let dirty = false;
    try {
      // 오류 안내 화면의 [저장된 작업 없이 시작]을 눌렀다면 이번 시작에는 복구하지 않는다(기록은 그대로 둔다).
      const loaded = consumeSkipRecover() ? undefined : await loadAutosave();
      if (cancelled) return;
      if (loaded && untouched()) {
        const restored = await restoreAudio(loaded.loaded, decodeStoredAudio);
        if (cancelled) return;
        if (untouched()) {
          audioEngine.clearBuffers();
          restored.commit();
          useDawStore.getState().importProject(restored.doc);
          useAutosaveStore.getState().setStatus({ state: "saved", savedAt: loaded.updatedAt });
          if (restored.missing) {
            // 시작하자마자 대화상자를 띄우지 않는다. 안내의 [다시 연결]이나 파일 메뉴에서 연다.
            notify("warning", ko.notice.autosaveRestoredMissing(restored.missing), {
              action: { label: ko.action.relink, run: openRelinkDialog },
            });
          } else notify("success", ko.notice.autosaveRestored);
          const fixed = countFixed(loaded.loaded.issues);
          if (fixed) notify("info", ko.notice.valuesFixed(fixed));
          return;
        }
      }
      dirty = !untouched();
    } catch (error) {
      dirty = !untouched();
      if (!cancelled) notifyError(error, { kind: "projectFile", title: ko.failed.autosaveRecover });
    } finally {
      // 복구를 기다리는 사이 사용자가 바꾼 내용이 있으면 이제부터 저장 대상이다.
      if (!cancelled) autosave.markReady({ dirty });
    }
  })();

  return () => {
    cancelled = true;
    registerAutosave(undefined);
    offLatencySync();
    offEngineSync();
    autosave.dispose();
  };
}
