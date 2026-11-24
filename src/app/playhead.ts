/**
 * 지금 재생 위치(설계서 §P5-3).
 *
 * 스토어의 `cursor`는 "편집 커서 = 재생을 시작할 자리"라서 정지·일시정지·이동할 때만 바뀐다(재생 중에는 프레임마다 바뀌지 않는다).
 * 재생·녹음 중 눈앞에서 흐르는 위치는 소리 쪽 시계가 알고 있으므로, 재생선·시간 표시·따라가기 스크롤처럼 "지금 위치"가 필요한
 * 곳은 모두 여기서 읽는다(프레임 루프가 부르거나, 클릭 순간에 한 번 부른다).
 *
 *  - 멈춰 있으면 편집 커서.
 *  - 재생 중이면 소리 쪽 시계. 곡 끝 너머(이펙트 꼬리가 남은 동안)는 곡 끝에서 멈춘 것으로 본다. 녹음 중에는 곡 끝을 넘어도 그대로 흐른다.
 */
import { audioEngine } from "../audio/currentEngine";
import { isRecordingBusy } from "../state/recordingStore";
import { useDawStore } from "../store/useDawStore";
import { getProjectDuration } from "../utils/audioMath";

let durationFor: { tracks: unknown; bpm: number; value: number } | undefined;

/** 곡 길이. 프레임마다 모든 클립을 훑지 않도록 트랙·템포가 그대로면 앞에서 구한 값을 쓴다. */
function projectDuration(state: { tracks: ReturnType<typeof useDawStore.getState>["tracks"]; bpm: number }): number {
  if (durationFor && durationFor.tracks === state.tracks && durationFor.bpm === state.bpm) return durationFor.value;
  const value = getProjectDuration(state);
  durationFor = { tracks: state.tracks, bpm: state.bpm, value };
  return value;
}

/** 지금 재생 위치(초). */
export function readPlayhead(): number {
  const state = useDawStore.getState();
  if (!state.isPlaying) return state.cursor;
  const current = audioEngine.getCurrentPlayhead();
  return isRecordingBusy() ? current : Math.min(current, projectDuration(state));
}
