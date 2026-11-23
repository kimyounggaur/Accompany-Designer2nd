/**
 * 녹음 컨트롤러가 스토어·프로젝트 문서·안내에 하는 일(P3-5). 소리 엔진은 모른다 — 엔진 쪽 연결은 `app/recording.ts`가 한다.
 * 그래서 단위 시험이 가짜 엔진·가짜 녹음기를 끼우고도 진짜 스토어와 문서 명령을 거쳐 "녹음 한 번 = 문서 변경 한 번"을 확인할 수 있다.
 */
import type { RecordingEvent, RecordingHost } from "../audio/recording/RecordingController";
import { ko } from "../i18n/ko";
import { notify, notifyError } from "../services/notify";
import * as commands from "../state/commands/index";
import { useRecordingStore } from "../state/recordingStore";
import { getDoc } from "../state/projectStore";
import { rememberAudio } from "../services/persistence/audioBlobs";
import { useDawStore } from "../store/useDawStore";
import { createId } from "../utils/audioMath";

/** 녹음 파일 이름: 문서에 있는 녹음 음원 수 + 1 ("녹음 001.wav") */
function nextFileName(): string {
  const count = Object.values(getDoc().assets).filter((asset) => asset.source === "recording").length + 1;
  return `녹음 ${String(count).padStart(3, "0")}.wav`;
}

export function announceRecordingEvent(event: RecordingEvent): void {
  const text = ko.notice;
  switch (event.type) {
    case "countIn":
      notify("info", text.countInStarted(event.remaining));
      break;
    case "countInCancelled":
      notify("info", text.countInCancelled);
      break;
    case "started":
      notify("info", text.recordingNow(event.fileName));
      break;
    case "saving":
      notify("info", text.recordingSaving(event.fileName));
      break;
    case "saved":
      notify("success", text.recordingDone(event.fileName));
      break;
    case "empty":
      notify("warning", text.recordingEmpty);
      break;
  }
}

export const recordingHost: RecordingHost = {
  settings: () => {
    const { armedTrackId, inputDeviceId, monitoringEnabled, metronomeEnabled, countInBeats, latencyOffsetMs } =
      useRecordingStore.getState();
    return { armedTrackId, inputDeviceId, monitoringEnabled, metronomeEnabled, countInBeats, latencyOffsetMs };
  },
  bpm: () => getDoc().bpm,
  playhead: () => useDawStore.getState().playhead,
  update: (patch) => useRecordingStore.getState().setProgress(patch),
  reset: () => useRecordingStore.getState().resetProgress(),
  setPlaying: (playing) => useDawStore.getState().setIsPlaying(playing),
  setPlayhead: (position) => useDawStore.getState().setPlayhead(position),
  chooseTrack: () => {
    const doc = getDoc();
    const { armedTrackId } = useRecordingStore.getState();
    const target = doc.tracks.find((track) => track.id === armedTrackId) ?? doc.tracks.find((track) => track.clips.length === 0);
    if (target) return { trackId: target.id, created: false };
    // 녹음 대기 트랙도 빈 트랙도 없으면 새 트랙에 녹음한다. 녹음을 취소하면 거두므로 이력에는 남기지 않는다.
    return { trackId: commands.addTrack({ record: false }).id, created: true };
  },
  discardTrack: (trackId) => {
    const track = getDoc().tracks.find((item) => item.id === trackId);
    if (track && track.clips.length === 0) commands.removeTrack(trackId, { record: false });
  },
  nextFileName,
  newId: (prefix) => createId(prefix),
  commit: (recording) => {
    // 음원과 클립을 한 번에 넣는다: 실행 취소 1단계("녹음 추가").
    const trackId = commands.addRecording({
      trackId: recording.trackId,
      asset: recording.asset,
      clipId: recording.clipId,
      startTime: recording.startTime,
      trim: recording.trim,
      bpm: recording.bpm,
    });
    useDawStore.setState({ selectedTrackId: trackId, selectedClipId: recording.clipId, selectedClipIds: [recording.clipId] });
  },
  remember: (assetId, blob) => rememberAudio(assetId, blob),
  event: announceRecordingEvent,
  fail: (error, stage) =>
    notifyError(error, stage === "start" ? { kind: "microphone", title: ko.failed.recordStart } : { kind: "generic", title: ko.failed.recordSave }),
};
