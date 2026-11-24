/**
 * 재생·정지(상단 바의 단추와 단축키가 같은 함수를 부른다).
 * 예전에는 App.tsx 안에 있어서 단축키(App의 키 처리기)와 단추(TopBar)가 각자 App의 지역 함수에 기대고 있었다.
 *
 * 재생을 시작하는 자리는 편집 커서(`cursor`)다. 일시정지하면 멈춘 자리가 새 커서가 되고, 정지하면 처음(0)이 된다.
 * 재생 중 흐르는 위치는 스토어에 쓰지 않는다(`app/playhead.ts`의 `readPlayhead()`).
 */
import { audioEngine } from "../audio/currentEngine";
import { isRecordingBusy } from "../state/recordingStore";
import { useDawStore } from "../store/useDawStore";
import { getProjectDuration } from "../utils/audioMath";
import { getProjectSnapshot } from "./projectSnapshot";
import { stopRecording } from "./recording";

/**
 * 재생/일시정지. 녹음하는 동안에는 재생 단추와 스페이스가 녹음을 멈춘다
 * (녹음이 도는데 재생만 멈추면 소리가 어긋난다).
 */
export async function togglePlayback(): Promise<void> {
  if (isRecordingBusy()) {
    await stopRecording();
    return;
  }
  const state = useDawStore.getState();

  if (state.isPlaying) {
    const pausedAt = audioEngine.getCurrentPlayhead();
    audioEngine.stop();
    state.setCursor(pausedAt);
    state.setIsPlaying(false);
    return;
  }

  const duration = getProjectDuration(state);
  const startAt = state.cursor >= duration ? 0 : state.cursor;
  state.setCursor(startAt);
  await audioEngine.play(getProjectSnapshot(), startAt);
  state.setIsPlaying(true);
}

/** 정지: 녹음 중이면 녹음도 끝내고(준비·카운트인 중이면 취소), 재생 위치는 처음으로 돌아간다. */
export function stopPlayback(): void {
  if (isRecordingBusy()) void stopRecording();
  audioEngine.stop();
  const state = useDawStore.getState();
  state.setCursor(0);
  state.setIsPlaying(false);
}
