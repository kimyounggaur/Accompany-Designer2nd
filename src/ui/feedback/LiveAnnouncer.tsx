import { useEffect, useRef } from "react";
import { transportAnnouncement, type TransportSnapshot } from "../../services/transportAnnouncement";
import { announce } from "../../services/announce";
import { useAnnounceStore } from "../../state/announceStore";
import { useRecordingStore } from "../../state/recordingStore";
import { useDawStore } from "../../store/useDawStore";

/** 안내를 읽은 뒤 이 시간(ms)이 지나면 글자를 비운다(화면 낭독기의 문서 읽기에 오래된 안내가 남지 않게). */
const CLEAR_AFTER_MS = 6000;
/** 재생·녹음 상태가 이어서 바뀌면(녹음 시작 = 녹음 단계 + 재생) 한 번에 모아 읽는다 */
const SETTLE_MS = 80;

/**
 * 화면 낭독기에게만 보이는 안내 자리(설계 P6-2). 눈에는 보이지 않는다.
 *  - 재생·정지·녹음 상태가 바뀔 때 알린다("재생 중", "녹음 중").
 *  - 클립을 키보드로 옮기거나 고를 때 같은 `announce()` 통로로 결과를 알린다.
 * 처음 화면을 그릴 때는 읽지 않는다(바뀐 것이 없다).
 */
export function LiveAnnouncer() {
  const message = useAnnounceStore((state) => state.message);
  const seq = useAnnounceStore((state) => state.seq);
  const playing = useDawStore((state) => state.isPlaying);
  const recording = useRecordingStore((state) => state.status);
  const last = useRef<TransportSnapshot>({ playing, recording });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next: TransportSnapshot = { playing, recording };
      const text = transportAnnouncement(last.current, next);
      last.current = next;
      if (text) announce(text);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [playing, recording]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => useAnnounceStore.setState({ message: "" }), CLEAR_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [message, seq]);

  // 같은 문구가 이어져도 다시 읽히도록 번호가 홀수일 때만 끝에 보이지 않는 빈칸을 붙인다.
  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="live-announcer">
      {message ? `${message}${seq % 2 === 1 ? " " : ""}` : ""}
    </div>
  );
}
