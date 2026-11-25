import { audioEngine } from "../audio/currentEngine";
import { findMissingByHash, listMissingAssets } from "../domain/project/relink";
import { dropRowAt, type DropPlacement } from "../domain/timeline/drop";
import type { Clip } from "../domain/types";
import { ko } from "../i18n/ko";
import { attachAudio, planUpload, readAudioFile, type DecodedUpload } from "../services/importer";
import { UploadSkipped, type UploadGuard } from "../services/memoryGuard";
import { notify, notifyError } from "../services/notify";
import { hasRememberedAudio, rememberAudio } from "../services/persistence/audioBlobs";
import { useDawStore } from "../store/useDawStore";
import { createId } from "../utils/audioMath";
import { requestAutosave } from "./autosaveControl";
import { ensurePeaks } from "./peaks";
import { readPlayhead } from "./playhead";
import { getProjectSnapshot } from "./projectSnapshot";
import { uploadGuard } from "./uploadGuard";

/** 소리 엔진으로 파일을 푼다(`services/importer`에 넘기는 풀기 함수). 풀면 소리는 임시 음원 id로 엔진에 올라간다. */
export async function decodeUpload(file: File): Promise<DecodedUpload> {
  const { asset, buffer } = await audioEngine.decodeFile(file);
  return {
    asset,
    registerAs: (assetId) => audioEngine.registerBuffer(assetId, buffer),
    release: () => audioEngine.removeBuffer(asset.id),
  };
}

/** 가져오기에 끼우는 부품(시험에서는 가짜로 바꾼다) */
export interface ImportDeps {
  decode: (file: File) => Promise<DecodedUpload>;
  /** 큰 음원 검사(P6-4). 없으면 검사하지 않는다(시험이 가짜 풀기만 끼울 때). */
  guard?: UploadGuard;
}

/** 화면에서 쓰는 기본 부품: 소리 엔진으로 풀고, 큰 음원을 묻거나 막는다 */
export const defaultImportDeps: ImportDeps = { decode: decodeUpload, guard: uploadGuard };

const defaultDeps = defaultImportDeps;

/**
 * 파일 메뉴의 "오디오 업로드": 파일마다 소리를 풀어 새 음원과 클립을 만든다.
 * 이미 프로젝트에 있었지만 데이터가 빠진 음원과 해시가 같은 파일이면(같은 파일) 새 클립을 만들지 않고 그 음원에 다시 연결한다.
 * (이름·길이만 비슷한 파일은 새 음원이다. 그런 파일은 "음원 다시 연결" 대화상자에서 확인한 뒤 연결한다.)
 */
export function importAudioFiles(files: FileList | File[], deps: ImportDeps = defaultDeps): Promise<void> {
  return importFiles(files, deps);
}

/**
 * 타임라인에 끌어다 놓은 파일(P5-5): 올리는 일은 `importAudioFiles`와 같고, 클립을 놓는 자리만 다르다.
 * 놓은 곳의 트랙·시간(`placement`, 스냅 적용됨)에 놓고, 파일이 여럿이면 그 트랙부터 차례로 아래 트랙에 같은 시간으로 놓는다.
 * 트랙 아래 빈 곳에 놓았거나 트랙이 모자라면 새 트랙을 만든다.
 */
export function importDroppedFiles(files: FileList | File[], placement: DropPlacement, deps: ImportDeps = defaultDeps): Promise<void> {
  return importFiles(files, deps, placement);
}

async function importFiles(files: FileList | File[], deps: ImportDeps, drop?: DropPlacement): Promise<void> {
  const fileArray = Array.from(files);
  if (!fileArray.length) return;

  notify("info", ko.notice.decoding(fileArray.length));
  let uploaded = 0;
  /** 끌어다 놓기에서, 지금까지 새 클립을 놓은 파일 수(다음 파일이 갈 트랙 칸을 정한다) */
  let placed = 0;

  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i];
    try {
      const read = await readAudioFile(file, deps.decode, deps.guard);
      const store = useDawStore.getState();

      const same = findMissingByHash(listMissingAssets(getProjectSnapshot(), hasRememberedAudio), read.hash);
      if (same.length) {
        let clipCount = 0;
        for (const { asset, clipCount: count } of same) {
          store.updateAudioAsset(asset.id, attachAudio(asset, file, read), { history: false });
          void ensurePeaks({ id: asset.id, hash: read.hash });
          clipCount += count;
        }
        requestAutosave(); // 문서가 그대로여도 저장할 음원 데이터가 늘었다
        notify("success", ko.notice.relinkedClips(file.name, clipCount));
        uploaded += 1;
        continue;
      }

      const { asset } = read;
      const state = useDawStore.getState();
      // 어느 트랙에 놓을지는 배치 규칙이 정한다(선택한 트랙의 그 구간이 비어 있으면 그 트랙, 아니면 새 트랙. 겹침은 템포 맞춤을 반영한 길이로 본다).
      // 끌어다 놓은 파일은 사용자가 고른 자리(트랙·시간)에 그대로 놓는다.
      const plan = planUpload(getProjectSnapshot(), asset, {
        clipId: createId("clip"),
        startTime: drop ? drop.time : readPlayhead(),
        selectedTrackId: state.selectedTrackId,
      });
      let trackId: string;
      if (drop) {
        const row = dropRowAt(drop, placed);
        while (useDawStore.getState().tracks.length <= row) useDawStore.getState().addTrack();
        trackId = useDawStore.getState().tracks[row].id;
      } else if ("trackId" in plan.target) {
        trackId = plan.target.trackId;
      } else {
        state.addTrack();
        const allTracks = useDawStore.getState().tracks;
        trackId = allTracks[allTracks.length - 1].id;
      }
      const clip: Clip = { ...plan.clip, trackId };

      rememberAudio(asset.id, file);
      state.addAudioAsset(asset);
      state.addClip(trackId, clip);
      void ensurePeaks(asset); // 파형은 Worker가 만든다. 끝나면 저절로 그려진다.
      uploaded += 1;
      placed += 1;
      if (fileArray.length > 1) notify("info", ko.notice.uploadProgress(i + 1, fileArray.length, asset.fileName));
      else notify("success", ko.notice.uploadDone(asset.fileName));
    } catch (error) {
      if (error instanceof UploadSkipped) {
        // 큰 음원을 올리지 않기로 했거나 막았다(P6-4): 오류가 아니다. 이유는 묻는 창에서 이미 알렸다.
        notify("info", ko.memory.skipped(file.name));
        continue;
      }
      notifyError(error, { kind: "decode", title: ko.failed.decode(file.name), fileName: file.name });
    }
  }

  if (fileArray.length > 1) {
    if (uploaded === fileArray.length) notify("success", ko.notice.uploadAllDone(fileArray.length));
    else if (uploaded > 0) notify("warning", ko.notice.uploadPartial(fileArray.length, uploaded));
  }
}
