/** 믹스 내보내기 시험에 쓰는 프로젝트 만들기 */
import { produce } from "immer";

const { createDefaultTrack } = await import("../../src/domain/project/defaults.ts");

let counter = 0;

/** 클립 하나. 안 준 값은 1초짜리 평범한 클립. */
export function makeClip(overrides = {}) {
  counter += 1;
  return {
    id: `clip-${counter}`, audioBufferId: "asset", name: "clip", trackId: "track",
    startTime: 0, offset: 0, duration: 1, sourceBpm: 120, stretchMode: "none",
    gain: 1, fadeIn: 0, fadeOut: 0,
    ...overrides,
  };
}

/** 트랙 하나(이펙트는 기본값: EQ만 켜져 있어 꼬리가 없다). `clips`를 주면 그 트랙에 놓는다. */
export function makeTrack(clips = [], changes) {
  const base = createDefaultTrack(1);
  const track = produce(base, (draft) => {
    draft.clips = clips.map((clip) => ({ ...clip, trackId: draft.id }));
    changes?.(draft);
  });
  return track;
}

/** 이펙트를 켠다(이펙트 자신의 켜기와 사슬 슬롯의 켜기를 함께) */
export function enableEffect(track, type) {
  const key = { eq: "eq", comp: "compressor", delay: "delay", reverb: "reverb" }[type];
  track[key].enabled = true;
  for (const slot of track.effectChain) if (slot.type === type) slot.enabled = true;
}

export function makeProject({ bpm = 120, tracks = [makeTrack([makeClip()])], master, sampleRate = 44100, name = "프로젝트" } = {}) {
  return { schemaVersion: 2, id: "project", name, bpm, timeSignature: { beats: 4, unit: 4 }, sampleRate, master, tracks, assets: {}, markers: [] };
}
