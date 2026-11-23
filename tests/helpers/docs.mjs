/** 시험용 문서·클립 만들기. 값은 시험이 읽기 쉽도록 단순하게 둔다. */
const { createDefaultTrack } = await import("../../src/state/docDefaults.ts");

export function makeClip(trackId, id, startTime, overrides = {}) {
  return {
    id, audioBufferId: "asset", name: id, trackId,
    startTime, offset: 0, duration: 1, sourceBpm: 120, stretchMode: "none",
    gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false,
    ...overrides,
  };
}

/** 트랙 1개에 `starts`마다 길이 1초 클립을 놓은 문서 (클립 id는 c0, c1, …) */
export function makeDoc(starts, { bpm = 120, durations = 1, trackCount = 1 } = {}) {
  const tracks = Array.from({ length: trackCount }, (_, t) => createDefaultTrack(t + 1));
  tracks[0].clips = starts.map((start, i) => makeClip(tracks[0].id, `c${i}`, start, { duration: Array.isArray(durations) ? durations[i] : durations }));
  return { id: "doc", name: "시험", bpm, sampleRate: 44100, tracks, audioAssets: {}, timeMarkers: [] };
}

/** 트랙마다 시작 시각 목록을 준다: `makeMultiDoc([[0, 1], [0.5]])` → 클립 id는 t0c0, t0c1, t1c0 */
export function makeMultiDoc(startsPerTrack, { bpm = 120 } = {}) {
  const tracks = startsPerTrack.map((starts, t) => {
    const track = createDefaultTrack(t + 1);
    track.clips = starts.map((start, i) => makeClip(track.id, `t${t}c${i}`, start));
    return track;
  });
  return { id: "doc", name: "시험", bpm, sampleRate: 44100, tracks, audioAssets: {}, timeMarkers: [] };
}
