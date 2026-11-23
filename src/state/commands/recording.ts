/** 녹음 결과를 문서에 넣는 변경 함수 */
import type { AssetMeta, Clip } from "../../domain/types";
import { createDefaultTrack } from "../../domain/project/defaults";
import { history, type EditOptions } from "../history";
import { baseOf, locateTrack } from "./locate";

export interface AddRecordingInput {
  /** 녹음을 놓을 트랙. 그 사이 사라졌다면 새 트랙을 만들어 놓는다. */
  trackId: string;
  /** 디코드한 녹음 음원 */
  asset: AssetMeta;
  clipId: string;
  /** 클립이 놓일 곡 위치(초) */
  startTime: number;
  /** 녹음 앞쪽에서 잘라 낼 길이(초): 지연 보정으로 곡 시작보다 앞서 간 만큼 */
  trim?: number;
  bpm: number;
}

/** 녹음 결과로 만드는 클립 */
export function createRecordingClip(input: AddRecordingInput): Clip {
  const trim = Math.max(0, input.trim ?? 0);
  return {
    id: input.clipId,
    audioBufferId: input.asset.id,
    name: input.asset.fileName,
    trackId: input.trackId,
    startTime: Math.max(0, input.startTime),
    offset: trim,
    duration: Math.max(0.01, input.asset.duration - trim),
    sourceBpm: input.bpm,
    stretchMode: "none",
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    fadeCurve: "equalPower",
    muted: false,
  };
}

/**
 * 녹음이 끝났을 때 음원과 클립을 한 번에 문서에 넣는다. 실행 취소 1단계("녹음 추가").
 * 녹음 중에는 문서를 건드리지 않으므로(파형은 recordingStore) 이 함수가 녹음 한 번당 문서의 유일한 변경이다.
 * 돌려주는 값: 클립을 놓은 트랙 id(트랙이 사라졌으면 새로 만든 트랙).
 */
export function addRecording(input: AddRecordingInput, options?: EditOptions): string {
  let placedOn = input.trackId;
  history.edit("녹음 추가", (doc) => {
    doc.assets[input.asset.id] = input.asset;
    let index = locateTrack(baseOf(doc), input.trackId);
    if (index < 0) {
      const track = createDefaultTrack(doc.tracks.length + 1);
      doc.tracks.push(track);
      index = doc.tracks.length - 1;
      placedOn = track.id;
    }
    doc.tracks[index].clips.push(createRecordingClip({ ...input, trackId: placedOn }));
  }, options);
  return placedOn;
}
