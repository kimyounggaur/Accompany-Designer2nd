/**
 * 문서가 바뀌었을 때 소리 경로에서 무엇을 다시 맞춰야 하는지 정한다(순수 함수, 오디오 노드를 모른다).
 *
 * 비교는 전부 참조(===)로 한다. 문서는 immer로 바뀐 부분만 새 객체가 되므로
 * 트랙이 같은 참조면 그 트랙은 믹서·이펙트 값도 클립도 그대로라는 뜻이다. JSON 직렬화는 하지 않는다.
 */
import type { Track } from "../../domain/types";

/** 동기화에 필요한 문서 부분 */
export interface SyncDoc {
  bpm: number;
  tracks: Track[];
  /** 마스터 볼륨. 옛 프로젝트에는 없을 수 있다(0 dB로 본다). */
  master?: { volumeDb: number };
}

export interface TrackStep {
  track: Track;
  /** 이전 문서의 같은 트랙(새 트랙이면 undefined) */
  previous?: Track;
  /** 이 트랙 자체가 새 참조인가(새 트랙 포함). 이펙트 연결 모양을 다시 확인해야 한다. */
  trackChanged: boolean;
  /** 믹서·이펙트 값(볼륨·팬·EQ·컴프레서·딜레이·리버브)을 다시 반영해야 하는가 */
  updateParams: boolean;
  /** 이 트랙의 클립 예약을 다시 맞춰야 하는가 */
  reconcileClips: boolean;
}

export interface SyncPlan {
  /** 템포가 바뀌었거나 처음 맞추는 것이면 true. 클립 재생 배율과 딜레이 박자 동기가 달라진다. */
  tempoChanged: boolean;
  /** 지금 솔로인 트랙이 있는가 */
  solo: boolean;
  /** 사라진 트랙 */
  removedTrackIds: string[];
  /** 처리가 필요한 트랙만 (바뀌지 않은 트랙은 들어 있지 않다) */
  steps: TrackStep[];
}

export function planSync(doc: SyncDoc, previous: SyncDoc | undefined): SyncPlan {
  const tempoChanged = !previous || doc.bpm !== previous.bpm;
  const solo = doc.tracks.some((track) => track.solo);
  const soloChanged = !previous || solo !== previous.tracks.some((track) => track.solo);
  const before = new Map<string, Track>();
  if (previous) for (const track of previous.tracks) before.set(track.id, track);

  const steps: TrackStep[] = [];
  for (const track of doc.tracks) {
    const old = before.get(track.id);
    before.delete(track.id);
    const trackChanged = track !== old;
    const updateParams = trackChanged || tempoChanged || soloChanged;
    const reconcileClips = !old || track.clips !== old.clips || tempoChanged;
    if (updateParams || reconcileClips) steps.push({ track, previous: old, trackChanged, updateParams, reconcileClips });
  }

  return { tempoChanged, solo, removedTrackIds: [...before.keys()], steps };
}
