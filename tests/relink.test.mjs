import test from "node:test";
import assert from "node:assert/strict";
import {
  RELINK_DURATION_TOLERANCE_SECONDS,
  countClipsByAsset,
  findMissingByHash,
  judgeRelink,
  listMissingAssets,
  mismatchReason,
} from "../src/domain/project/relink.ts";
import { createDefaultTrack } from "../src/domain/project/defaults.ts";
import { makeClip } from "./helpers/docs.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const missing = (overrides = {}) => ({ fileName: "반주.wav", duration: 192, hash: HASH_A, ...overrides });

test("해시가 같으면 이름·길이가 달라도 같은 파일이다", () => {
  assert.equal(judgeRelink(missing(), { fileName: "다른 이름.wav", duration: 10, hash: HASH_A }), "same");
});

test("해시가 다르거나 모르는데 이름이 같고 길이 차이가 0.25초 이내면 비슷한 파일(확인 필요)이다", () => {
  assert.equal(judgeRelink(missing(), { fileName: "반주.wav", duration: 192.1, hash: HASH_B }), "similar");
  // 해시를 기록하지 않은 옛 파일(6월·11월 형식)이나 해시를 계산하지 못한 환경: 같은 파일임을 증명할 수 없으니 확인을 거친다.
  assert.equal(judgeRelink(missing({ hash: undefined }), { fileName: "반주.wav", duration: 192, hash: HASH_A }), "similar");
  assert.equal(judgeRelink(missing(), { fileName: "반주.wav", duration: 192, hash: undefined }), "similar");
  assert.equal(judgeRelink(missing({ hash: undefined }), { fileName: "반주.wav", duration: 192 }), "similar");
});

test("길이 차이 경계: 0.25초는 비슷하고 그보다 크면 다른 파일이다", () => {
  assert.equal(RELINK_DURATION_TOLERANCE_SECONDS, 0.25);
  assert.equal(judgeRelink(missing(), { fileName: "반주.wav", duration: 192.25, hash: HASH_B }), "similar");
  assert.equal(judgeRelink(missing(), { fileName: "반주.wav", duration: 191.75, hash: HASH_B }), "similar");
  assert.equal(judgeRelink(missing(), { fileName: "반주.wav", duration: 192.26, hash: HASH_B }), "different");
  // 부동소수점 오차가 경계를 넘겨도 뒤집히지 않는다.
  assert.equal(judgeRelink(missing({ duration: 0.1 }), { fileName: "반주.wav", duration: 0.35, hash: HASH_B }), "similar");
});

test("이름이 다르면 길이가 같아도 다른 파일이다. 한글 조합 방식과 대소문자 차이는 같은 이름으로 본다", () => {
  assert.equal(judgeRelink(missing(), { fileName: "반주2.wav", duration: 192, hash: HASH_B }), "different");
  const decomposed = "반주.wav".normalize("NFD"); // 맥에서 고른 파일 이름은 자모가 풀려 있기도 하다
  assert.notEqual(decomposed, "반주.wav");
  assert.equal(judgeRelink(missing(), { fileName: decomposed, duration: 192, hash: HASH_B }), "similar");
  assert.equal(judgeRelink(missing({ fileName: "Take1.WAV" }), { fileName: "take1.wav", duration: 192, hash: HASH_B }), "similar");
});

test("다른 파일로 판정한 이유: 길이가 크게 다르면 길이, 아니면 이름", () => {
  assert.equal(mismatchReason({ duration: 192 }, { duration: 220 }), "length");
  assert.equal(mismatchReason({ duration: 192 }, { duration: 192.2 }), "name");
});

function docWithClips() {
  const t1 = createDefaultTrack(1);
  const t2 = createDefaultTrack(2);
  t1.clips = [makeClip(t1.id, "c1", 0, { audioBufferId: "a1" }), makeClip(t1.id, "c2", 2, { audioBufferId: "a1" }), makeClip(t1.id, "c3", 4, { audioBufferId: "a2" })];
  t2.clips = [makeClip(t2.id, "c4", 0, { audioBufferId: "a1" })];
  const asset = (id, fileName, hash) => ({ id, fileName, duration: 1, sampleRate: 44100, channels: 1, source: "upload", hash });
  return {
    tracks: [t1, t2],
    assets: { a1: asset("a1", "하나.wav", HASH_A), a2: asset("a2", "둘.wav", HASH_B), a3: asset("a3", "셋.wav", HASH_A), a4: asset("a4", "넷.wav", undefined) },
  };
}

test("클립 수는 음원마다 모든 트랙을 합쳐 센다", () => {
  const counts = countClipsByAsset(docWithClips().tracks);
  assert.equal(counts.get("a1"), 3);
  assert.equal(counts.get("a2"), 1);
  assert.equal(counts.get("a3"), undefined);
});

test("데이터가 빠진 음원만 문서 순서대로 모으고, 쓰는 클립 수를 함께 준다", () => {
  const list = listMissingAssets(docWithClips(), (id) => id === "a2");
  assert.deepEqual(list.map((item) => [item.asset.id, item.clipCount]), [["a1", 3], ["a3", 0], ["a4", 0]]);
  assert.deepEqual(listMissingAssets(docWithClips(), () => true), []);
});

test("같은 해시의 빠진 음원은 모두 찾고, 해시를 모르면 아무것도 찾지 않는다", () => {
  const list = listMissingAssets(docWithClips(), () => false);
  assert.deepEqual(findMissingByHash(list, HASH_A).map((item) => item.asset.id), ["a1", "a3"]);
  assert.deepEqual(findMissingByHash(list, HASH_B).map((item) => item.asset.id), ["a2"]);
  assert.deepEqual(findMissingByHash(list, undefined), []);
  assert.deepEqual(findMissingByHash(list, "c".repeat(64)), []);
});
