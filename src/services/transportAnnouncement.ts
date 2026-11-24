import { ko } from "../i18n/ko";
import type { RecordingStatus } from "../state/recordingStore";

/** 재생·녹음 상태 한 장면 */
export interface TransportSnapshot {
  playing: boolean;
  recording: RecordingStatus;
}

/**
 * 상태가 `before` → `after`로 바뀌었을 때 화면 낭독기에게 읽어 줄 문구(설계 P6-2). 읽을 것이 없으면 undefined.
 *  - 녹음 단계가 바뀌었으면 녹음 문구만 읽는다. 녹음은 재생을 함께 시작하고 끝내므로 "재생 중"이 겹쳐 읽히지 않게 한다.
 *  - 녹음 준비·마무리 단계(`preparing`·`stopping`)는 읽지 않는다: 곧 다음 단계가 읽힌다. 준비 중에 실패해 곧바로 처음으로
 *    돌아간 경우는 오류 토스트가 알리므로 "녹음 멈춤"을 읽지 않는다.
 *  - 녹음 중에 재생만 바뀐 것은 읽지 않는다.
 */
export function transportAnnouncement(before: TransportSnapshot, after: TransportSnapshot): string | undefined {
  const text = ko.announce;
  if (before.recording !== after.recording) {
    switch (after.recording) {
      case "counting-in":
        return text.countingIn;
      case "recording":
        return text.recording;
      case "idle":
        return before.recording === "preparing" ? undefined : text.recordingStopped;
      default:
        return undefined;
    }
  }
  if (after.recording !== "idle") return undefined;
  if (before.playing !== after.playing) return after.playing ? text.playing : text.stopped;
  return undefined;
}
