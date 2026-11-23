import { audioEngine } from "../audio/currentEngine";
import { findMissingByHash, listMissingAssets } from "../domain/project/relink";
import type { Clip } from "../domain/types";
import { ko } from "../i18n/ko";
import { attachAudio, readAudioFile, type DecodedUpload } from "../services/importer";
import { notify, notifyError } from "../services/notify";
import { setPeaks } from "../services/peaksCache";
import { hasRememberedAudio, rememberAudio } from "../services/persistence/audioBlobs";
import { useDawStore } from "../store/useDawStore";
import { createId } from "../utils/audioMath";
import { requestAutosave } from "./autosaveControl";
import { getProjectSnapshot } from "./projectSnapshot";

/** 소리 엔진으로 파일을 푼다(`services/importer`에 넘기는 풀기 함수). 풀면 소리는 임시 음원 id로 엔진에 올라간다. */
export async function decodeUpload(file: File): Promise<DecodedUpload> {
  const { asset, buffer, peaks } = await audioEngine.decodeFile(file);
  return {
    asset,
    peaks,
    registerAs: (assetId) => audioEngine.registerBuffer(assetId, buffer),
    release: () => audioEngine.removeBuffer(asset.id),
  };
}

/** 가져오기에 끼우는 부품(시험에서는 가짜로 바꾼다) */
export interface ImportDeps {
  decode: (file: File) => Promise<DecodedUpload>;
}

const defaultDeps: ImportDeps = { decode: decodeUpload };

/**
 * 파일 메뉴의 "오디오 업로드": 파일마다 소리를 풀어 새 음원과 클립을 만든다.
 * 이미 프로젝트에 있었지만 데이터가 빠진 음원과 해시가 같은 파일이면(같은 파일) 새 클립을 만들지 않고 그 음원에 다시 연결한다.
 * (이름·길이만 비슷한 파일은 새 음원이다. 그런 파일은 "음원 다시 연결" 대화상자에서 확인한 뒤 연결한다.)
 */
export async function importAudioFiles(files: FileList | File[], deps: ImportDeps = defaultDeps): Promise<void> {
  const fileArray = Array.from(files);
  if (!fileArray.length) return;

  notify("info", ko.notice.decoding(fileArray.length));
  let uploaded = 0;

  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i];
    try {
      const read = await readAudioFile(file, deps.decode);
      const store = useDawStore.getState();

      const same = findMissingByHash(listMissingAssets(getProjectSnapshot(), hasRememberedAudio), read.hash);
      if (same.length) {
        let clipCount = 0;
        for (const { asset, clipCount: count } of same) {
          store.updateAudioAsset(asset.id, attachAudio(asset, file, read), { history: false });
          clipCount += count;
        }
        requestAutosave(); // 문서가 그대로여도 저장할 음원 데이터가 늘었다
        notify("success", ko.notice.relinkedClips(file.name, clipCount));
        uploaded += 1;
        continue;
      }

      const { asset, peaks } = read;
      const state = useDawStore.getState();
      const startTime = state.playhead;
      const selected = state.tracks.find((track) => track.id === state.selectedTrackId);
      let targetTrack = selected ?? state.tracks[0];
      const overlaps = (track: typeof targetTrack) =>
        track.clips.some((clip) => clip.startTime < startTime + asset.duration && clip.startTime + clip.duration > startTime);
      if (!targetTrack || overlaps(targetTrack)) {
        state.addTrack();
        const allTracks = useDawStore.getState().tracks;
        targetTrack = allTracks[allTracks.length - 1];
      }

      const clip: Clip = {
        id: createId("clip"),
        audioBufferId: asset.id,
        name: asset.fileName,
        trackId: targetTrack.id,
        startTime,
        offset: 0,
        duration: asset.duration,
        sourceBpm: state.bpm,
        stretchMode: "none",
        gain: 1,
        fadeIn: 0,
        fadeOut: 0,
        fadeCurve: "equalPower",
        muted: false,
      };

      rememberAudio(asset.id, file);
      setPeaks(asset.id, peaks);
      state.addAudioAsset(asset);
      state.addClip(targetTrack.id, clip);
      uploaded += 1;
      if (fileArray.length > 1) notify("info", ko.notice.uploadProgress(i + 1, fileArray.length, asset.fileName));
      else notify("success", ko.notice.uploadDone(asset.fileName));
    } catch (error) {
      notifyError(error, { kind: "decode", title: ko.failed.decode(file.name), fileName: file.name });
    }
  }

  if (fileArray.length > 1) {
    if (uploaded === fileArray.length) notify("success", ko.notice.uploadAllDone(fileArray.length));
    else if (uploaded > 0) notify("warning", ko.notice.uploadPartial(fileArray.length, uploaded));
  }
}
