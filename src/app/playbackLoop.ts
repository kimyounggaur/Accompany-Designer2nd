/**
 * 재생 중 화면 갱신 루프를 켜고 끄는 곳과 곡 끝 감시(설계서 §P5-3, 보고서 C10).
 *
 * 예전에는 `App.tsx`의 효과 하나가 `requestAnimationFrame`을 돌리며 매 프레임 재생 위치를 스토어에 쓰고(그때마다 `Timeline`과
 * 상단 바가 다시 그려졌다) 곡 끝에 닿았는지도 살폈다. 이제는
 *  - 루프는 `services/frameLoop.ts` 하나이고, 재생 중이거나 녹음 중일 때만 켠다(멈춰 있으면 화면 갱신 요청 0회).
 *  - 재생 위치는 스토어에 쓰지 않는다. 재생선·시간 표시는 `readPlayhead()`로 직접 읽어 자기 요소만 고친다.
 *  - 곡 끝 감시는 이 파일의 프레임 구독자 하나다.
 */
import { audioEngine } from "../audio/currentEngine";
import { onFrame, setLoopActive } from "../services/frameLoop";
import { isRecordingBusy, useRecordingStore } from "../state/recordingStore";
import { useDawStore } from "../store/useDawStore";
import { getProjectDuration } from "../utils/audioMath";

/** 화면 갱신 루프를 돌려야 하는가: 재생 중이거나 녹음 중. */
export function shouldRunFrameLoop(): boolean {
  return useDawStore.getState().isPlaying || useRecordingStore.getState().status === "recording";
}

/**
 * 재생이 곡 끝에 닿았으면 멈추고 편집 커서를 곡 끝에 둔다. 프레임마다 부른다(재생·녹음 중에만 돈다).
 * 이펙트 꼬리가 남은 동안에는 소리를 이어 가되(`getPlaybackEnd`), 화면의 재생 위치는 곡 끝에서 멈춘다. 녹음 중에는 멈추지 않는다.
 */
export function stopAtSongEnd(): void {
  const state = useDawStore.getState();
  if (!state.isPlaying || isRecordingBusy()) return;
  if (audioEngine.getCurrentPlayhead() < audioEngine.getPlaybackEnd(state)) return;
  audioEngine.stop();
  state.setCursor(getProjectDuration(state));
  state.setIsPlaying(false);
}

/** 앱이 켜질 때 한 번: 루프를 켜고 끄는 규칙과 곡 끝 감시를 건다. 돌려주는 함수를 부르면 모두 거둔다. */
export function installPlaybackLoop(): () => void {
  const sync = () => setLoopActive(shouldRunFrameLoop());
  const offPlaying = useDawStore.subscribe((state, previous) => {
    if (state.isPlaying !== previous.isPlaying) sync();
  });
  const offRecording = useRecordingStore.subscribe((state, previous) => {
    if (state.status !== previous.status) sync();
  });
  const offFrame = onFrame(stopAtSongEnd);
  sync();
  return () => {
    offPlaying();
    offRecording();
    offFrame();
    setLoopActive(false);
  };
}
