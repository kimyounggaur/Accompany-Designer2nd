// P3-1 측정: 트랙 20 × 클립 50 문서에서 변경 감지·이력·엔진 sync 비용을 잰다.
// 실행: node --expose-gc --import ./tests/register-typescript.mjs scripts/measure-sync.mjs
// "이전" 줄은 P3-1 이전 방식(JSON 서명·JSON 복제 이력)을 같은 문서로 흉내 낸 값이고,
// "이후" 줄은 지금 코드를 그대로 돌린 값이다. 소리는 tests/helpers/fake-audio.mjs의 가짜 오디오다.
const src = new URL("../src/", import.meta.url).href;
const { FakeContext, Source, counters } = await import(new URL("../tests/helpers/fake-audio.mjs", import.meta.url).href);

globalThis.window = { AudioContext: FakeContext };
const { projectStore, getDoc } = await import(src + "state/projectStore.ts");
const { history } = await import(src + "state/history.ts");
const commands = await import(src + "state/commands/index.ts");
const { createDefaultTrack } = await import(src + "state/docDefaults.ts");
const { planSync } = await import(src + "audio/engine/syncPlan.ts");
const { audioEngine } = await import(src + "audio/audioEngine.ts");

function bigDoc(trackCount = 20, clipCount = 50) {
  const tracks = Array.from({ length: trackCount }, (_, t) => {
    const track = createDefaultTrack(t + 1);
    track.clips = Array.from({ length: clipCount }, (_, c) => ({
      id: `clip-${t}-${c}`, audioBufferId: "asset", name: `클립 ${t}-${c}`, trackId: track.id,
      startTime: c * 2, offset: 0, duration: 1.5, sourceBpm: 120, stretchMode: "none",
      gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false,
    }));
    return track;
  });
  return { id: "big", name: "큰 프로젝트", bpm: 120, sampleRate: 44100, tracks, audioAssets: {}, timeMarkers: [] };
}

const time = (fn, n) => { const s = performance.now(); for (let i = 0; i < n; i++) fn(i); return (performance.now() - s) / n; };
const fmt = (ms) => `${ms.toFixed(4)} ms`;
const gc = () => { if (globalThis.gc) { globalThis.gc(); globalThis.gc(); } };

const doc = bigDoc();
const json = JSON.stringify({ bpm: doc.bpm, tracks: doc.tracks });
console.log(`문서 JSON 크기: ${(json.length / 1024).toFixed(0)} KB (트랙 20 × 클립 50)`);

// ── 이전 방식 ──
const oldSignature = time(() => JSON.stringify({ bpm: doc.bpm, tracks: doc.tracks }), 300);
const snapshot = () => ({ name: doc.name, bpm: doc.bpm, tracks: doc.tracks, audioAssets: doc.audioAssets, timeMarkers: doc.timeMarkers });
const oldClone = time(() => JSON.parse(JSON.stringify(snapshot())), 300);
console.log(`이전: 재생 중 변경 감지용 JSON 서명 1회  ${fmt(oldSignature)}`);
console.log(`이전: 이력 한 단계 저장(JSON 복제) 1회   ${fmt(oldClone)}`);

// ── 이후 방식 ──
projectStore.setState({ doc: bigDoc() });
history.clear();
const editMs = time((i) => commands.updateTrack(getDoc().tracks[i % 20].id, { volume: 0.2 + (i % 50) * 0.01 + i * 1e-6 }), 400);
console.log(`이후: 편집 1회(immer 생성 + 이력 기록 + 저장소 반영) ${fmt(editMs)}`);

projectStore.setState({ doc: bigDoc() });
history.clear();
const docs = [getDoc()];
for (let i = 0; i < 200; i++) { commands.updateTrack(getDoc().tracks[i % 20].id, { volume: 0.2 + i * 0.001 }); docs.push(getDoc()); }
const planMs = time((i) => planSync(docs[(i % 200) + 1], docs[i % 200]), 5000);
console.log(`이후: planSync(변경 계획) 1회             ${fmt(planMs)}`);

// 엔진 sync(가짜 오디오): 재생 중 한 트랙의 볼륨만 바꾼다.
projectStore.setState({ doc: bigDoc() });
history.clear();
Source.starts = [];
audioEngine.registerBuffer("asset", new FakeContext().createBuffer(1, 44100 * 5, 44100));
await audioEngine.play(getDoc(), 0);
const startedAtPlay = Source.starts.length;
let before = getDoc();
const syncTimes = [];
let writes = 0;
for (let i = 0; i < 200; i++) {
  commands.updateTrack(getDoc().tracks[i % 20].id, { volume: 0.2 + i * 0.002 });
  const after = getDoc();
  counters.paramWrites = 0;
  const s = performance.now();
  audioEngine.sync(after, before);
  syncTimes.push(performance.now() - s);
  writes += counters.paramWrites;
  before = after;
}
audioEngine.stop();
syncTimes.sort((a, b) => a - b);
const average = syncTimes.reduce((a, b) => a + b, 0) / syncTimes.length;
console.log(`이후: 엔진 sync 평균 ${fmt(average)} · 중앙값 ${fmt(syncTimes[100])} · 최대 ${fmt(syncTimes[199])} · 값 쓰기 평균 ${(writes / 200).toFixed(1)}회 · 소스 재시작 ${Source.starts.length - startedAtPlay}회`);

// ── 이력 100단계 메모리(--expose-gc가 있을 때만) ──
if (globalThis.gc) {
  gc();
  const base1 = process.memoryUsage().heapUsed;
  const clones = [];
  for (let i = 0; i < 100; i++) clones.push(JSON.parse(JSON.stringify(snapshot())));
  gc();
  const oldMb = (process.memoryUsage().heapUsed - base1) / 1048576;
  clones.length = 0;

  projectStore.setState({ doc: bigDoc() });
  history.clear();
  gc();
  const base2 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100; i++) commands.updateTrack(getDoc().tracks[i % 20].id, { volume: 0.2 + i * 0.003 });
  gc();
  const newMb = (process.memoryUsage().heapUsed - base2) / 1048576;
  console.log(`이력 100단계 메모리 증가: 이전(JSON 복제) ${oldMb.toFixed(1)} MB → 이후(구조 공유) ${newMb.toFixed(2)} MB (단계 수 ${history.depth().undo}, 음수면 GC 오차)`);
} else {
  console.log("이력 메모리 측정은 --expose-gc가 있어야 합니다.");
}
