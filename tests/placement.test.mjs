/**
 * 클립 배치 규칙(P4-5, 보고서 B7·B8): 올린 음원과 녹음을 어느 트랙에 놓을지.
 * 규칙은 문서만 보는 순수한 계산이라 가짜 스토어 없이 문서를 직접 만들어 확인한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeClip, makeMultiDoc } from "./helpers/docs.mjs";

const { chooseTrack, isIntervalFree } = await import("../src/domain/timeline/placement.ts");
const { planUpload } = await import("../src/services/importer.ts");
const { createDefaultTrack } = await import("../src/domain/project/defaults.ts");

const upload = (doc, selectedTrackId, start, length, extra = {}) =>
  chooseTrack(doc, { purpose: "upload", selectedTrackId, start, length, ...extra });
const record = (doc, extra = {}) => chooseTrack(doc, { purpose: "recording", start: 0, length: 0, ...extra });

// ───────── 올리기 ─────────

test("올리기: 선택한 트랙의 그 구간이 비어 있으면 그 트랙에 놓는다", () => {
  const doc = makeMultiDoc([[0], [], []]); // 트랙 1에만 0~1초 클립
  const [first, second] = doc.tracks;
  assert.deepEqual(upload(doc, second.id, 0, 4), { trackId: second.id }, "선택한 빈 트랙");
  assert.deepEqual(upload(doc, first.id, 1, 4), { trackId: first.id }, "클립이 끝난 자리(맞닿음)부터는 비어 있다");
  assert.deepEqual(upload(doc, first.id, 7, 2), { trackId: first.id }, "클립에서 떨어진 자리");
});

test("올리기: 선택한 트랙의 그 구간에 클립이 걸치면 새 트랙이다(다른 트랙이 비어 있어도)", () => {
  const doc = makeMultiDoc([[2], []]); // 트랙 1: 2~3초
  const [first] = doc.tracks;
  const ask = (start, length) => upload(doc, first.id, start, length);
  assert.deepEqual(ask(2.5, 1), { newTrack: true }, "클립 한가운데에서 시작");
  assert.deepEqual(ask(1, 1.5), { newTrack: true }, "새 클립의 뒤쪽이 기존 클립의 앞쪽에 걸침");
  assert.deepEqual(ask(2.9, 5), { newTrack: true }, "새 클립의 앞쪽이 기존 클립의 뒤쪽에 걸침");
  assert.deepEqual(ask(0, 10), { newTrack: true }, "기존 클립을 통째로 덮음");
  assert.deepEqual(ask(0, 2), { trackId: first.id }, "0~2초와 2~3초는 맞닿기만 해서 겹치지 않음");
  assert.deepEqual(ask(3, 2), { trackId: first.id }, "3~5초도 마찬가지");
});

test("올리기: 선택한 트랙이 없으면(또는 문서에 없는 트랙이면) 첫 트랙만 본다", () => {
  const doc = makeMultiDoc([[0], []]); // 트랙 1: 0~1초, 트랙 2: 비어 있음
  const [first] = doc.tracks;
  assert.deepEqual(upload(doc, undefined, 5, 2), { trackId: first.id }, "선택 없음: 첫 트랙의 5~7초는 비어 있음");
  assert.deepEqual(upload(doc, undefined, 0, 2), { newTrack: true }, "선택 없음: 첫 트랙이 차 있으면 두 번째 트랙이 비어 있어도 새 트랙");
  assert.deepEqual(upload(doc, "사라진 트랙", 5, 2), { trackId: first.id }, "선택한 트랙이 문서에 없으면 첫 트랙");
  assert.deepEqual(upload({ bpm: 120, tracks: [] }, undefined, 0, 2), { newTrack: true }, "트랙이 하나도 없으면 새 트랙");
});

test("올리기: 템포 맞춤을 켠 클립은 원본 길이가 아니라 타임라인 길이로 겹침을 판단한다(경계 포함)", () => {
  const doc = makeMultiDoc([[]]); // 프로젝트 템포 120
  const [track] = doc.tracks;
  const ask = (start, length) => upload(doc, track.id, start, length);

  // 원본 BPM 60 → 배속 2: 원본 10초가 타임라인에서는 0~5초
  track.clips = [makeClip(track.id, "fast", 0, { duration: 10, sourceBpm: 60, stretchMode: "resample" })];
  assert.deepEqual(ask(5, 2), { trackId: track.id }, "5초에 끝나므로 5초부터는 비어 있음(원본 길이 10초로 보면 겹친다고 잘못 판단)");
  assert.deepEqual(ask(4.9, 2), { newTrack: true }, "끝(5초)보다 0.1초 앞에서 시작하면 겹침");

  // 원본 BPM 240 → 배속 0.5: 원본 10초가 타임라인에서는 0~20초
  track.clips = [makeClip(track.id, "slow", 0, { duration: 10, sourceBpm: 240, stretchMode: "resample" })];
  assert.deepEqual(ask(15, 2), { newTrack: true }, "원본 길이로는 10초에 끝나 비어 보이지만 타임라인에서는 20초까지 참");
  assert.deepEqual(ask(20, 2), { trackId: track.id }, "20초에 끝나므로 20초부터는 비어 있음");

  // 템포 맞춤이 꺼져 있으면 원본 BPM이 달라도 원본 길이 그대로
  track.clips = [makeClip(track.id, "plain", 0, { duration: 10, sourceBpm: 60, stretchMode: "none" })];
  assert.deepEqual(ask(5, 2), { newTrack: true });
  assert.deepEqual(ask(10, 2), { trackId: track.id });
});

test("올리기: 새 클립의 길이도 타임라인 길이로 받는다(길이가 겹치면 시작이 비어 있어도 새 트랙)", () => {
  const doc = makeMultiDoc([[4]]); // 트랙 1: 4~5초
  const [track] = doc.tracks;
  assert.deepEqual(upload(doc, track.id, 0, 4), { trackId: track.id }, "0~4초는 4초에 시작하는 클립과 맞닿기만 함");
  assert.deepEqual(upload(doc, track.id, 0, 4.5), { newTrack: true }, "같은 곳에서 시작해도 4.5초 길이면 겹침");
});

test("올리기: 여러 파일은 한 파일씩 차례로 규칙을 적용한다(앞 파일이 놓인 문서를 보고 다음 파일을 판단)", () => {
  const doc = makeMultiDoc([[]]);
  let selected = doc.tracks[0].id;
  const placed = [];
  // 같은 곡 위치(0초)에 4초·3초·2초 파일을 차례로 올린다. 새 트랙이 만들어지면 그 트랙이 선택된다(스토어의 addTrack과 같다).
  for (const [name, seconds] of [["a", 4], ["b", 3], ["c", 2]]) {
    const choice = upload(doc, selected, 0, seconds);
    let track;
    if ("trackId" in choice) {
      track = doc.tracks.find((item) => item.id === choice.trackId);
    } else {
      track = createDefaultTrack(doc.tracks.length + 1);
      doc.tracks.push(track);
      selected = track.id;
    }
    track.clips.push(makeClip(track.id, name, 0, { duration: seconds }));
    placed.push([name, doc.tracks.indexOf(track)]);
  }
  assert.deepEqual(placed, [["a", 0], ["b", 1], ["c", 2]], "같은 자리의 파일은 각자 새 트랙에");
  assert.deepEqual(upload(doc, selected, 5, 1), { trackId: doc.tracks[2].id }, "선택한 마지막 트랙의 2초 뒤 빈 자리에는 그 트랙에 놓임");
});

// ───────── 녹음 ─────────

test("녹음: 녹음 대기 트랙이 있으면 그 트랙에 놓는다(클립이 있어도, 선택한 트랙과 달라도)", () => {
  const doc = makeMultiDoc([[0], [0], []]);
  const [, second, third] = doc.tracks;
  assert.deepEqual(record(doc, { armedTrackId: second.id, selectedTrackId: third.id }), { trackId: second.id });
});

test("녹음: 대기 트랙이 없으면(문서에서 사라졌어도) 클립이 하나도 없는 첫 트랙에 놓는다", () => {
  const doc = makeMultiDoc([[0], [], []]);
  const [, second] = doc.tracks;
  assert.deepEqual(record(doc), { trackId: second.id });
  assert.deepEqual(record(doc, { armedTrackId: "사라진 트랙" }), { trackId: second.id });
  assert.deepEqual(record(doc, { selectedTrackId: doc.tracks[2].id }), { trackId: second.id }, "녹음은 선택한 트랙을 보지 않는다");
});

test("녹음: 대기 트랙도 빈 트랙도 없으면 새 트랙이다", () => {
  assert.deepEqual(record(makeMultiDoc([[0], [3]])), { newTrack: true });
  assert.deepEqual(record({ bpm: 120, tracks: [] }), { newTrack: true }, "트랙이 하나도 없어도 새 트랙");
});

// ───────── 겹침 판정 ─────────

test("올리기는 녹음 대기 트랙을 보지 않는다", () => {
  const doc = makeMultiDoc([[], []]);
  const [first, second] = doc.tracks;
  assert.deepEqual(upload(doc, first.id, 0, 1, { armedTrackId: second.id }), { trackId: first.id });
});

test("소수 계산의 어긋남이 있어도 맞닿은 클립은 겹친 것이 아니다", () => {
  const doc = makeMultiDoc([[]]);
  const [track] = doc.tracks;
  track.clips = [makeClip(track.id, "x", 0.1, { duration: 0.2 })]; // 끝은 0.1 + 0.2 = 0.30000000000000004
  assert.deepEqual(upload(doc, track.id, 0.3, 1), { trackId: track.id });
  assert.deepEqual(upload(doc, track.id, 0, 0.1), { trackId: track.id }, "앞쪽 맞닿음");
});

test("isIntervalFree: 클립이 없는 트랙은 어디든 비어 있고, 길이 0은 클립 한가운데에서만 막힌다", () => {
  const doc = makeMultiDoc([[2]]);
  const [track] = doc.tracks;
  assert.equal(isIntervalFree({ clips: [] }, 120, 0, 100), true);
  assert.equal(isIntervalFree(track, 120, 2.5, 0), false, "클립 한가운데");
  assert.equal(isIntervalFree(track, 120, 2, 0), true, "클립이 시작하는 자리");
  assert.equal(isIntervalFree(track, 120, 3, 0), true, "클립이 끝나는 자리");
  assert.equal(isIntervalFree(track, 120, 5, -1), true, "음수 길이는 0으로 본다");
});

// ───────── 올리기 계획(services/importer) ─────────

const asset = { id: "asset-new", fileName: "새 음원.wav", duration: 4, sampleRate: 44100, channels: 2, mimeType: "audio/wav", byteSize: 1, source: "upload" };

test("planUpload: 새 클립은 원본 속도(템포 맞춤 꺼짐)이고 원본 BPM은 프로젝트 템포이며 재생 위치에서 시작한다", () => {
  const doc = makeMultiDoc([[]], { bpm: 96 });
  const plan = planUpload(doc, asset, { clipId: "clip-new", startTime: 1.5 });
  assert.deepEqual(plan.clip, {
    id: "clip-new", audioBufferId: "asset-new", name: "새 음원.wav", startTime: 1.5, offset: 0, duration: 4,
    sourceBpm: 96, stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0, fadeCurve: "equalPower", muted: false,
  });
  assert.equal("trackId" in plan.clip, false, "놓을 트랙은 부르는 쪽이 채운다");
});

test("planUpload: 선택한 트랙이 비어 있으면 그 트랙, 겹치면 새 트랙을 가리킨다(템포 맞춤을 켠 클립은 타임라인 길이로)", () => {
  const doc = makeMultiDoc([[]]); // 템포 120
  const [track] = doc.tracks;
  assert.deepEqual(planUpload(doc, asset, { clipId: "c", startTime: 0, selectedTrackId: track.id }).target, { trackId: track.id });

  // 원본 BPM 60 → 배속 2: 원본 10초가 0~5초. 5초에 올리면 비어 있고, 4초에 올리면 겹친다.
  track.clips = [makeClip(track.id, "fast", 0, { duration: 10, sourceBpm: 60, stretchMode: "resample" })];
  assert.deepEqual(planUpload(doc, asset, { clipId: "c", startTime: 5, selectedTrackId: track.id }).target, { trackId: track.id });
  assert.deepEqual(planUpload(doc, asset, { clipId: "c", startTime: 4, selectedTrackId: track.id }).target, { newTrack: true });
});
