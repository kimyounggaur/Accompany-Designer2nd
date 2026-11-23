import { useDawStore } from "../store/useDawStore";
import type { DawProject } from "../types";

/**
 * 지금 화면의 프로젝트 문서. 저장·재생·내보내기가 모두 이 모양으로 받는다.
 * blobUrl처럼 실행 중에만 의미 있는 값은 뺀다.
 */
export function getProjectSnapshot(): DawProject {
  const state = useDawStore.getState();
  const audioAssets = Object.fromEntries(
    Object.entries(state.audioAssets).map(([assetId, asset]) => {
      const { blobUrl, ...serializableAsset } = asset;
      return [assetId, serializableAsset];
    }),
  );

  return {
    id: state.id,
    name: state.name,
    bpm: state.bpm,
    sampleRate: state.sampleRate,
    tracks: state.tracks,
    audioAssets,
    timeMarkers: state.timeMarkers,
  };
}
